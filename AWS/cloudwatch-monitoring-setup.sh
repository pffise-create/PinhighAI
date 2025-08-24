#!/bin/bash

# CloudWatch Monitoring and Alerting Setup for Pin High Coaching Chat
# Sprint 3A: Context-Aware Chat API & DynamoDB Table with Security

echo "Setting up CloudWatch monitoring and alerting for Pin High Coaching Chat..."

# Create CloudWatch alarms for coaching chat system
echo "Creating CloudWatch alarms..."

# High Token Usage Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "PinHigh-CoachingChat-HighTokenUsage" \
  --alarm-description "Alert when token usage exceeds 10000 per hour" \
  --metric-name TokensUsed \
  --namespace PinHigh/CoachingChat \
  --statistic Sum \
  --period 3600 \
  --threshold 10000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:458252603969:pin-high-alerts \
  --treat-missing-data notBreaching

# High Error Rate Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "PinHigh-CoachingChat-HighErrorRate" \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name ErrorRate \
  --namespace PinHigh/CoachingChat \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:458252603969:pin-high-alerts \
  --treat-missing-data notBreaching

# Slow Response Time Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "PinHigh-CoachingChat-SlowResponses" \
  --alarm-description "Alert when average response time exceeds 5 seconds" \
  --metric-name ResponseTime \
  --namespace PinHigh/CoachingChat \
  --statistic Average \
  --period 300 \
  --threshold 5000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:458252603969:pin-high-alerts \
  --treat-missing-data notBreaching

# Daily Cost Limit Alarm (estimated)
aws cloudwatch put-metric-alarm \
  --alarm-name "PinHigh-CoachingChat-DailyCostLimit" \
  --alarm-description "Alert when estimated daily cost exceeds $100" \
  --metric-name ConversationRequests \
  --namespace PinHigh/CoachingChat \
  --statistic Sum \
  --period 86400 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:458252603969:pin-high-alerts \
  --treat-missing-data notBreaching

echo "CloudWatch alarms created successfully!"

# Create CloudWatch dashboard
echo "Creating CloudWatch dashboard..."

cat > coaching-chat-dashboard.json << EOF
{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [
          [ "PinHigh/CoachingChat", "ConversationRequests", { "stat": "Sum" } ],
          [ ".", "TokensUsed", { "stat": "Sum" } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "us-east-1",
        "title": "Coaching Chat Usage",
        "period": 300
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [
          [ "PinHigh/CoachingChat", "ResponseTime", { "stat": "Average" } ],
          [ ".", "ResponseTime", { "stat": "Maximum" } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "us-east-1",
        "title": "Response Time",
        "period": 300,
        "yAxis": {
          "left": {
            "min": 0,
            "max": 10000
          }
        }
      }
    },
    {
      "type": "metric",
      "x": 0,
      "y": 6,
      "width": 8,
      "height": 6,
      "properties": {
        "metrics": [
          [ "AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", "coaching-conversations", { "stat": "Sum" } ],
          [ ".", "ConsumedWriteCapacityUnits", ".", ".", { "stat": "Sum" } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "us-east-1",
        "title": "DynamoDB Capacity Usage",
        "period": 300
      }
    },
    {
      "type": "metric",
      "x": 8,
      "y": 6,
      "width": 8,
      "height": 6,
      "properties": {
        "metrics": [
          [ "AWS/Lambda", "Duration", "FunctionName", "golf-coaching-chat", { "stat": "Average" } ],
          [ ".", "Errors", ".", ".", { "stat": "Sum" } ],
          [ ".", "Invocations", ".", ".", { "stat": "Sum" } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "us-east-1",
        "title": "Lambda Performance",
        "period": 300
      }
    },
    {
      "type": "metric",
      "x": 16,
      "y": 6,
      "width": 8,
      "height": 6,
      "properties": {
        "metrics": [
          [ "PinHigh/CoachingChat", "ConversationRequests", { "stat": "Sum", "period": 86400 } ]
        ],
        "view": "singleValue",
        "region": "us-east-1",
        "title": "Daily Conversations",
        "period": 86400
      }
    }
  ]
}
EOF

aws cloudwatch put-dashboard \
  --dashboard-name "PinHigh-CoachingChat" \
  --dashboard-body file://coaching-chat-dashboard.json

echo "CloudWatch dashboard created successfully!"

# Clean up temporary files
rm -f coaching-chat-dashboard.json

echo "Monitoring setup complete!"
echo ""
echo "Monitoring Components Created:"
echo "- Alarms: HighTokenUsage, HighErrorRate, SlowResponses, DailyCostLimit"
echo "- Dashboard: PinHigh-CoachingChat"
echo "- Namespace: PinHigh/CoachingChat"
echo "- Metrics: ConversationRequests, TokensUsed, ResponseTime, ErrorRate"
echo ""
echo "Note: SNS topic 'pin-high-alerts' should be created separately for alarm notifications"