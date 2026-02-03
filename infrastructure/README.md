# Golf Coach SQS Infrastructure

This CloudFormation template creates SQS queues and IAM policies for the Golf Coach pipeline to replace direct Lambda invocations with reliable queue-based processing.

## 📋 Resources Created

### SQS Queues
- **golf-coach-frame-extraction-queue-prod**: Main processing queue for frame extraction
- **golf-coach-ai-analysis-queue-prod**: Main processing queue for AI analysis
- **golf-coach-frame-extraction-dlq-prod**: Dead letter queue for failed frame extractions
- **golf-coach-ai-analysis-dlq-prod**: Dead letter queue for failed AI analysis

### IAM Policies
- **golf-coach-sqs-send-policy-prod**: Allows Lambda functions to send messages to queues
- **golf-coach-sqs-receive-policy-prod**: Allows Lambda functions to receive messages from queues

### IAM Roles
- **golf-coach-video-upload-handler-role-prod**: For video upload Lambda
- **golf-coach-frame-extractor-role-prod**: For frame extraction Lambda
- **golf-coach-ai-analysis-processor-role-prod**: For AI analysis Lambda

## 🚀 Deployment Instructions

### Step 1: Deploy the CloudFormation Stack

```bash
# Navigate to the infrastructure directory
cd infrastructure

# Deploy the stack
aws cloudformation create-stack \
  --stack-name golf-coach-sqs-infrastructure \
  --template-body file://golf-sqs-queues.yaml \
  --parameters ParameterKey=ProjectName,ParameterValue=golf-coach \
               ParameterKey=Environment,ParameterValue=prod \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

# Wait for deployment to complete
aws cloudformation wait stack-create-complete \
  --stack-name golf-coach-sqs-infrastructure \
  --region us-east-1
```

### Step 2: Get Queue URLs and ARNs

```bash
# Get all stack outputs
aws cloudformation describe-stacks \
  --stack-name golf-coach-sqs-infrastructure \
  --query "Stacks[0].Outputs" \
  --output table

# Get specific queue URLs
aws cloudformation describe-stacks \
  --stack-name golf-coach-sqs-infrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" \
  --output text

aws cloudformation describe-stacks \
  --stack-name golf-coach-sqs-infrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueURL'].OutputValue" \
  --output text
```

### Step 3: Update Lambda Function Roles

After deployment, you need to update your existing Lambda functions to use the new roles:

```bash
# Update video upload handler role
aws lambda update-function-configuration \
  --function-name golf-video-upload-handler \
  --role $(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --query "Stacks[0].Outputs[?OutputKey=='VideoUploadHandlerRoleArn'].OutputValue" \
    --output text)

# Update frame extractor role
aws lambda update-function-configuration \
  --function-name golf-frame-extractor-simple-with-ai \
  --role $(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --query "Stacks[0].Outputs[?OutputKey=='FrameExtractorRoleArn'].OutputValue" \
    --output text)

# Update AI analysis processor role
aws lambda update-function-configuration \
  --function-name golf-ai-analysis-processor \
  --role $(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisProcessorRoleArn'].OutputValue" \
    --output text)
```

### Step 4: Create Lambda Event Source Mappings

```bash
# Create SQS trigger for frame extractor
aws lambda create-event-source-mapping \
  --event-source-arn $(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueArn'].OutputValue" \
    --output text) \
  --function-name golf-frame-extractor-simple-with-ai \
  --batch-size 1

# Create SQS trigger for AI analysis processor
aws lambda create-event-source-mapping \
  --event-source-arn $(aws cloudformation describe-stacks \
    --stack-name golf-coach-sqs-infrastructure \
    --query "Stacks[0].Outputs[?OutputKey=='AIAnalysisQueueArn'].OutputValue" \
    --output text) \
  --function-name golf-ai-analysis-processor \
  --batch-size 1
```

## 🔧 Queue Configuration

### Frame Extraction Queue
- **Visibility Timeout**: 30 seconds
- **Message Retention**: 14 days
- **Max Receive Count**: 3 (then moves to DLQ)
- **Long Polling**: 20 seconds

### AI Analysis Queue
- **Visibility Timeout**: 30 seconds
- **Message Retention**: 14 days
- **Max Receive Count**: 3 (then moves to DLQ)
- **Long Polling**: 20 seconds

## 📊 Environment Variables for Lambda Functions

After deployment, update your Lambda functions with these environment variables:

### Video Upload Handler
```
FRAME_EXTRACTION_QUEUE_URL=<FrameExtractionQueueURL from outputs>
```

### Frame Extractor
```
AI_ANALYSIS_QUEUE_URL=<AIAnalysisQueueURL from outputs>
```

## 🧪 Testing the Queues

### Send Test Message to Frame Extraction Queue
```bash
QUEUE_URL=$(aws cloudformation describe-stacks \
  --stack-name golf-coach-sqs-infrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionQueueURL'].OutputValue" \
  --output text)

aws sqs send-message \
  --queue-url $QUEUE_URL \
  --message-body '{"analysis_id":"test-123","s3_bucket":"golf-coach-videos-1753203601","s3_key":"golf-swings/guest/test.mov","user_id":"guest-user"}'
```

### Check Queue Attributes
```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names All
```

### Monitor Dead Letter Queues
```bash
# Check DLQ for failed messages
DLQ_URL=$(aws cloudformation describe-stacks \
  --stack-name golf-coach-sqs-infrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='FrameExtractionDLQURL'].OutputValue" \
  --output text)

aws sqs receive-message --queue-url $DLQ_URL
```

## 🗑️ Cleanup

To delete all resources:

```bash
# Delete event source mappings first
aws lambda list-event-source-mappings \
  --function-name golf-frame-extractor-simple-with-ai \
  --query "EventSourceMappings[?contains(EventSourceArn, 'golf-coach-frame-extraction-queue')].UUID" \
  --output text | xargs -I {} aws lambda delete-event-source-mapping --uuid {}

aws lambda list-event-source-mappings \
  --function-name golf-ai-analysis-processor \
  --query "EventSourceMappings[?contains(EventSourceArn, 'golf-coach-ai-analysis-queue')].UUID" \
  --output text | xargs -I {} aws lambda delete-event-source-mapping --uuid {}

# Delete the CloudFormation stack
aws cloudformation delete-stack \
  --stack-name golf-coach-sqs-infrastructure

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete \
  --stack-name golf-coach-sqs-infrastructure
```

## 📝 Next Steps

1. **Update Lambda Code**: Modify your Lambda functions to send/receive SQS messages instead of direct invocations
2. **Add Error Handling**: Implement proper error handling for SQS message processing
3. **Monitor Performance**: Set up CloudWatch alarms for queue depth and processing errors
4. **Scale Configuration**: Adjust batch sizes and concurrency based on processing volume

## 🔍 Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure Lambda functions are using the correct IAM roles from the stack
2. **Queue Not Found**: Verify the stack deployed successfully and queue URLs are correct
3. **Messages in DLQ**: Check Lambda function logs for processing errors
4. **High Queue Depth**: Monitor Lambda concurrency and processing time

### Monitoring Commands

```bash
# Check queue metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessages \
  --dimensions Name=QueueName,Value=golf-coach-frame-extraction-queue-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

## DynamoDB Index Utilities

The `golf-coach-analyses` table uses the `user-timestamp-index` (HASH `user_id`, RANGE `created_at`) so we can pull a player's recent swings quickly. Verify the index exists before deploying chat-loop changes:

```powershell
aws dynamodb describe-table `
  --table-name golf-coach-analyses `
  --region us-east-1 `
  --query "Table.GlobalSecondaryIndexes[].{Name:IndexName,Status:IndexStatus}"
```

If the index is missing in a new environment, create it with:

```powershell
aws dynamodb update-table `
  --table-name golf-coach-analyses `
  --region us-east-1 `
  --attribute-definitions AttributeName=user_id,AttributeType=S AttributeName=created_at,AttributeType=S `
  --global-secondary-index-updates '[{"Create":{"IndexName":"user-timestamp-index","KeySchema":[{"AttributeName":"user_id","KeyType":"HASH"},{"AttributeName":"created_at","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]'
```

No backfill is required because prior data was test-only.

### Swing Profile Table Deployment

Use the `golf-dynamo-tables.yaml` template to provision the persistent swing profile store that the chat loop now reads from.

```bash
cd infrastructure
./deploy-swing-profile-table.sh -e dev   # or staging/prod
```

The script validates the template, creates or updates the `golf-coach-swing-profiles-<env>` table, and prints the resulting table name/ARN. Ensure the AWS CLI profile you use has permission to manage DynamoDB resources.
