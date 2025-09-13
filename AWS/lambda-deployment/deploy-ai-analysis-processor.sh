#!/bin/bash

# Deploy AI Analysis Processor with SQS Integration
# This script packages and deploys the updated AI analysis processor

set -e

FUNCTION_NAME="golf-ai-analysis-processor"
REGION="us-east-1"
HANDLER="ai-analysis-processor.handler"
RUNTIME="nodejs18.x"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_status "Deploying AI Analysis Processor with SQS integration..."

# Navigate to the processor directory
cd "$(dirname "$0")/src/ai-analysis"

# Create deployment package
print_status "Creating deployment package..."
zip -r ../../ai-analysis-processor-sqs.zip ai-analysis-processor.js

# Navigate back
cd ../..

# Update function code
print_status "Updating Lambda function code..."
aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://ai-analysis-processor-sqs.zip \
    --region $REGION

# Check current environment variables
print_status "Checking current environment variables..."
CURRENT_ENV=$(aws lambda get-function-configuration \
    --function-name $FUNCTION_NAME \
    --region $REGION \
    --query "Environment.Variables" \
    --output json 2>/dev/null || echo "{}")

# Ensure required environment variables are present
OPENAI_API_KEY=$(echo "$CURRENT_ENV" | jq -r '.OPENAI_API_KEY // empty')
DYNAMODB_TABLE=$(echo "$CURRENT_ENV" | jq -r '.DYNAMODB_TABLE // "golf-coach-analyses"')
USER_THREADS_TABLE=$(echo "$CURRENT_ENV" | jq -r '.USER_THREADS_TABLE // "golf-user-threads"')

if [[ -z "$OPENAI_API_KEY" ]]; then
    print_error "OPENAI_API_KEY environment variable is not set. Please set it manually:"
    echo "aws lambda update-function-configuration --function-name $FUNCTION_NAME --environment Variables='{OPENAI_API_KEY=<your-key>,DYNAMODB_TABLE=$DYNAMODB_TABLE,USER_THREADS_TABLE=$USER_THREADS_TABLE}'"
else
    print_success "Environment variables look good"
fi

# Check if SQS event source mapping exists
print_status "Checking for existing SQS event source mapping..."
AI_QUEUE_ARN=$(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --region $REGION \
    --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueArn'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [[ -n "$AI_QUEUE_ARN" && "$AI_QUEUE_ARN" != "None" ]]; then
    # Check if event source mapping already exists
    EXISTING_MAPPING=$(aws lambda list-event-source-mappings \
        --function-name $FUNCTION_NAME \
        --region $REGION \
        --query "EventSourceMappings[?EventSourceArn=='$AI_QUEUE_ARN'].UUID" \
        --output text 2>/dev/null || echo "")
    
    if [[ -z "$EXISTING_MAPPING" || "$EXISTING_MAPPING" == "None" ]]; then
        print_status "Creating SQS event source mapping..."
        aws lambda create-event-source-mapping \
            --event-source-arn $AI_QUEUE_ARN \
            --function-name $FUNCTION_NAME \
            --batch-size 1 \
            --region $REGION
        print_success "SQS event source mapping created"
    else
        print_status "SQS event source mapping already exists: $EXISTING_MAPPING"
    fi
else
    print_error "Could not retrieve AI Analysis Queue ARN. Please create event source mapping manually:"
    echo "aws lambda create-event-source-mapping --event-source-arn <queue-arn> --function-name $FUNCTION_NAME --batch-size 1"
fi

# Clean up
rm -f ai-analysis-processor-sqs.zip

print_success "AI Analysis Processor deployment completed!"
print_status "The processor now:"
print_status "- Receives messages from SQS instead of direct invocation"
print_status "- Handles SQS batch processing"
print_status "- Maintains backward compatibility with DynamoDB streams"
print_status "- Includes enhanced error handling for SQS messages"