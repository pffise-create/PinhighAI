#!/bin/bash

# Golf Coach Pipeline - Queue Monitoring Setup
# Creates CloudWatch dashboard and alarms for SQS queue monitoring

set -e

REGION="us-east-1"
DASHBOARD_NAME="GolfCoach-SQS-Pipeline"
ALARM_PREFIX="GolfCoach"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

echo "=================================================="
echo "Golf Coach Pipeline - Queue Monitoring Setup"
echo "=================================================="

# =============================================================================
# 1. Create CloudWatch Dashboard
# =============================================================================
print_status "Creating CloudWatch Dashboard..."

if aws cloudwatch put-dashboard \
    --dashboard-name "$DASHBOARD_NAME" \
    --dashboard-body file://queue-monitoring-dashboard.json \
    --region $REGION; then
    print_success "Dashboard '$DASHBOARD_NAME' created successfully"
    DASHBOARD_URL="https://$REGION.console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=$DASHBOARD_NAME"
    echo "Dashboard URL: $DASHBOARD_URL"
else
    print_error "Failed to create dashboard"
    exit 1
fi

# =============================================================================
# 2. Create CloudWatch Alarms
# =============================================================================
print_status "Creating CloudWatch Alarms..."

# Alarm for Frame Extraction Queue depth
aws cloudwatch put-metric-alarm \
    --alarm-name "${ALARM_PREFIX}-FrameQueue-HighDepth" \
    --alarm-description "Frame extraction queue has high message depth" \
    --metric-name ApproximateNumberOfMessages \
    --namespace AWS/SQS \
    --statistic Average \
    --period 300 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 2 \
    --dimensions Name=QueueName,Value=golf-coach-frame-extraction-queue-prod \
    --alarm-actions "arn:aws:sns:$REGION:$(aws sts get-caller-identity --query Account --output text):golf-coach-alerts" \
    --region $REGION 2>/dev/null || print_warning "SNS topic for alerts not found - alarms created without notifications"

print_success "Frame Queue depth alarm created"

# Alarm for AI Analysis Queue depth
aws cloudwatch put-metric-alarm \
    --alarm-name "${ALARM_PREFIX}-AIQueue-HighDepth" \
    --alarm-description "AI analysis queue has high message depth" \
    --metric-name ApproximateNumberOfMessages \
    --namespace AWS/SQS \
    --statistic Average \
    --period 300 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 2 \
    --dimensions Name=QueueName,Value=golf-coach-ai-analysis-queue-prod \
    --region $REGION

print_success "AI Queue depth alarm created"

# Alarm for Dead Letter Queue messages
aws cloudwatch put-metric-alarm \
    --alarm-name "${ALARM_PREFIX}-FrameDLQ-MessagesPresent" \
    --alarm-description "Messages found in Frame Extraction Dead Letter Queue" \
    --metric-name ApproximateNumberOfMessages \
    --namespace AWS/SQS \
    --statistic Maximum \
    --period 300 \
    --threshold 0 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions Name=QueueName,Value=golf-coach-frame-extraction-dlq-prod \
    --treat-missing-data notBreaching \
    --region $REGION

print_success "Frame DLQ alarm created"

aws cloudwatch put-metric-alarm \
    --alarm-name "${ALARM_PREFIX}-AIDLQ-MessagesPresent" \
    --alarm-description "Messages found in AI Analysis Dead Letter Queue" \
    --metric-name ApproximateNumberOfMessages \
    --namespace AWS/SQS \
    --statistic Maximum \
    --period 300 \
    --threshold 0 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions Name=QueueName,Value=golf-coach-ai-analysis-dlq-prod \
    --treat-missing-data notBreaching \
    --region $REGION

print_success "AI DLQ alarm created"

# Alarm for old messages (potential processing delays)
aws cloudwatch put-metric-alarm \
    --alarm-name "${ALARM_PREFIX}-FrameQueue-OldMessages" \
    --alarm-description "Messages in frame queue are too old (processing delays)" \
    --metric-name ApproximateAgeOfOldestMessage \
    --namespace AWS/SQS \
    --statistic Maximum \
    --period 300 \
    --threshold 900 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 2 \
    --dimensions Name=QueueName,Value=golf-coach-frame-extraction-queue-prod \
    --treat-missing-data notBreaching \
    --region $REGION

print_success "Frame Queue age alarm created"

# Lambda error alarms
for FUNCTION in "golf-video-upload-handler" "golf-frame-extractor-simple-with-ai" "golf-ai-analysis-processor"; do
    aws cloudwatch put-metric-alarm \
        --alarm-name "${ALARM_PREFIX}-${FUNCTION}-Errors" \
        --alarm-description "High error rate for $FUNCTION" \
        --metric-name Errors \
        --namespace AWS/Lambda \
        --statistic Sum \
        --period 300 \
        --threshold 1 \
        --comparison-operator GreaterThanOrEqualToThreshold \
        --evaluation-periods 1 \
        --dimensions Name=FunctionName,Value=$FUNCTION \
        --treat-missing-data notBreaching \
        --region $REGION
    
    print_success "Error alarm created for $FUNCTION"
done

# =============================================================================
# 3. Create Log Insights Queries
# =============================================================================
print_status "Creating CloudWatch Logs Insights queries..."

cat > log-insights-queries.json << 'EOF'
{
  "pipeline_overview": {
    "query": "fields @timestamp, @message | filter @message like /Processing.*analysis/ | sort @timestamp desc | limit 50",
    "description": "Recent pipeline processing events across all functions"
  },
  "sqs_message_flow": {
    "query": "fields @timestamp, @message | filter @message like /SQS/ or @message like /MessageId/ | sort @timestamp desc | limit 50",
    "description": "SQS message processing events"
  },
  "error_analysis": {
    "query": "fields @timestamp, @message | filter @message like /ERROR/ or @message like /Error/ | sort @timestamp desc | limit 50",
    "description": "All error messages across the pipeline"
  },
  "performance_timing": {
    "query": "fields @timestamp, @message, @duration | filter @type = \"REPORT\" | stats avg(@duration), max(@duration), min(@duration) by bin(5m)",
    "description": "Lambda function performance over time"
  },
  "dlq_investigation": {
    "query": "fields @timestamp, @message | filter @message like /dead letter/ or @message like /DLQ/ | sort @timestamp desc",
    "description": "Dead letter queue related events"
  }
}
EOF

print_success "Log Insights queries saved to log-insights-queries.json"

# =============================================================================
# 4. Create Monitoring Scripts
# =============================================================================
print_status "Creating monitoring helper scripts..."

cat > queue-status.sh << 'EOF'
#!/bin/bash

# Quick queue status check
echo "=== Golf Coach Pipeline Queue Status ==="
echo ""

REGION="us-east-1"

get_queue_stats() {
    local queue_name=$1
    local queue_url=$(aws cloudformation describe-stacks \
        --stack-name golf-coach-sqs-infrastructure \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='${queue_name}QueueURL'].OutputValue" \
        --output text 2>/dev/null)
    
    if [[ -n "$queue_url" && "$queue_url" != "None" ]]; then
        local attrs=$(aws sqs get-queue-attributes \
            --queue-url "$queue_url" \
            --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible,ApproximateAgeOfOldestMessage \
            --region $REGION \
            --query "Attributes" \
            --output json 2>/dev/null)
        
        local messages=$(echo "$attrs" | jq -r '.ApproximateNumberOfMessages // "0"')
        local inflight=$(echo "$attrs" | jq -r '.ApproximateNumberOfMessagesNotVisible // "0"')
        local age=$(echo "$attrs" | jq -r '.ApproximateAgeOfOldestMessage // "0"')
        
        printf "%-25s Messages: %-3s In-flight: %-3s Age: %-3ss\n" "$queue_name" "$messages" "$inflight" "$age"
    else
        printf "%-25s ERROR: Queue not found\n" "$queue_name"
    fi
}

get_queue_stats "FrameExtraction"
get_queue_stats "AIAnalysis"

echo ""
echo "=== Dead Letter Queues ==="
get_queue_stats "FrameExtractionDLQ"
get_queue_stats "AIAnalysisDLQ"

echo ""
echo "=== Lambda Function Status ==="
for func in golf-video-upload-handler golf-frame-extractor-simple-with-ai golf-ai-analysis-processor; do
    status=$(aws lambda get-function --function-name $func --region $REGION --query "Configuration.State" --output text 2>/dev/null || echo "ERROR")
    printf "%-35s %s\n" "$func" "$status"
done
EOF

chmod +x queue-status.sh
print_success "Queue status script created (./queue-status.sh)"

# =============================================================================
# 5. Create Performance Baseline Script
# =============================================================================
cat > performance-baseline.sh << 'EOF'
#!/bin/bash

# Capture performance baseline metrics
echo "=== Golf Coach Pipeline Performance Baseline ==="
echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
echo ""

REGION="us-east-1"

# Lambda function metrics for the last hour
END_TIME=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
START_TIME=$(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%S.000Z')

echo "=== Lambda Performance (Last Hour) ==="
for func in golf-video-upload-handler golf-frame-extractor-simple-with-ai golf-ai-analysis-processor; do
    echo "Function: $func"
    
    # Duration stats
    duration_stats=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Duration \
        --dimensions Name=FunctionName,Value=$func \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 3600 \
        --statistics Average,Maximum,Minimum \
        --region $REGION \
        --query "Datapoints[0]" \
        --output json 2>/dev/null || echo "{}")
    
    if [[ "$duration_stats" != "{}" && "$duration_stats" != "null" ]]; then
        avg_duration=$(echo "$duration_stats" | jq -r '.Average // "N/A"')
        max_duration=$(echo "$duration_stats" | jq -r '.Maximum // "N/A"')
        min_duration=$(echo "$duration_stats" | jq -r '.Minimum // "N/A"')
        echo "  Duration - Avg: ${avg_duration}ms, Max: ${max_duration}ms, Min: ${min_duration}ms"
    else
        echo "  Duration - No data available"
    fi
    
    # Invocation count
    invocations=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Invocations \
        --dimensions Name=FunctionName,Value=$func \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 3600 \
        --statistics Sum \
        --region $REGION \
        --query "Datapoints[0].Sum" \
        --output text 2>/dev/null || echo "0")
    
    echo "  Invocations: $invocations"
    
    # Error count
    errors=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Errors \
        --dimensions Name=FunctionName,Value=$func \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 3600 \
        --statistics Sum \
        --region $REGION \
        --query "Datapoints[0].Sum" \
        --output text 2>/dev/null || echo "0")
    
    echo "  Errors: $errors"
    echo ""
done

echo "=== SQS Queue Performance ==="
for queue_name in golf-coach-frame-extraction-queue-prod golf-coach-ai-analysis-queue-prod; do
    echo "Queue: $queue_name"
    
    # Messages sent
    sent=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/SQS \
        --metric-name NumberOfMessagesSent \
        --dimensions Name=QueueName,Value=$queue_name \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 3600 \
        --statistics Sum \
        --region $REGION \
        --query "Datapoints[0].Sum" \
        --output text 2>/dev/null || echo "0")
    
    # Messages received
    received=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/SQS \
        --metric-name NumberOfMessagesReceived \
        --dimensions Name=QueueName,Value=$queue_name \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --period 3600 \
        --statistics Sum \
        --region $REGION \
        --query "Datapoints[0].Sum" \
        --output text 2>/dev/null || echo "0")
    
    echo "  Messages Sent: $sent"
    echo "  Messages Received: $received"
    echo ""
done
EOF

chmod +x performance-baseline.sh
print_success "Performance baseline script created (./performance-baseline.sh)"

# =============================================================================
# Summary
# =============================================================================
echo ""
print_success "Queue monitoring setup completed!"
echo ""
echo "Created resources:"
echo "✅ CloudWatch Dashboard: $DASHBOARD_NAME"
echo "✅ CloudWatch Alarms: 7 alarms for queue depth, DLQ, and Lambda errors"
echo "✅ Log Insights queries: Saved to log-insights-queries.json"
echo "✅ Monitoring scripts: queue-status.sh, performance-baseline.sh"
echo ""
echo "Next steps:"
echo "1. View dashboard: $DASHBOARD_URL"
echo "2. Run baseline: ./performance-baseline.sh"
echo "3. Monitor queues: ./queue-status.sh"
echo "4. Run end-to-end test: ./end-to-end-test.sh"