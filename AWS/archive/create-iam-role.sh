#!/bin/bash

# IAM Role Creation Script for Pin High Coaching Chat Lambda
# Sprint 3A: Context-Aware Chat API & DynamoDB Table with Security

echo "Creating IAM role for golf-coaching-chat Lambda function..."

# Create trust policy document
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the IAM role
aws iam create-role \
  --role-name golf-coaching-chat-role \
  --assume-role-policy-document file://trust-policy.json \
  --description "IAM role for Pin High coaching chat Lambda function with DynamoDB access" \
  --tags Key=Project,Value=PinHighCoaching Key=Service,Value=CoachingChat

echo "IAM role created successfully!"

# Attach the basic Lambda execution policy
aws iam attach-role-policy \
  --role-name golf-coaching-chat-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

echo "Basic execution policy attached!"

# Create and attach custom coaching chat policy
aws iam put-role-policy \
  --role-name golf-coaching-chat-role \
  --policy-name CoachingChatDynamoDBPolicy \
  --policy-document file://iam-coaching-chat-policy.json

echo "Custom DynamoDB policy attached!"

# Wait for role to be available
echo "Waiting for IAM role to be available..."
sleep 10

# Get role ARN
ROLE_ARN=$(aws iam get-role --role-name golf-coaching-chat-role --query 'Role.Arn' --output text)
echo "IAM Role ARN: $ROLE_ARN"

# Clean up temporary files
rm -f trust-policy.json

echo "IAM role setup complete!"
echo ""
echo "Role Details:"
echo "- Role Name: golf-coaching-chat-role"
echo "- Role ARN: $ROLE_ARN"
echo "- Policies: AWSLambdaBasicExecutionRole, CoachingChatDynamoDBPolicy"
echo "- Services: DynamoDB (coaching-conversations, golf-coach-analyses), CloudWatch Logs/Metrics"