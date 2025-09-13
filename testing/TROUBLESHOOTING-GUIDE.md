# Golf Coach Pipeline - Troubleshooting Guide

## Overview
This guide covers common issues and solutions for the Golf Coach SQS-based video processing pipeline.

## Quick Diagnostics

### Check Pipeline Status
```bash
# Run the comprehensive status check
./queue-status.sh

# Check specific queue
aws sqs get-queue-attributes \
    --queue-url <QUEUE_URL> \
    --attribute-names All \
    --region us-east-1
```

### View Recent Logs
```bash
# Frame extractor logs
aws logs tail /aws/lambda/golf-frame-extractor-simple-with-ai --follow

# AI analysis logs  
aws logs tail /aws/lambda/golf-ai-analysis-processor --follow

# Video upload handler logs
aws logs tail /aws/lambda/golf-video-upload-handler --follow
```

## Common Issues and Solutions

### 1. Videos Not Processing

**Symptoms:**
- Video uploaded but no frames extracted
- Status stuck at "PROCESSING"
- No messages in queues

**Diagnostic Steps:**
```bash
# Check if video exists in S3
aws s3 ls s3://golf-coach-videos-1753203601/golf-swings/

# Verify upload handler was triggered
aws logs filter-log-events \
    --log-group-name /aws/lambda/golf-video-upload-handler \
    --start-time $(date -d '1 hour ago' +%s)000
```

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Upload handler not sending SQS message | Check `FRAME_EXTRACTION_QUEUE_URL` environment variable |
| Invalid video format | Verify video is MP4 format and accessible |
| S3 permissions issue | Check Lambda execution role has S3 read permissions |
| Queue URL misconfigured | Verify CloudFormation outputs match environment variables |

### 2. Frame Extraction Failures

**Symptoms:**
- Messages in frame extraction queue but no frames in S3
- "No frames extracted" error in logs
- Messages moving to Dead Letter Queue

**Diagnostic Steps:**
```bash
# Check frame extractor logs for specific analysis
aws logs filter-log-events \
    --log-group-name /aws/lambda/golf-frame-extractor-simple-with-ai \
    --filter-pattern "analysis_id_here"

# Check if FFmpeg layer is attached
aws lambda get-function \
    --function-name golf-frame-extractor-simple-with-ai \
    --query "Configuration.Layers"
```

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| FFmpeg layer missing | Attach FFmpeg layer: `arn:aws:lambda:us-east-1:898466741470:layer:ffmpeg:3` |
| Video file corrupted | Re-upload video file |
| S3 bucket permissions | Verify Lambda can write to S3 bucket |
| Memory/timeout issues | Increase Lambda memory (3008 MB) and timeout (15 minutes) |
| Invalid video codec | Convert video to H.264 MP4 format |

### 3. AI Analysis Not Running

**Symptoms:**
- Frames extracted but no AI analysis
- AI analysis queue empty
- `ai_analysis_completed` still false in DynamoDB

**Diagnostic Steps:**
```bash
# Check if frames triggered AI queue message
aws logs filter-log-events \
    --log-group-name /aws/lambda/golf-frame-extractor-simple-with-ai \
    --filter-pattern "AI_ANALYSIS_QUEUE_URL"

# Verify AI processor has SQS trigger
aws lambda list-event-source-mappings \
    --function-name golf-ai-analysis-processor
```

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| SQS message not sent after frame extraction | Check `AI_ANALYSIS_QUEUE_URL` environment variable in frame extractor |
| OpenAI API key missing | Set `OPENAI_API_KEY` in AI processor environment |
| SQS event source mapping disabled | Enable mapping or recreate if missing |
| OpenAI rate limits | Check CloudWatch logs for 429 errors |
| DynamoDB permissions | Verify Lambda can update DynamoDB table |

### 4. Dead Letter Queue Messages

**Symptoms:**
- Messages accumulating in DLQ
- Processing failures not retrying

**Diagnostic Steps:**
```bash
# Check DLQ message count
aws sqs get-queue-attributes \
    --queue-url <DLQ_URL> \
    --attribute-names ApproximateNumberOfMessages

# Sample DLQ message
aws sqs receive-message \
    --queue-url <DLQ_URL> \
    --max-number-of-messages 1
```

**Analysis & Solutions:**

| DLQ Type | Common Causes | Solutions |
|----------|---------------|-----------|
| Frame Extraction DLQ | Invalid S3 paths, missing video files, FFmpeg errors | Fix S3 paths, re-upload videos, check FFmpeg layer |
| AI Analysis DLQ | OpenAI API errors, invalid frame data, timeout | Check API key, verify frames exist, increase timeout |

**DLQ Message Reprocessing:**
```bash
# Move message back to main queue for retry
aws sqs receive-message --queue-url <DLQ_URL> --max-number-of-messages 1 > dlq_message.json
aws sqs send-message --queue-url <MAIN_QUEUE_URL> --message-body "$(cat dlq_message.json | jq -r '.Messages[0].Body')"
aws sqs delete-message --queue-url <DLQ_URL> --receipt-handle "$(cat dlq_message.json | jq -r '.Messages[0].ReceiptHandle')"
```

### 5. Performance Issues

**Symptoms:**
- Slow processing times
- Queue message age warnings
- Lambda timeouts

**Diagnostic Steps:**
```bash
# Check Lambda performance metrics
./performance-baseline.sh

# Monitor queue ages
aws cloudwatch get-metric-statistics \
    --namespace AWS/SQS \
    --metric-name ApproximateAgeOfOldestMessage \
    --dimensions Name=QueueName,Value=golf-coach-frame-extraction-queue-prod \
    --start-time $(date -d '1 hour ago' --iso-8601) \
    --end-time $(date --iso-8601) \
    --period 300 \
    --statistics Maximum
```

**Optimization Solutions:**

| Issue | Solution |
|-------|----------|
| Frame extraction slow | Increase Lambda memory to 3008 MB |
| AI analysis timeouts | Reduce image resolution, optimize prompts |
| Queue backlog | Increase SQS batch size, add more concurrent executions |
| Cold starts | Use Provisioned Concurrency for critical functions |

### 6. CloudWatch Alarms Firing

**Alarm Types & Responses:**

| Alarm | Cause | Action |
|-------|-------|--------|
| High Queue Depth | Processing slower than input rate | Check Lambda error rates, increase concurrency |
| DLQ Messages Present | Failed processing | Investigate DLQ messages, fix root cause |
| Lambda Errors | Function failures | Check CloudWatch logs, fix code issues |
| Old Messages | Processing delays | Scale up Lambda resources |

### 7. Environment Configuration Issues

**Verification Checklist:**

```bash
# Video Upload Handler
aws lambda get-function-configuration \
    --function-name golf-video-upload-handler \
    --query "Environment.Variables"
# Required: FRAME_EXTRACTION_QUEUE_URL

# Frame Extractor  
aws lambda get-function-configuration \
    --function-name golf-frame-extractor-simple-with-ai \
    --query "Environment.Variables"
# Required: AI_ANALYSIS_QUEUE_URL

# AI Processor
aws lambda get-function-configuration \
    --function-name golf-ai-analysis-processor \
    --query "Environment.Variables"  
# Required: OPENAI_API_KEY, DYNAMODB_TABLE, USER_THREADS_TABLE
```

**Fix Missing Environment Variables:**
```bash
aws lambda update-function-configuration \
    --function-name <FUNCTION_NAME> \
    --environment Variables='{
        "VARIABLE_NAME": "value",
        "ANOTHER_VAR": "another_value"
    }'
```

## Debug Commands

### Real-time Log Monitoring
```bash
# Monitor all pipeline logs simultaneously
aws logs tail /aws/lambda/golf-video-upload-handler --follow &
aws logs tail /aws/lambda/golf-frame-extractor-simple-with-ai --follow &
aws logs tail /aws/lambda/golf-ai-analysis-processor --follow &
```

### Queue Inspection
```bash
# Get detailed queue attributes
aws sqs get-queue-attributes \
    --queue-url <QUEUE_URL> \
    --attribute-names All \
    --region us-east-1 | jq .

# Peek at messages without removing them
aws sqs receive-message \
    --queue-url <QUEUE_URL> \
    --max-number-of-messages 10 \
    --visibility-timeout-seconds 1
```

### DynamoDB Analysis Status
```bash
# Check specific analysis
aws dynamodb get-item \
    --table-name golf-coach-analyses \
    --key '{"analysis_id":{"S":"YOUR_ANALYSIS_ID"}}'

# Scan recent analyses
aws dynamodb scan \
    --table-name golf-coach-analyses \
    --filter-expression "created_at > :timestamp" \
    --expression-attribute-values '{":timestamp":{"S":"2024-01-01T00:00:00Z"}}'
```

### S3 Frame Verification
```bash
# Check if frames were created
aws s3 ls s3://golf-coach-videos-1753203601/golf-swings/ --recursive | grep YOUR_ANALYSIS_ID

# Download frame for inspection
aws s3 cp s3://golf-coach-videos-1753203601/golf-swings/guest-user/YOUR_ANALYSIS_ID/frame_001.jpg ./
```

## Performance Tuning

### Lambda Optimizations

| Function | Recommended Settings |
|----------|---------------------|
| Video Upload Handler | Memory: 512 MB, Timeout: 30s |
| Frame Extractor | Memory: 3008 MB, Timeout: 15 min |
| AI Analysis Processor | Memory: 1024 MB, Timeout: 5 min |

### SQS Configuration

| Setting | Recommended Value | Reason |
|---------|------------------|--------|
| Visibility Timeout | 30 seconds | Prevents duplicate processing |
| Message Retention | 14 days | Allows debugging of failed messages |
| Max Receives | 3 | Balances retry vs DLQ movement |
| Batch Size | 1 | Ensures individual message processing |

## Recovery Procedures

### 1. Complete Pipeline Reset
```bash
# Purge all queues
aws sqs purge-queue --queue-url <FRAME_QUEUE_URL>
aws sqs purge-queue --queue-url <AI_QUEUE_URL>
aws sqs purge-queue --queue-url <FRAME_DLQ_URL>
aws sqs purge-queue --queue-url <AI_DLQ_URL>

# Reset DynamoDB entries if needed
aws dynamodb update-item \
    --table-name golf-coach-analyses \
    --key '{"analysis_id":{"S":"YOUR_ID"}}' \
    --update-expression "SET #status = :status, ai_analysis_completed = :completed" \
    --expression-attribute-names '{"#status": "status"}' \
    --expression-attribute-values '{":status":{"S":"PENDING"},":completed":{"BOOL":false}}'
```

### 2. Reprocess Failed Analysis
```bash
# Re-trigger video upload handler
aws lambda invoke \
    --function-name golf-video-upload-handler \
    --payload '{"s3_bucket":"golf-coach-videos-1753203601","s3_key":"golf-swings/guest/YOUR_ID.mp4","analysis_id":"YOUR_ID","user_id":"guest-user"}' \
    response.json
```

### 3. Manual Frame Extraction Trigger
```bash
# Send message directly to frame extraction queue
aws sqs send-message \
    --queue-url <FRAME_QUEUE_URL> \
    --message-body '{"s3_bucket":"golf-coach-videos-1753203601","s3_key":"golf-swings/guest/YOUR_ID.mp4","analysis_id":"YOUR_ID","user_id":"guest-user"}'
```

## Monitoring Best Practices

### Regular Health Checks
1. Run `./queue-status.sh` daily
2. Monitor CloudWatch dashboard weekly
3. Check DLQ messages weekly
4. Review error rates monthly

### Alerting Setup
- Configure SNS notifications for DLQ messages
- Set up Slack/email alerts for high error rates
- Monitor queue depth trends
- Track processing time increases

### Log Retention
- Keep CloudWatch logs for 30 days minimum
- Export critical error logs to S3 for long-term analysis
- Set up log aggregation for pattern analysis

## Emergency Contacts

**Pipeline Architecture:** Golf Coach Development Team
**AWS Infrastructure:** DevOps Team  
**OpenAI API Issues:** AI Services Team

## Additional Resources

- CloudWatch Dashboard: [GolfCoach-SQS-Pipeline]
- AWS CloudFormation Stack: `golf-coach-sqs-infrastructure`
- S3 Bucket: `golf-coach-videos-1753203601`
- DynamoDB Table: `golf-coach-analyses`

---

*Last Updated: $(date -u '+%Y-%m-%d %H:%M:%S') UTC*
*Pipeline Version: Queue-based Architecture v1.0*