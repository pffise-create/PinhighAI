#!/bin/bash

# Golf Coach Pipeline - Pre-Deployment Checklist
# Comprehensive verification of all components before testing

set -e

REGION="us-east-1"
STACK_NAME="golf-coach-sqs-infrastructure"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() { echo -e "\n${BLUE}=== $1 ===${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

check_passed() {
    ((CHECKS_PASSED++))
    print_success "$1"
}

check_failed() {
    ((CHECKS_FAILED++))
    print_error "$1"
}

check_warning() {
    ((WARNINGS++))
    print_warning "$1"
}

echo "=================================================="
echo "Golf Coach Pipeline - Pre-Deployment Checklist"
echo "=================================================="

# =============================================================================
# 1. AWS CLI & Permissions Check
# =============================================================================
print_header "AWS CLI & Permissions"

if command -v aws &> /dev/null; then
    check_passed "AWS CLI is installed"
else
    check_failed "AWS CLI is not installed"
    exit 1
fi

if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    check_passed "AWS credentials configured (Account: $ACCOUNT_ID)"
else
    check_failed "AWS credentials not configured"
    exit 1
fi

# =============================================================================
# 2. CloudFormation Stack Verification
# =============================================================================
print_header "CloudFormation Infrastructure"

if aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION &> /dev/null; then
    STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].StackStatus" --output text)
    if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
        check_passed "CloudFormation stack exists and is healthy ($STACK_STATUS)"
    else
        check_failed "CloudFormation stack exists but status is: $STACK_STATUS"
    fi
else
    check_failed "CloudFormation stack '$STACK_NAME' not found"
fi

# Get stack outputs
FRAME_QUEUE_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" --output text 2>/dev/null || echo "")
AI_QUEUE_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueURL'].OutputValue" --output text 2>/dev/null || echo "")

if [[ -n "$FRAME_QUEUE_URL" && "$FRAME_QUEUE_URL" != "None" ]]; then
    check_passed "Frame Extraction Queue URL retrieved"
else
    check_failed "Could not retrieve Frame Extraction Queue URL"
fi

if [[ -n "$AI_QUEUE_URL" && "$AI_QUEUE_URL" != "None" ]]; then
    check_passed "AI Analysis Queue URL retrieved"
else
    check_failed "Could not retrieve AI Analysis Queue URL"
fi

# =============================================================================
# 3. SQS Queue Status
# =============================================================================
print_header "SQS Queue Status"

if [[ -n "$FRAME_QUEUE_URL" ]]; then
    FRAME_QUEUE_ATTRS=$(aws sqs get-queue-attributes --queue-url "$FRAME_QUEUE_URL" --attribute-names All --region $REGION 2>/dev/null || echo "{}")
    FRAME_MESSAGES=$(echo "$FRAME_QUEUE_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessages // "unknown"')
    FRAME_INFLIGHT=$(echo "$FRAME_QUEUE_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible // "unknown"')
    
    check_passed "Frame Queue accessible (Messages: $FRAME_MESSAGES, In-flight: $FRAME_INFLIGHT)"
    
    if [[ "$FRAME_MESSAGES" != "0" ]]; then
        check_warning "Frame Queue has $FRAME_MESSAGES pending messages"
    fi
fi

if [[ -n "$AI_QUEUE_URL" ]]; then
    AI_QUEUE_ATTRS=$(aws sqs get-queue-attributes --queue-url "$AI_QUEUE_URL" --attribute-names All --region $REGION 2>/dev/null || echo "{}")
    AI_MESSAGES=$(echo "$AI_QUEUE_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessages // "unknown"')
    AI_INFLIGHT=$(echo "$AI_QUEUE_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible // "unknown"')
    
    check_passed "AI Queue accessible (Messages: $AI_MESSAGES, In-flight: $AI_INFLIGHT)"
    
    if [[ "$AI_MESSAGES" != "0" ]]; then
        check_warning "AI Queue has $AI_MESSAGES pending messages"
    fi
fi

# =============================================================================
# 4. Lambda Function Status
# =============================================================================
print_header "Lambda Function Status"

FUNCTIONS=("golf-video-upload-handler" "golf-frame-extractor-simple-with-ai" "golf-ai-analysis-processor")

for FUNCTION in "${FUNCTIONS[@]}"; do
    if aws lambda get-function --function-name $FUNCTION --region $REGION &> /dev/null; then
        FUNCTION_STATUS=$(aws lambda get-function --function-name $FUNCTION --region $REGION --query "Configuration.State" --output text)
        LAST_MODIFIED=$(aws lambda get-function --function-name $FUNCTION --region $REGION --query "Configuration.LastModified" --output text)
        
        if [[ "$FUNCTION_STATUS" == "Active" ]]; then
            check_passed "$FUNCTION is active (Updated: $LAST_MODIFIED)"
        else
            check_failed "$FUNCTION status: $FUNCTION_STATUS"
        fi
    else
        check_failed "$FUNCTION not found"
    fi
done

# =============================================================================
# 5. Environment Variables Check
# =============================================================================
print_header "Environment Variables"

# Check video upload handler
UPLOAD_ENV=$(aws lambda get-function-configuration --function-name golf-video-upload-handler --region $REGION --query "Environment.Variables" --output json 2>/dev/null || echo "{}")
UPLOAD_QUEUE_URL=$(echo "$UPLOAD_ENV" | jq -r '.FRAME_EXTRACTION_QUEUE_URL // empty')

if [[ -n "$UPLOAD_QUEUE_URL" ]]; then
    check_passed "Video Upload Handler has FRAME_EXTRACTION_QUEUE_URL"
else
    check_failed "Video Upload Handler missing FRAME_EXTRACTION_QUEUE_URL"
fi

# Check frame extractor
EXTRACTOR_ENV=$(aws lambda get-function-configuration --function-name golf-frame-extractor-simple-with-ai --region $REGION --query "Environment.Variables" --output json 2>/dev/null || echo "{}")
EXTRACTOR_QUEUE_URL=$(echo "$EXTRACTOR_ENV" | jq -r '.AI_ANALYSIS_QUEUE_URL // empty')

if [[ -n "$EXTRACTOR_QUEUE_URL" ]]; then
    check_passed "Frame Extractor has AI_ANALYSIS_QUEUE_URL"
else
    check_failed "Frame Extractor missing AI_ANALYSIS_QUEUE_URL"
fi

# Check AI processor
AI_ENV=$(aws lambda get-function-configuration --function-name golf-ai-analysis-processor --region $REGION --query "Environment.Variables" --output json 2>/dev/null || echo "{}")
OPENAI_KEY=$(echo "$AI_ENV" | jq -r '.OPENAI_API_KEY // empty')

if [[ -n "$OPENAI_KEY" ]]; then
    check_passed "AI Processor has OPENAI_API_KEY"
else
    check_failed "AI Processor missing OPENAI_API_KEY"
fi

# =============================================================================
# 6. Event Source Mappings
# =============================================================================
print_header "SQS Event Source Mappings"

# Check frame extractor SQS trigger
FRAME_MAPPINGS=$(aws lambda list-event-source-mappings --function-name golf-frame-extractor-simple-with-ai --region $REGION --query "EventSourceMappings[?contains(EventSourceArn, 'golf-coach-frame-extraction-queue')]" --output json 2>/dev/null || echo "[]")
if [[ "$(echo "$FRAME_MAPPINGS" | jq '. | length')" -gt 0 ]]; then
    MAPPING_STATE=$(echo "$FRAME_MAPPINGS" | jq -r '.[0].State')
    check_passed "Frame Extractor SQS trigger exists ($MAPPING_STATE)"
else
    check_failed "Frame Extractor SQS trigger not found"
fi

# Check AI processor SQS trigger
AI_MAPPINGS=$(aws lambda list-event-source-mappings --function-name golf-ai-analysis-processor --region $REGION --query "EventSourceMappings[?contains(EventSourceArn, 'golf-coach-ai-analysis-queue')]" --output json 2>/dev/null || echo "[]")
if [[ "$(echo "$AI_MAPPINGS" | jq '. | length')" -gt 0 ]]; then
    MAPPING_STATE=$(echo "$AI_MAPPINGS" | jq -r '.[0].State')
    check_passed "AI Processor SQS trigger exists ($MAPPING_STATE)"
else
    check_failed "AI Processor SQS trigger not found"
fi

# =============================================================================
# 7. DynamoDB Table Check
# =============================================================================
print_header "DynamoDB Table"

if aws dynamodb describe-table --table-name golf-coach-analyses --region $REGION &> /dev/null; then
    TABLE_STATUS=$(aws dynamodb describe-table --table-name golf-coach-analyses --region $REGION --query "Table.TableStatus" --output text)
    check_passed "DynamoDB table 'golf-coach-analyses' exists ($TABLE_STATUS)"
else
    check_failed "DynamoDB table 'golf-coach-analyses' not found"
fi

# =============================================================================
# 8. S3 Bucket Check
# =============================================================================
print_header "S3 Bucket"

if aws s3 ls s3://golf-coach-videos-1753203601/ &> /dev/null; then
    check_passed "S3 bucket 'golf-coach-videos-1753203601' is accessible"
else
    check_failed "S3 bucket 'golf-coach-videos-1753203601' not accessible"
fi

# =============================================================================
# 9. Dead Letter Queue Check
# =============================================================================
print_header "Dead Letter Queues"

FRAME_DLQ_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionDLQURL'].OutputValue" --output text 2>/dev/null || echo "")
AI_DLQ_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisDLQURL'].OutputValue" --output text 2>/dev/null || echo "")

if [[ -n "$FRAME_DLQ_URL" ]]; then
    FRAME_DLQ_MESSAGES=$(aws sqs get-queue-attributes --queue-url "$FRAME_DLQ_URL" --attribute-names ApproximateNumberOfMessages --region $REGION --query "Attributes.ApproximateNumberOfMessages" --output text 2>/dev/null || echo "unknown")
    check_passed "Frame Extraction DLQ accessible (Messages: $FRAME_DLQ_MESSAGES)"
    
    if [[ "$FRAME_DLQ_MESSAGES" != "0" && "$FRAME_DLQ_MESSAGES" != "unknown" ]]; then
        check_warning "Frame Extraction DLQ has $FRAME_DLQ_MESSAGES messages"
    fi
fi

if [[ -n "$AI_DLQ_URL" ]]; then
    AI_DLQ_MESSAGES=$(aws sqs get-queue-attributes --queue-url "$AI_DLQ_URL" --attribute-names ApproximateNumberOfMessages --region $REGION --query "Attributes.ApproximateNumberOfMessages" --output text 2>/dev/null || echo "unknown")
    check_passed "AI Analysis DLQ accessible (Messages: $AI_DLQ_MESSAGES)"
    
    if [[ "$AI_DLQ_MESSAGES" != "0" && "$AI_DLQ_MESSAGES" != "unknown" ]]; then
        check_warning "AI Analysis DLQ has $AI_DLQ_MESSAGES messages"
    fi
fi

# =============================================================================
# Summary
# =============================================================================
print_header "Summary"

echo ""
print_info "Checks Passed: $CHECKS_PASSED"
if [[ $WARNINGS -gt 0 ]]; then
    print_info "Warnings: $WARNINGS"
fi
if [[ $CHECKS_FAILED -gt 0 ]]; then
    print_info "Checks Failed: $CHECKS_FAILED"
fi

echo ""
if [[ $CHECKS_FAILED -eq 0 ]]; then
    print_success "All critical checks passed! Pipeline is ready for testing."
    
    if [[ $WARNINGS -gt 0 ]]; then
        print_warning "Please review warnings above before proceeding."
    fi
    
    echo ""
    print_info "Next steps:"
    echo "1. Run: ./queue-monitoring-setup.sh"
    echo "2. Run: ./end-to-end-test.sh"
    exit 0
else
    print_error "Some checks failed. Please fix issues before testing."
    echo ""
    print_info "Common fixes:"
    echo "1. Deploy missing Lambda functions"
    echo "2. Set missing environment variables"
    echo "3. Create missing SQS event source mappings"
    exit 1
fi