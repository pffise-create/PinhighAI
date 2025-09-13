#!/bin/bash

# Golf Coach SQS Infrastructure Deployment Script
# This script deploys the SQS queues and IAM resources for the Golf Coach pipeline

set -e  # Exit on any error

# Configuration
STACK_NAME="golf-coach-sqs-infrastructure"
PROJECT_NAME="golf-coach"
ENVIRONMENT="prod"
REGION="us-east-1"
TEMPLATE_FILE="golf-sqs-queues.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if AWS CLI is configured
check_aws_cli() {
    print_status "Checking AWS CLI configuration..."
    
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS CLI is not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    print_success "AWS CLI is configured"
}

# Function to validate template
validate_template() {
    print_status "Validating CloudFormation template..."
    
    if aws cloudformation validate-template --template-body file://$TEMPLATE_FILE &> /dev/null; then
        print_success "Template validation passed"
    else
        print_error "Template validation failed"
        exit 1
    fi
}

# Function to check if stack exists
stack_exists() {
    aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION &> /dev/null
}

# Function to deploy stack
deploy_stack() {
    print_status "Deploying CloudFormation stack: $STACK_NAME"
    
    if stack_exists; then
        print_warning "Stack already exists. Updating..."
        
        aws cloudformation update-stack \
            --stack-name $STACK_NAME \
            --template-body file://$TEMPLATE_FILE \
            --parameters ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME \
                        ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
            --capabilities CAPABILITY_NAMED_IAM \
            --region $REGION
        
        print_status "Waiting for stack update to complete..."
        aws cloudformation wait stack-update-complete \
            --stack-name $STACK_NAME \
            --region $REGION
    else
        print_status "Creating new stack..."
        
        aws cloudformation create-stack \
            --stack-name $STACK_NAME \
            --template-body file://$TEMPLATE_FILE \
            --parameters ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME \
                        ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
            --capabilities CAPABILITY_NAMED_IAM \
            --region $REGION
        
        print_status "Waiting for stack creation to complete..."
        aws cloudformation wait stack-create-complete \
            --stack-name $STACK_NAME \
            --region $REGION
    fi
    
    print_success "Stack deployment completed successfully"
}

# Function to display outputs
display_outputs() {
    print_status "Retrieving stack outputs..."
    
    echo ""
    echo "=== STACK OUTPUTS ==="
    aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[*].[OutputKey,OutputValue,Description]" \
        --output table
    
    echo ""
    echo "=== QUEUE URLS ==="
    
    FRAME_QUEUE_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" \
        --output text)
    
    AI_QUEUE_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueURL'].OutputValue" \
        --output text)
    
    echo "Frame Extraction Queue URL: $FRAME_QUEUE_URL"
    echo "AI Analysis Queue URL: $AI_QUEUE_URL"
    
    # Save to file for easy access
    cat > queue-urls.txt << EOF
FRAME_EXTRACTION_QUEUE_URL=$FRAME_QUEUE_URL
AI_ANALYSIS_QUEUE_URL=$AI_QUEUE_URL
EOF
    
    print_success "Queue URLs saved to queue-urls.txt"
}

# Function to update Lambda roles (optional)
update_lambda_roles() {
    print_status "Do you want to update Lambda function roles? (y/N)"
    read -r response
    
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        print_status "Updating Lambda function roles..."
        
        # Get role ARNs from stack outputs
        VIDEO_ROLE_ARN=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $REGION \
            --query "Stacks[0].Outputs[?OutputKey=='VideoUploadHandlerRoleArn'].OutputValue" \
            --output text)
        
        FRAME_ROLE_ARN=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $REGION \
            --query "Stacks[0].Outputs[?OutputKey=='FrameExtractorRoleArn'].OutputValue" \
            --output text)
        
        AI_ROLE_ARN=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $REGION \
            --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisProcessorRoleArn'].OutputValue" \
            --output text)
        
        # Update Lambda functions
        if aws lambda get-function --function-name golf-video-upload-handler --region $REGION &> /dev/null; then
            aws lambda update-function-configuration \
                --function-name golf-video-upload-handler \
                --role $VIDEO_ROLE_ARN \
                --region $REGION
            print_success "Updated golf-video-upload-handler role"
        else
            print_warning "Function golf-video-upload-handler not found"
        fi
        
        if aws lambda get-function --function-name golf-frame-extractor-simple-with-ai --region $REGION &> /dev/null; then
            aws lambda update-function-configuration \
                --function-name golf-frame-extractor-simple-with-ai \
                --role $FRAME_ROLE_ARN \
                --region $REGION
            print_success "Updated golf-frame-extractor-simple-with-ai role"
        else
            print_warning "Function golf-frame-extractor-simple-with-ai not found"
        fi
        
        if aws lambda get-function --function-name golf-ai-analysis-processor --region $REGION &> /dev/null; then
            aws lambda update-function-configuration \
                --function-name golf-ai-analysis-processor \
                --role $AI_ROLE_ARN \
                --region $REGION
            print_success "Updated golf-ai-analysis-processor role"
        else
            print_warning "Function golf-ai-analysis-processor not found"
        fi
    else
        print_status "Skipping Lambda role updates"
    fi
}

# Main execution
main() {
    echo "===================================================="
    echo "Golf Coach SQS Infrastructure Deployment"
    echo "===================================================="
    echo ""
    
    # Change to script directory
    cd "$(dirname "$0")"
    
    # Run deployment steps
    check_aws_cli
    validate_template
    deploy_stack
    display_outputs
    update_lambda_roles
    
    echo ""
    print_success "Deployment completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Update your Lambda functions to use SQS queues"
    echo "2. Create event source mappings for SQS triggers"
    echo "3. Test the pipeline with the new queue-based architecture"
    echo ""
    echo "Queue URLs are available in queue-urls.txt"
}

# Run main function
main "$@"