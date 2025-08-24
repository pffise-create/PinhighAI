#!/bin/bash

# DynamoDB Table Creation Script for Pin High Coaching System
# Sprint 3A: Context-Aware Chat API & DynamoDB Table with Security

echo "Creating DynamoDB table: coaching-conversations"

# Create the coaching-conversations table
aws dynamodb create-table \
  --table-name coaching-conversations \
  --attribute-definitions \
    AttributeName=conversation_id,AttributeType=S \
    AttributeName=user_id,AttributeType=S \
    AttributeName=last_updated,AttributeType=S \
  --key-schema \
    AttributeName=conversation_id,KeyType=HASH \
  --global-secondary-indexes \
    IndexName=user-index,KeySchema=[{AttributeName=user_id,KeyType=HASH},{AttributeName=last_updated,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5} \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --region us-east-1 \
  --tags Key=Project,Value=PinHighCoaching Key=Environment,Value=Production Key=CostCenter,Value=CoachingPlatform

echo "Waiting for table to become active..."
aws dynamodb wait table-exists --table-name coaching-conversations --region us-east-1

echo "Table created successfully!"

# Enable point-in-time recovery
echo "Enabling point-in-time recovery..."
aws dynamodb put-backup-policy \
  --table-name coaching-conversations \
  --backup-policy BillingMode=PROVISIONED,PointInTimeRecoveryEnabled=true \
  --region us-east-1

# Enable auto-scaling for the table
echo "Setting up auto-scaling..."
aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/coaching-conversations \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --min-capacity 5 \
  --max-capacity 100 \
  --region us-east-1

aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/coaching-conversations \
  --scalable-dimension dynamodb:table:WriteCapacityUnits \
  --min-capacity 5 \
  --max-capacity 100 \
  --region us-east-1

# Create auto-scaling policies
aws application-autoscaling put-scaling-policy \
  --service-namespace dynamodb \
  --resource-id table/coaching-conversations \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --policy-name coaching-conversations-read-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "ScaleInCooldown": 60,
    "ScaleOutCooldown": 60,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "DynamoDBReadCapacityUtilization"
    }
  }' \
  --region us-east-1

aws application-autoscaling put-scaling-policy \
  --service-namespace dynamodb \
  --resource-id table/coaching-conversations \
  --scalable-dimension dynamodb:table:WriteCapacityUnits \
  --policy-name coaching-conversations-write-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "ScaleInCooldown": 60,
    "ScaleOutCooldown": 60,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "DynamoDBWriteCapacityUtilization"
    }
  }' \
  --region us-east-1

echo "Auto-scaling configured successfully!"

# Describe the table to verify creation
echo "Table description:"
aws dynamodb describe-table --table-name coaching-conversations --region us-east-1 --query 'Table.{TableName:TableName,Status:TableStatus,ItemCount:ItemCount,TableSizeBytes:TableSizeBytes}'

echo "DynamoDB table setup complete!"
echo ""
echo "Table Details:"
echo "- Name: coaching-conversations"
echo "- Primary Key: conversation_id (String)"
echo "- GSI: user-index (user_id, last_updated)"
echo "- Auto-scaling: 5-100 capacity units"
echo "- Point-in-time recovery: Enabled"
echo "- Region: us-east-1"