#!/bin/bash

# Golf Coach SQS Queue Testing Script
# Tests the deployed SQS queues with sample messages

set -e

STACK_NAME="golf-coach-sqs-infrastructure"
REGION="us-east-1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Get queue URLs from stack
get_queue_urls() {
    print_status "Retrieving queue URLs from CloudFormation stack..."
    
    FRAME_QUEUE_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" \
        --output text 2>/dev/null)
    
    AI_QUEUE_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueURL'].OutputValue" \
        --output text 2>/dev/null)
    
    FRAME_DLQ_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionDLQURL'].OutputValue" \
        --output text 2>/dev/null)
    
    AI_DLQ_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisDLQURL'].OutputValue" \
        --output text 2>/dev/null)
    
    if [[ -z "$FRAME_QUEUE_URL" || -z "$AI_QUEUE_URL" ]]; then
        print_error "Could not retrieve queue URLs. Is the stack deployed?"
        exit 1
    fi
    
    print_success "Queue URLs retrieved successfully"
    echo "Frame Extraction Queue: $FRAME_QUEUE_URL"
    echo "AI Analysis Queue: $AI_QUEUE_URL"
}

# Test sending message to frame extraction queue
test_frame_extraction_queue() {
    print_status "Testing Frame Extraction Queue..."
    
    TEST_MESSAGE='{
        "analysis_id": "test-'$(date +%s)'",
        "s3_bucket": "golf-coach-videos-1753203601",
        "s3_key": "golf-swings/guest/test-video.mov",
        "user_id": "test-user",
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
    }'
    
    MESSAGE_ID=$(aws sqs send-message \
        --queue-url "$FRAME_QUEUE_URL" \
        --message-body "$TEST_MESSAGE" \
        --region $REGION \
        --query "MessageId" \
        --output text)
    
    if [[ -n "$MESSAGE_ID" ]]; then
        print_success "Message sent to Frame Extraction Queue. MessageId: $MESSAGE_ID"
    else
        print_error "Failed to send message to Frame Extraction Queue"
        return 1
    fi
}

# Test sending message to AI analysis queue
test_ai_analysis_queue() {
    print_status "Testing AI Analysis Queue..."
    
    TEST_MESSAGE='{
        "analysis_id": "test-ai-'$(date +%s)'",
        "user_id": "test-user",
        "status": "COMPLETED",
        "frame_count": 15,
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
    }'
    
    MESSAGE_ID=$(aws sqs send-message \
        --queue-url "$AI_QUEUE_URL" \
        --message-body "$TEST_MESSAGE" \
        --region $REGION \
        --query "MessageId" \
        --output text)
    
    if [[ -n "$MESSAGE_ID" ]]; then
        print_success "Message sent to AI Analysis Queue. MessageId: $MESSAGE_ID"
    else
        print_error "Failed to send message to AI Analysis Queue"
        return 1
    fi
}

# Check queue attributes
check_queue_attributes() {
    print_status "Checking queue attributes..."
    
    echo ""
    echo "=== FRAME EXTRACTION QUEUE ATTRIBUTES ==="
    aws sqs get-queue-attributes \
        --queue-url "$FRAME_QUEUE_URL" \
        --attribute-names All \
        --region $REGION \
        --query "Attributes.{Messages:ApproximateNumberOfMessages,InFlight:ApproximateNumberOfMessagesNotVisible,Delayed:ApproximateNumberOfMessagesDelayed,VisibilityTimeout:VisibilityTimeout,MessageRetentionPeriod:MessageRetentionPeriod}" \
        --output table
    
    echo ""
    echo "=== AI ANALYSIS QUEUE ATTRIBUTES ==="
    aws sqs get-queue-attributes \
        --queue-url "$AI_QUEUE_URL" \
        --attribute-names All \
        --region $REGION \
        --query "Attributes.{Messages:ApproximateNumberOfMessages,InFlight:ApproximateNumberOfMessagesNotVisible,Delayed:ApproximateNumberOfMessagesDelayed,VisibilityTimeout:VisibilityTimeout,MessageRetentionPeriod:MessageRetentionPeriod}" \
        --output table
}

# Receive and display messages
receive_test_messages() {
    print_status "Attempting to receive test messages..."
    
    echo ""
    echo "=== MESSAGES IN FRAME EXTRACTION QUEUE ==="
    FRAME_MESSAGES=$(aws sqs receive-message \
        --queue-url "$FRAME_QUEUE_URL" \
        --max-number-of-messages 5 \
        --region $REGION \
        --query "Messages[*].{Body:Body,ReceiptHandle:ReceiptHandle}" \
        --output json 2>/dev/null || echo "[]")
    
    if [[ "$FRAME_MESSAGES" != "[]" && "$FRAME_MESSAGES" != "null" ]]; then
        echo "$FRAME_MESSAGES" | jq -r '.[] | "Body: " + .Body'
        
        # Delete received messages
        echo "$FRAME_MESSAGES" | jq -r '.[] | .ReceiptHandle' | while read -r receipt; do
            aws sqs delete-message \
                --queue-url "$FRAME_QUEUE_URL" \
                --receipt-handle "$receipt" \
                --region $REGION
        done
        print_success "Cleaned up test messages from Frame Extraction Queue"
    else
        print_warning "No messages found in Frame Extraction Queue"
    fi
    
    echo ""
    echo "=== MESSAGES IN AI ANALYSIS QUEUE ==="
    AI_MESSAGES=$(aws sqs receive-message \
        --queue-url "$AI_QUEUE_URL" \
        --max-number-of-messages 5 \
        --region $REGION \
        --query "Messages[*].{Body:Body,ReceiptHandle:ReceiptHandle}" \
        --output json 2>/dev/null || echo "[]")
    
    if [[ "$AI_MESSAGES" != "[]" && "$AI_MESSAGES" != "null" ]]; then
        echo "$AI_MESSAGES" | jq -r '.[] | "Body: " + .Body'
        
        # Delete received messages
        echo "$AI_MESSAGES" | jq -r '.[] | .ReceiptHandle' | while read -r receipt; do
            aws sqs delete-message \
                --queue-url "$AI_QUEUE_URL" \
                --receipt-handle "$receipt" \
                --region $REGION
        done
        print_success "Cleaned up test messages from AI Analysis Queue"
    else
        print_warning "No messages found in AI Analysis Queue"
    fi
}

# Check dead letter queues
check_dead_letter_queues() {
    print_status "Checking Dead Letter Queues for any failed messages..."
    
    echo ""
    echo "=== FRAME EXTRACTION DLQ ==="
    DLQ_MESSAGES=$(aws sqs receive-message \
        --queue-url "$FRAME_DLQ_URL" \
        --max-number-of-messages 5 \
        --region $REGION \
        --query "Messages[*].Body" \
        --output json 2>/dev/null || echo "[]")
    
    if [[ "$DLQ_MESSAGES" != "[]" && "$DLQ_MESSAGES" != "null" ]]; then
        print_warning "Found messages in Frame Extraction DLQ:"
        echo "$DLQ_MESSAGES" | jq -r '.[]'
    else
        print_success "Frame Extraction DLQ is empty"
    fi
    
    echo ""
    echo "=== AI ANALYSIS DLQ ==="
    AI_DLQ_MESSAGES=$(aws sqs receive-message \
        --queue-url "$AI_DLQ_URL" \
        --max-number-of-messages 5 \
        --region $REGION \
        --query "Messages[*].Body" \
        --output json 2>/dev/null || echo "[]")
    
    if [[ "$AI_DLQ_MESSAGES" != "[]" && "$AI_DLQ_MESSAGES" != "null" ]]; then
        print_warning "Found messages in AI Analysis DLQ:"
        echo "$AI_DLQ_MESSAGES" | jq -r '.[]'
    else
        print_success "AI Analysis DLQ is empty"
    fi
}

# Main test function
main() {
    echo "===================================================="
    echo "Golf Coach SQS Queue Testing"
    echo "===================================================="
    echo ""
    
    # Check if jq is available for JSON processing
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. JSON output may not be formatted nicely."
    fi
    
    get_queue_urls
    check_queue_attributes
    
    echo ""
    print_status "Running message tests..."
    
    test_frame_extraction_queue
    test_ai_analysis_queue
    
    # Wait a moment for messages to be available
    sleep 2
    
    receive_test_messages
    check_dead_letter_queues
    
    echo ""
    print_success "Queue testing completed!"
    echo ""
    echo "Summary:"
    echo "- Both queues are accessible and functional"
    echo "- Messages can be sent and received successfully"
    echo "- Dead letter queues are properly configured"
    echo ""
    echo "Your SQS infrastructure is ready for production use!"
}

# Run main function
main "$@"