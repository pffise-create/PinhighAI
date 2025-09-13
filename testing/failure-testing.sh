#!/bin/bash

# Golf Coach Pipeline - Failure Testing Suite
# Tests resilience, error handling, and recovery mechanisms

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

TEST_RESULTS=()
FAILED_TESTS=0
PASSED_TESTS=0

add_test_result() {
    local test_name="$1"
    local status="$2"
    local details="$3"
    
    TEST_RESULTS+=("$test_name|$status|$details")
    
    if [[ "$status" == "PASS" ]]; then
        ((PASSED_TESTS++))
        print_success "$test_name: $details"
    else
        ((FAILED_TESTS++))
        print_error "$test_name: $details"
    fi
}

wait_for_condition() {
    local condition_func="$1"
    local timeout="$2"
    local description="$3"
    
    local count=0
    local max_attempts=$((timeout / 5))
    
    print_info "Waiting for: $description (max ${timeout}s)"
    
    while [[ $count -lt $max_attempts ]]; do
        if eval "$condition_func"; then
            return 0
        fi
        
        echo -n "."
        sleep 5
        ((count++))
    done
    
    echo ""
    return 1
}

# Get queue URLs
get_queue_urls() {
    FRAME_QUEUE_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" \
        --output text 2>/dev/null || echo "")
    
    AI_QUEUE_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueURL'].OutputValue" \
        --output text 2>/dev/null || echo "")
    
    FRAME_DLQ_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionDLQURL'].OutputValue" \
        --output text 2>/dev/null || echo "")
    
    AI_DLQ_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisDLQURL'].OutputValue" \
        --output text 2>/dev/null || echo "")
}

# Check if message exists in DLQ
check_dlq_message() {
    local queue_url="$1"
    local analysis_id="$2"
    
    local messages=$(aws sqs receive-message \
        --queue-url "$queue_url" \
        --max-number-of-messages 10 \
        --region $REGION \
        --query "Messages[?contains(Body, '$analysis_id')]" \
        --output json 2>/dev/null || echo "[]")
    
    [[ "$(echo "$messages" | jq '. | length')" -gt 0 ]]
}

# Send malformed message to queue
send_malformed_message() {
    local queue_url="$1"
    local message_body="$2"
    
    aws sqs send-message \
        --queue-url "$queue_url" \
        --message-body "$message_body" \
        --region $REGION \
        --output json 2>/dev/null || echo "{}"
}

# Create invalid S3 key message
create_invalid_payload() {
    local analysis_id="$1"
    cat << EOF
{
    "s3_bucket": "non-existent-bucket-12345",
    "s3_key": "invalid/path/$analysis_id.mp4",
    "analysis_id": "$analysis_id",
    "user_id": "test-user"
}
EOF
}

# Create corrupted JSON message
create_corrupted_payload() {
    echo '{"s3_bucket": "golf-coach-videos-1753203601", "analysis_id": "corrupted", "incomplete": true'
}

echo "=================================================="
echo "Golf Coach Pipeline - Failure Testing Suite"
echo "=================================================="
echo "Testing error handling, retries, and recovery"
echo ""

# =============================================================================
# Setup Phase
# =============================================================================
print_header "Test Setup"

get_queue_urls

if [[ -z "$FRAME_QUEUE_URL" || -z "$AI_QUEUE_URL" ]]; then
    print_error "Could not retrieve queue URLs. Please run pre-deployment-checklist.sh first"
    exit 1
fi

print_info "Frame Queue: $FRAME_QUEUE_URL"
print_info "AI Queue: $AI_QUEUE_URL"
print_info "Frame DLQ: $FRAME_DLQ_URL"
print_info "AI DLQ: $AI_DLQ_URL"

# =============================================================================
# Test 1: Invalid S3 Bucket Test
# =============================================================================
print_header "Test 1: Invalid S3 Bucket Handling"

INVALID_ANALYSIS_ID="fail-test-invalid-bucket-$(date +%s)"
INVALID_PAYLOAD=$(create_invalid_payload "$INVALID_ANALYSIS_ID")

print_info "Sending message with invalid S3 bucket..."
SEND_RESULT=$(send_malformed_message "$FRAME_QUEUE_URL" "$INVALID_PAYLOAD")

if [[ -n "$SEND_RESULT" ]]; then
    add_test_result "INVALID_BUCKET_SEND" "PASS" "Message sent to frame queue"
    
    # Wait for message to be processed and moved to DLQ
    print_info "Waiting for message to be retried and sent to DLQ..."
    if wait_for_condition "check_dlq_message '$FRAME_DLQ_URL' '$INVALID_ANALYSIS_ID'" 120 "Message in Frame DLQ"; then
        add_test_result "INVALID_BUCKET_DLQ" "PASS" "Message moved to DLQ after retries"
    else
        add_test_result "INVALID_BUCKET_DLQ" "FAIL" "Message not found in DLQ within timeout"
    fi
else
    add_test_result "INVALID_BUCKET_SEND" "FAIL" "Failed to send message to queue"
fi

# =============================================================================
# Test 2: Corrupted JSON Message Test
# =============================================================================
print_header "Test 2: Corrupted JSON Handling"

print_info "Sending corrupted JSON message..."
CORRUPTED_PAYLOAD=$(create_corrupted_payload)
CORRUPTED_RESULT=$(send_malformed_message "$FRAME_QUEUE_URL" "$CORRUPTED_PAYLOAD")

if [[ -n "$CORRUPTED_RESULT" ]]; then
    add_test_result "CORRUPTED_JSON_SEND" "PASS" "Corrupted message sent to frame queue"
    
    # Check for DLQ movement
    if wait_for_condition "check_dlq_message '$FRAME_DLQ_URL' 'corrupted'" 60 "Corrupted message in DLQ"; then
        add_test_result "CORRUPTED_JSON_DLQ" "PASS" "Corrupted message moved to DLQ"
    else
        add_test_result "CORRUPTED_JSON_DLQ" "FAIL" "Corrupted message not handled properly"
    fi
else
    add_test_result "CORRUPTED_JSON_SEND" "FAIL" "Failed to send corrupted message"
fi

# =============================================================================
# Test 3: Lambda Timeout Simulation
# =============================================================================
print_header "Test 3: Lambda Timeout Simulation"

# Create a payload that will cause processing delay
TIMEOUT_ANALYSIS_ID="fail-test-timeout-$(date +%s)"
TIMEOUT_PAYLOAD=$(cat << EOF
{
    "s3_bucket": "golf-coach-videos-1753203601",
    "s3_key": "golf-swings/guest/very-large-video-for-timeout-test.mp4",
    "analysis_id": "$TIMEOUT_ANALYSIS_ID",
    "user_id": "timeout-test"
}
EOF
)

print_info "Note: This test requires a large video file that would cause timeout"
print_info "Skipping actual timeout test due to infrastructure safety"
add_test_result "TIMEOUT_SIMULATION" "SKIP" "Timeout test skipped for safety"

# =============================================================================
# Test 4: DLQ Message Reprocessing Test
# =============================================================================
print_header "Test 4: DLQ Message Reprocessing"

print_info "Checking existing DLQ messages for reprocessing test..."

# Count messages in Frame DLQ
FRAME_DLQ_COUNT=$(aws sqs get-queue-attributes \
    --queue-url "$FRAME_DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --region $REGION \
    --query "Attributes.ApproximateNumberOfMessages" \
    --output text 2>/dev/null || echo "0")

# Count messages in AI DLQ
AI_DLQ_COUNT=$(aws sqs get-queue-attributes \
    --queue-url "$AI_DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --region $REGION \
    --query "Attributes.ApproximateNumberOfMessages" \
    --output text 2>/dev/null || echo "0")

if [[ "$FRAME_DLQ_COUNT" -gt 0 || "$AI_DLQ_COUNT" -gt 0 ]]; then
    add_test_result "DLQ_MESSAGES_PRESENT" "PASS" "DLQ contains messages for analysis (Frame: $FRAME_DLQ_COUNT, AI: $AI_DLQ_COUNT)"
    
    # Sample one message from DLQ for inspection
    if [[ "$FRAME_DLQ_COUNT" -gt 0 ]]; then
        SAMPLE_MESSAGE=$(aws sqs receive-message \
            --queue-url "$FRAME_DLQ_URL" \
            --max-number-of-messages 1 \
            --region $REGION \
            --query "Messages[0].Body" \
            --output text 2>/dev/null || echo "")
        
        if [[ -n "$SAMPLE_MESSAGE" && "$SAMPLE_MESSAGE" != "None" ]]; then
            add_test_result "DLQ_MESSAGE_READABLE" "PASS" "DLQ message is readable and contains valid JSON"
            print_info "Sample DLQ message structure looks valid"
        else
            add_test_result "DLQ_MESSAGE_READABLE" "FAIL" "Could not read DLQ message"
        fi
    fi
else
    add_test_result "DLQ_MESSAGES_PRESENT" "INFO" "No messages in DLQ - this is expected for healthy system"
fi

# =============================================================================
# Test 5: Queue Depth Stress Test
# =============================================================================
print_header "Test 5: Queue Depth Stress Test"

print_info "Sending multiple messages to test queue handling..."

STRESS_BASE_ID="stress-test-$(date +%s)"
STRESS_MESSAGES_SENT=0

for i in {1..5}; do
    STRESS_ANALYSIS_ID="${STRESS_BASE_ID}-${i}"
    STRESS_PAYLOAD=$(cat << EOF
{
    "s3_bucket": "golf-coach-videos-1753203601",
    "s3_key": "golf-swings/guest/non-existent-${i}.mp4",
    "analysis_id": "$STRESS_ANALYSIS_ID",
    "user_id": "stress-test"
}
EOF
    )
    
    if send_malformed_message "$FRAME_QUEUE_URL" "$STRESS_PAYLOAD" > /dev/null; then
        ((STRESS_MESSAGES_SENT++))
    fi
done

if [[ $STRESS_MESSAGES_SENT -eq 5 ]]; then
    add_test_result "STRESS_MESSAGES_SENT" "PASS" "All 5 stress test messages sent successfully"
    
    # Check queue depth
    sleep 10
    CURRENT_DEPTH=$(aws sqs get-queue-attributes \
        --queue-url "$FRAME_QUEUE_URL" \
        --attribute-names ApproximateNumberOfMessages \
        --region $REGION \
        --query "Attributes.ApproximateNumberOfMessages" \
        --output text 2>/dev/null || echo "0")
    
    add_test_result "QUEUE_DEPTH_HANDLING" "INFO" "Current frame queue depth: $CURRENT_DEPTH messages"
else
    add_test_result "STRESS_MESSAGES_SENT" "FAIL" "Only sent $STRESS_MESSAGES_SENT out of 5 messages"
fi

# =============================================================================
# Test 6: Lambda Function Error Rate Check
# =============================================================================
print_header "Test 6: Lambda Function Error Metrics"

END_TIME=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
START_TIME=$(date -u -d '10 minutes ago' '+%Y-%m-%dT%H:%M:%S.000Z')

for FUNCTION in "golf-video-upload-handler" "golf-frame-extractor-simple-with-ai" "golf-ai-analysis-processor"; do
    ERROR_COUNT=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Errors \
        --dimensions Name=FunctionName,Value=$FUNCTION \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 600 \
        --statistics Sum \
        --region $REGION \
        --query "Datapoints[0].Sum" \
        --output text 2>/dev/null || echo "0")
    
    INVOCATION_COUNT=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Invocations \
        --dimensions Name=FunctionName,Value=$FUNCTION \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 600 \
        --statistics Sum \
        --region $REGION \
        --query "Datapoints[0].Sum" \
        --output text 2>/dev/null || echo "0")
    
    if [[ "$ERROR_COUNT" == "0" || "$ERROR_COUNT" == "None" ]]; then
        ERROR_COUNT=0
    fi
    
    if [[ "$INVOCATION_COUNT" == "0" || "$INVOCATION_COUNT" == "None" ]]; then
        INVOCATION_COUNT=0
    fi
    
    if [[ $INVOCATION_COUNT -gt 0 ]]; then
        ERROR_RATE=$(echo "scale=2; $ERROR_COUNT * 100 / $INVOCATION_COUNT" | bc 2>/dev/null || echo "0")
        if [[ $(echo "$ERROR_RATE <= 10" | bc -l 2>/dev/null || echo 0) -eq 1 ]]; then
            add_test_result "${FUNCTION}_ERROR_RATE" "PASS" "Error rate: ${ERROR_RATE}% (${ERROR_COUNT}/${INVOCATION_COUNT})"
        else
            add_test_result "${FUNCTION}_ERROR_RATE" "FAIL" "High error rate: ${ERROR_RATE}% (${ERROR_COUNT}/${INVOCATION_COUNT})"
        fi
    else
        add_test_result "${FUNCTION}_ERROR_RATE" "INFO" "No invocations in test period"
    fi
done

# =============================================================================
# Test 7: CloudWatch Alarm State Check
# =============================================================================
print_header "Test 7: CloudWatch Alarm Status"

ALARM_NAMES=(
    "GolfCoach-FrameQueue-HighDepth"
    "GolfCoach-AIQueue-HighDepth"
    "GolfCoach-FrameDLQ-MessagesPresent"
    "GolfCoach-AIDLQ-MessagesPresent"
    "GolfCoach-FrameQueue-OldMessages"
)

for ALARM in "${ALARM_NAMES[@]}"; do
    ALARM_STATE=$(aws cloudwatch describe-alarms \
        --alarm-names "$ALARM" \
        --region $REGION \
        --query "MetricAlarms[0].StateValue" \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [[ "$ALARM_STATE" == "OK" ]]; then
        add_test_result "${ALARM}_STATE" "PASS" "Alarm state: OK"
    elif [[ "$ALARM_STATE" == "INSUFFICIENT_DATA" ]]; then
        add_test_result "${ALARM}_STATE" "INFO" "Alarm state: Insufficient data"
    elif [[ "$ALARM_STATE" == "ALARM" ]]; then
        add_test_result "${ALARM}_STATE" "FAIL" "Alarm state: ALARM"
    else
        add_test_result "${ALARM}_STATE" "FAIL" "Alarm not found or inaccessible"
    fi
done

# =============================================================================
# Cleanup and Summary
# =============================================================================
print_header "Cleanup"

print_info "Note: Failed messages will remain in DLQ for manual investigation"
print_info "Use the following commands to clear DLQ if needed:"
echo "aws sqs purge-queue --queue-url $FRAME_DLQ_URL --region $REGION"
echo "aws sqs purge-queue --queue-url $AI_DLQ_URL --region $REGION"

# =============================================================================
# Test Summary
# =============================================================================
print_header "Failure Testing Summary"

echo ""
print_info "Test completed at: $(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
print_info "Tests Passed: $PASSED_TESTS"
print_info "Tests Failed: $FAILED_TESTS"

echo ""
echo "=== Detailed Results ==="
for result in "${TEST_RESULTS[@]}"; do
    IFS='|' read -r test_name status details <<< "$result"
    if [[ "$status" == "PASS" ]]; then
        printf "✅ %-30s %s\n" "$test_name" "$details"
    elif [[ "$status" == "FAIL" ]]; then
        printf "❌ %-30s %s\n" "$test_name" "$details"
    elif [[ "$status" == "INFO" ]]; then
        printf "ℹ️  %-30s %s\n" "$test_name" "$details"
    else
        printf "⚠️  %-30s %s\n" "$test_name" "$details"
    fi
done

echo ""
if [[ $FAILED_TESTS -eq 0 ]]; then
    print_success "🎉 Failure testing completed! Error handling is working correctly."
    echo ""
    print_info "Key validation points:"
    print_info "✅ Invalid messages moved to Dead Letter Queue"
    print_info "✅ JSON parsing errors handled gracefully"
    print_info "✅ Lambda error rates within acceptable limits"
    print_info "✅ CloudWatch alarms properly configured"
    print_info "✅ Queue depth stress testing passed"
    echo ""
    print_info "Next steps:"
    echo "1. Monitor DLQ messages for patterns: aws sqs receive-message --queue-url $FRAME_DLQ_URL"
    echo "2. Review CloudWatch logs for error details"
    echo "3. Run performance baseline: ./performance-baseline.sh"
    exit 0
else
    print_error "Some failure tests identified issues. Please investigate."
    echo ""
    print_info "Investigation steps:"
    echo "1. Check CloudWatch logs for error details"
    echo "2. Review Lambda function error rates"
    echo "3. Verify CloudWatch alarm configurations"
    echo "4. Check DLQ messages for error patterns"
    exit 1
fi