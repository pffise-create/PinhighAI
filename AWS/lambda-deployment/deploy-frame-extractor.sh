#!/bin/bash

# Deploy Frame Extractor with SQS Integration
# This script packages and deploys the updated frame extractor

set -e

FUNCTION_NAME="golf-frame-extractor-simple-with-ai"
REGION="us-east-1"
HANDLER="lambda_function.lambda_handler"
RUNTIME="python3.9"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_status "Deploying Frame Extractor with SQS integration..."

# Navigate to the extractor directory
cd "$(dirname "$0")/src/frame-extractor"

# Create deployment package
print_status "Creating deployment package..."
zip -r ../../frame-extractor-sqs.zip lambda_function.py

# Navigate back
cd ../..

# Update function code
print_status "Updating Lambda function code..."
aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://frame-extractor-sqs.zip \
    --region $REGION

# Get queue URL from CloudFormation if available
print_status "Retrieving queue URL from CloudFormation..."
AI_QUEUE_URL=$(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --region $REGION \
    --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueURL'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [[ -n "$AI_QUEUE_URL" && "$AI_QUEUE_URL" != "None" ]]; then
    print_status "Updating environment variables..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --environment Variables="{AI_ANALYSIS_QUEUE_URL=$AI_QUEUE_URL,DYNAMODB_TABLE=golf-coach-analyses}" \
        --region $REGION
    
    print_success "Environment variables updated with queue URL: $AI_QUEUE_URL"
else
    print_error "Could not retrieve queue URL from CloudFormation. Please set manually:"
    echo "aws lambda update-function-configuration --function-name $FUNCTION_NAME --environment Variables='{AI_ANALYSIS_QUEUE_URL=<your-queue-url>,DYNAMODB_TABLE=golf-coach-analyses}'"
fi

# Check if SQS event source mapping exists
print_status "Checking for existing SQS event source mapping..."
FRAME_QUEUE_ARN=$(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --region $REGION \
    --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueArn'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [[ -n "$FRAME_QUEUE_ARN" && "$FRAME_QUEUE_ARN" != "None" ]]; then
    # Check if event source mapping already exists
    EXISTING_MAPPING=$(aws lambda list-event-source-mappings \
        --function-name $FUNCTION_NAME \
        --region $REGION \
        --query "EventSourceMappings[?EventSourceArn=='$FRAME_QUEUE_ARN'].UUID" \
        --output text 2>/dev/null || echo "")
    
    if [[ -z "$EXISTING_MAPPING" || "$EXISTING_MAPPING" == "None" ]]; then
        print_status "Creating SQS event source mapping..."
        aws lambda create-event-source-mapping \
            --event-source-arn $FRAME_QUEUE_ARN \
            --function-name $FUNCTION_NAME \
            --batch-size 1 \
            --region $REGION
        print_success "SQS event source mapping created"
    else
        print_status "SQS event source mapping already exists: $EXISTING_MAPPING"
    fi
else
    print_error "Could not retrieve Frame Extraction Queue ARN. Please create event source mapping manually:"
    echo "aws lambda create-event-source-mapping --event-source-arn <queue-arn> --function-name $FUNCTION_NAME --batch-size 1"
fi

# Clean up
rm -f frame-extractor-sqs.zip

print_success "Frame Extractor deployment completed!"
print_status "The extractor now:"
print_status "- Receives messages from SQS instead of direct invocation"
print_status "- Sends results to AI analysis SQS queue"
print_status "- Handles SQS batch processing"