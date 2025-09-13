#!/bin/bash

# Golf Coach Pipeline - End-to-End Test
# Comprehensive testing of the queue-based architecture

set -e

REGION="us-east-1"
STACK_NAME="golf-coach-sqs-infrastructure"
TEST_VIDEO_URL="https://sample-videos.com/zip/10/mp4/small.mp4"  # Small test video
TEST_ANALYSIS_ID="e2e-test-$(date +%s)-$(openssl rand -hex 4)"

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

# Check if message exists in queue
check_queue_message() {
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

# Check DynamoDB record status
check_dynamodb_status() {
    local analysis_id="$1"
    local expected_status="$2"
    
    local current_status=$(aws dynamodb get-item \
        --table-name golf-coach-analyses \
        --key "{\"analysis_id\":{\"S\":\"$analysis_id\"}}" \
        --query "Item.status.S" \
        --output text 2>/dev/null || echo "")
    
    [[ "$current_status" == "$expected_status" ]]
}

# Check if frames exist in S3
check_s3_frames() {
    local analysis_id="$1"
    
    local frame_count=$(aws s3 ls s3://golf-coach-videos-1753203601/golf-swings/ --recursive | grep "$analysis_id" | grep "frame_" | wc -l)
    [[ $frame_count -gt 0 ]]
}

echo "=================================================="
echo "Golf Coach Pipeline - End-to-End Test"
echo "=================================================="
echo "Test Analysis ID: $TEST_ANALYSIS_ID"
echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
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

# Download test video
print_info "Downloading test video..."
if curl -s -o test-video.mp4 "$TEST_VIDEO_URL"; then
    print_success "Test video downloaded"
else
    print_warning "Failed to download test video, using existing video"
    # Use an existing video from S3 for testing
    cp "$(ls *.mov 2>/dev/null | head -1)" test-video.mp4 2>/dev/null || {
        print_error "No test video available"
        exit 1
    }
fi

# Create test payload for video upload handler
TEST_PAYLOAD=$(cat << EOF
{
    "s3_bucket": "golf-coach-videos-1753203601",
    "s3_key": "golf-swings/guest/$TEST_ANALYSIS_ID.mp4",
    "analysis_id": "$TEST_ANALYSIS_ID",
    "user_id": "guest-user"
}
EOF
)

echo "$TEST_PAYLOAD" > test-payload.json

# =============================================================================
# Phase 1: Video Upload Handler Test
# =============================================================================
print_header "Phase 1: Video Upload Handler"

# Upload test video to S3 first
print_info "Uploading test video to S3..."
if aws s3 cp test-video.mp4 "s3://golf-coach-videos-1753203601/golf-swings/guest/$TEST_ANALYSIS_ID.mp4" --region $REGION; then
    add_test_result "S3_UPLOAD" "PASS" "Test video uploaded successfully"
else
    add_test_result "S3_UPLOAD" "FAIL" "Failed to upload test video to S3"
    exit 1
fi

# Test video upload handler
print_info "Testing video upload handler..."
UPLOAD_RESPONSE=$(aws lambda invoke \
    --function-name golf-video-upload-handler \
    --payload file://test-payload.json \
    --region $REGION \
    upload-response.json 2>&1)

UPLOAD_STATUS_CODE=$(echo "$UPLOAD_RESPONSE" | jq -r '.StatusCode // "unknown"')

if [[ "$UPLOAD_STATUS_CODE" == "200" ]]; then
    add_test_result "UPLOAD_HANDLER" "PASS" "Video upload handler executed successfully"
else
    add_test_result "UPLOAD_HANDLER" "FAIL" "Video upload handler failed (StatusCode: $UPLOAD_STATUS_CODE)"
fi

# Check if message was sent to frame extraction queue
print_info "Checking frame extraction queue for message..."
if wait_for_condition "check_queue_message '$FRAME_QUEUE_URL' '$TEST_ANALYSIS_ID'" 30 "Message in frame extraction queue"; then
    add_test_result "FRAME_QUEUE_MESSAGE" "PASS" "Message found in frame extraction queue"
else
    add_test_result "FRAME_QUEUE_MESSAGE" "FAIL" "No message found in frame extraction queue"
fi

# Check DynamoDB record creation
if wait_for_condition "check_dynamodb_status '$TEST_ANALYSIS_ID' 'PROCESSING'" 30 "DynamoDB record created"; then
    add_test_result "DYNAMODB_CREATED" "PASS" "DynamoDB record created with PROCESSING status"
else
    add_test_result "DYNAMODB_CREATED" "FAIL" "DynamoDB record not created or wrong status"
fi

# =============================================================================
# Phase 2: Frame Extraction Test
# =============================================================================
print_header "Phase 2: Frame Extraction"

# Wait for frame extraction to complete
print_info "Waiting for frame extraction to complete..."
if wait_for_condition "check_dynamodb_status '$TEST_ANALYSIS_ID' 'COMPLETED'" 120 "Frame extraction completion"; then
    add_test_result "FRAME_EXTRACTION" "PASS" "Frame extraction completed"
    
    # Check if frames were created in S3
    if wait_for_condition "check_s3_frames '$TEST_ANALYSIS_ID'" 30 "Frames in S3"; then
        FRAME_COUNT=$(aws s3 ls s3://golf-coach-videos-1753203601/golf-swings/ --recursive | grep "$TEST_ANALYSIS_ID" | grep "frame_" | wc -l)
        add_test_result "S3_FRAMES" "PASS" "Created $FRAME_COUNT frames in S3"
    else
        add_test_result "S3_FRAMES" "FAIL" "No frames found in S3"
    fi
else
    add_test_result "FRAME_EXTRACTION" "FAIL" "Frame extraction did not complete within timeout"
fi

# Check if message was sent to AI analysis queue
print_info "Checking AI analysis queue for message..."
if wait_for_condition "check_queue_message '$AI_QUEUE_URL' '$TEST_ANALYSIS_ID'" 30 "Message in AI analysis queue"; then
    add_test_result "AI_QUEUE_MESSAGE" "PASS" "Message found in AI analysis queue"
else
    add_test_result "AI_QUEUE_MESSAGE" "FAIL" "No message found in AI analysis queue"
fi

# =============================================================================
# Phase 3: AI Analysis Test
# =============================================================================
print_header "Phase 3: AI Analysis"

# Wait for AI analysis to complete
print_info "Waiting for AI analysis to complete..."

# Check for AI analysis completion (this may take longer)
ai_completed=false
for i in {1..20}; do  # 20 * 15 = 5 minutes max
    AI_STATUS=$(aws dynamodb get-item \
        --table-name golf-coach-analyses \
        --key "{\"analysis_id\":{\"S\":\"$TEST_ANALYSIS_ID\"}}" \
        --query "Item.ai_analysis_completed.BOOL" \
        --output text 2>/dev/null || echo "false")
    
    if [[ "$AI_STATUS" == "true" ]]; then
        ai_completed=true
        break
    fi
    
    echo -n "."
    sleep 15
done

echo ""

if [[ "$ai_completed" == "true" ]]; then
    add_test_result "AI_ANALYSIS" "PASS" "AI analysis completed successfully"
    
    # Check for analysis results
    ANALYSIS_RESULTS=$(aws dynamodb get-item \
        --table-name golf-coach-analyses \
        --key "{\"analysis_id\":{\"S\":\"$TEST_ANALYSIS_ID\"}}" \
        --query "Item.analysis_results" \
        --output json 2>/dev/null || echo "{}")
    
    if [[ "$ANALYSIS_RESULTS" != "{}" && "$ANALYSIS_RESULTS" != "null" ]]; then
        add_test_result "AI_RESULTS" "PASS" "AI analysis results saved to DynamoDB"
    else
        add_test_result "AI_RESULTS" "FAIL" "No AI analysis results found"
    fi
else
    add_test_result "AI_ANALYSIS" "FAIL" "AI analysis did not complete within timeout"
fi

# =============================================================================
# Phase 4: Dead Letter Queue Check
# =============================================================================
print_header "Phase 4: Dead Letter Queue Check"

# Check frame extraction DLQ
FRAME_DLQ_MESSAGES=$(aws sqs get-queue-attributes \
    --queue-url "$FRAME_DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --region $REGION \
    --query "Attributes.ApproximateNumberOfMessages" \
    --output text 2>/dev/null || echo "0")

if [[ "$FRAME_DLQ_MESSAGES" == "0" ]]; then
    add_test_result "FRAME_DLQ_EMPTY" "PASS" "Frame extraction DLQ is empty"
else
    add_test_result "FRAME_DLQ_EMPTY" "FAIL" "Frame extraction DLQ has $FRAME_DLQ_MESSAGES messages"
fi

# Check AI analysis DLQ
AI_DLQ_MESSAGES=$(aws sqs get-queue-attributes \
    --queue-url "$AI_DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --region $REGION \
    --query "Attributes.ApproximateNumberOfMessages" \
    --output text 2>/dev/null || echo "0")

if [[ "$AI_DLQ_MESSAGES" == "0" ]]; then
    add_test_result "AI_DLQ_EMPTY" "PASS" "AI analysis DLQ is empty"
else
    add_test_result "AI_DLQ_EMPTY" "FAIL" "AI analysis DLQ has $AI_DLQ_MESSAGES messages"
fi

# =============================================================================
# Phase 5: Performance Metrics
# =============================================================================
print_header "Phase 5: Performance Metrics"

# Get timing information from CloudWatch
END_TIME=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
START_TIME=$(date -u -d '10 minutes ago' '+%Y-%m-%dT%H:%M:%S.000Z')

for FUNCTION in "golf-video-upload-handler" "golf-frame-extractor-simple-with-ai" "golf-ai-analysis-processor"; do
    DURATION=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Duration \
        --dimensions Name=FunctionName,Value=$FUNCTION \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 600 \
        --statistics Average \
        --region $REGION \
        --query "Datapoints[0].Average" \
        --output text 2>/dev/null || echo "N/A")
    
    if [[ "$DURATION" != "N/A" && "$DURATION" != "None" ]]; then
        print_info "$FUNCTION average duration: ${DURATION}ms"
    fi
done

# =============================================================================
# Cleanup and Summary
# =============================================================================
print_header "Cleanup"

# Clean up test files
rm -f test-video.mp4 test-payload.json upload-response.json

# Optionally clean up test data from S3 and DynamoDB
print_info "Cleaning up test data..."
aws s3 rm "s3://golf-coach-videos-1753203601/golf-swings/guest/$TEST_ANALYSIS_ID.mp4" --region $REGION 2>/dev/null || true
aws s3 rm "s3://golf-coach-videos-1753203601/golf-swings/guest-user/$TEST_ANALYSIS_ID/" --recursive --region $REGION 2>/dev/null || true

# Note: Keep DynamoDB record for analysis

# =============================================================================
# Test Summary
# =============================================================================
print_header "Test Summary"

echo ""
print_info "Test completed at: $(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
print_info "Analysis ID: $TEST_ANALYSIS_ID"
print_info "Tests Passed: $PASSED_TESTS"
print_info "Tests Failed: $FAILED_TESTS"

echo ""
echo "=== Detailed Results ==="
for result in "${TEST_RESULTS[@]}"; do
    IFS='|' read -r test_name status details <<< "$result"
    printf "%-25s %-6s %s\n" "$test_name" "$status" "$details"
done

echo ""
if [[ $FAILED_TESTS -eq 0 ]]; then
    print_success "🎉 All tests passed! Queue-based pipeline is working correctly."
    echo ""
    print_info "Pipeline performance validated:"
    print_info "✅ Video upload handler → SQS queue"
    print_info "✅ SQS queue → Frame extractor"
    print_info "✅ Frame extractor → S3 frames"
    print_info "✅ Frame extractor → AI analysis queue"
    print_info "✅ AI analysis queue → AI processor"
    print_info "✅ AI processor → DynamoDB results"
    echo ""
    print_info "Next steps:"
    echo "1. Run performance baseline: ./performance-baseline.sh"
    echo "2. Run failure tests: ./failure-testing.sh"
    echo "3. Monitor dashboard: CloudWatch Golf Coach Dashboard"
    exit 0
else
    print_error "Some tests failed. Please investigate and fix issues."
    echo ""
    print_info "Troubleshooting steps:"
    echo "1. Check CloudWatch logs for error details"
    echo "2. Verify queue permissions and triggers"
    echo "3. Check environment variables"
    echo "4. Review troubleshooting guide"
    exit 1
fi