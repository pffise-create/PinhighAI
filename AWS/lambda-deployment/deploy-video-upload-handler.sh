#!/bin/bash

# Deploy Video Upload Handler with SQS Integration
# This script packages and deploys the updated video upload handler

set -e

FUNCTION_NAME="golf-video-upload-handler"
REGION="us-east-1"
HANDLER="video-upload-handler.handler"
RUNTIME="nodejs18.x"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_status "Deploying Video Upload Handler with SQS integration..."

# Navigate to the handler directory
cd "$(dirname "$0")/src/api-handlers"

# Create deployment package
print_status "Creating deployment package..."
zip -r ../../video-upload-handler-sqs.zip video-upload-handler.js

# Navigate back
cd ../..

# Update function code
print_status "Updating Lambda function code..."
aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://video-upload-handler-sqs.zip \
    --region $REGION

# Get queue URL from CloudFormation if available
print_status "Retrieving queue URL from CloudFormation..."
QUEUE_URL=$(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --region $REGION \
    --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [[ -n "$QUEUE_URL" && "$QUEUE_URL" != "None" ]]; then
    print_status "Updating environment variables..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --environment Variables="{FRAME_EXTRACTION_QUEUE_URL=$QUEUE_URL,DYNAMODB_TABLE=golf-coach-analyses}" \
        --region $REGION
    
    print_success "Environment variables updated with queue URL: $QUEUE_URL"
else
    print_error "Could not retrieve queue URL from CloudFormation. Please set manually:"
    echo "aws lambda update-function-configuration --function-name $FUNCTION_NAME --environment Variables='{FRAME_EXTRACTION_QUEUE_URL=<your-queue-url>,DYNAMODB_TABLE=golf-coach-analyses}'"
fi

# Clean up
rm -f video-upload-handler-sqs.zip

print_success "Video Upload Handler deployment completed!"
print_status "The handler now uses SQS instead of direct Lambda invocation."