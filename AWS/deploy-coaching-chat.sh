#!/bin/bash

# Deployment Script for Pin High Coaching Chat System
# Sprint 3A: Context-Aware Chat API & DynamoDB Table with Security

set -e  # Exit on any error

echo "🚀 Starting Pin High Coaching Chat deployment..."

# Configuration
FUNCTION_NAME="golf-coaching-chat"
ROLE_NAME="golf-coaching-chat-role"
API_NAME="pin-high-coaching-api"
STAGE_NAME="prod"
ZIP_FILE="golf-coaching-chat.zip"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Step 1: Create DynamoDB table
print_status "Step 1: Creating DynamoDB table..."
if aws dynamodb describe-table --table-name coaching-conversations --region us-east-1 >/dev/null 2>&1; then
    print_warning "DynamoDB table 'coaching-conversations' already exists"
else
    ./dynamodb-table-creation.sh
    print_success "DynamoDB table created"
fi

# Step 2: Create IAM role
print_status "Step 2: Setting up IAM role..."
if aws iam get-role --role-name $ROLE_NAME >/dev/null 2>&1; then
    print_warning "IAM role '$ROLE_NAME' already exists"
else
    ./create-iam-role.sh
    print_success "IAM role created"
fi

# Get role ARN
ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
print_status "Using IAM Role: $ROLE_ARN"

# Step 3: Package Lambda function
print_status "Step 3: Packaging Lambda function..."
if [ -f "$ZIP_FILE" ]; then
    rm $ZIP_FILE
fi

# Create package.json for dependencies
cat > package.json << EOF
{
  "name": "golf-coaching-chat",
  "version": "1.0.0",
  "description": "Pin High coaching chat Lambda function",
  "main": "golf-coaching-chat-lambda.js",
  "dependencies": {
    "aws-sdk": "^2.1000.0"
  }
}
EOF

# Install dependencies (aws-sdk is provided by Lambda runtime, but including for completeness)
print_status "Installing dependencies..."
npm install --production

# Create deployment package
zip -r $ZIP_FILE golf-coaching-chat-lambda.js node_modules/ package.json
print_success "Lambda function packaged"

# Step 4: Deploy Lambda function
print_status "Step 4: Deploying Lambda function..."
if aws lambda get-function --function-name $FUNCTION_NAME --region us-east-1 >/dev/null 2>&1; then
    print_status "Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://$ZIP_FILE \
        --region us-east-1
    
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --timeout 30 \
        --memory-size 1024 \
        --environment Variables="{OPENAI_API_KEY=${OPENAI_API_KEY:-placeholder}}" \
        --region us-east-1
    
    print_success "Lambda function updated"
else
    print_status "Creating new Lambda function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs18.x \
        --role $ROLE_ARN \
        --handler golf-coaching-chat-lambda.handler \
        --zip-file fileb://$ZIP_FILE \
        --timeout 30 \
        --memory-size 1024 \
        --environment Variables="{OPENAI_API_KEY=${OPENAI_API_KEY:-placeholder}}" \
        --description "Pin High coaching chat with context awareness" \
        --tags Project=PinHighCoaching,Service=CoachingChat \
        --region us-east-1
    
    print_success "Lambda function created"
fi

# Wait for function to be active
print_status "Waiting for Lambda function to be ready..."
aws lambda wait function-active --function-name $FUNCTION_NAME --region us-east-1

# Step 5: Create API Gateway
print_status "Step 5: Setting up API Gateway..."

# Check if API exists
API_ID=$(aws apigateway get-rest-apis --query "items[?name=='$API_NAME'].id" --output text --region us-east-1)

if [ "$API_ID" != "" ] && [ "$API_ID" != "None" ]; then
    print_warning "API Gateway '$API_NAME' already exists with ID: $API_ID"
else
    print_status "Creating new API Gateway..."
    
    # Create REST API
    API_ID=$(aws apigateway create-rest-api \
        --name $API_NAME \
        --description "Pin High coaching chat API with context awareness" \
        --endpoint-configuration types=REGIONAL \
        --query 'id' \
        --output text \
        --region us-east-1)
    
    print_success "API Gateway created with ID: $API_ID"
fi

# Get root resource ID
ROOT_RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id $API_ID \
    --query 'items[?path==`/`].id' \
    --output text \
    --region us-east-1)

# Create /chat resource
CHAT_RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id $API_ID \
    --query 'items[?pathPart==`chat`].id' \
    --output text \
    --region us-east-1)

if [ "$CHAT_RESOURCE_ID" == "" ] || [ "$CHAT_RESOURCE_ID" == "None" ]; then
    CHAT_RESOURCE_ID=$(aws apigateway create-resource \
        --rest-api-id $API_ID \
        --parent-id $ROOT_RESOURCE_ID \
        --path-part chat \
        --query 'id' \
        --output text \
        --region us-east-1)
    print_success "Created /chat resource"
fi

# Create /chat/coaching resource
COACHING_RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id $API_ID \
    --query 'items[?pathPart==`coaching`].id' \
    --output text \
    --region us-east-1)

if [ "$COACHING_RESOURCE_ID" == "" ] || [ "$COACHING_RESOURCE_ID" == "None" ]; then
    COACHING_RESOURCE_ID=$(aws apigateway create-resource \
        --rest-api-id $API_ID \
        --parent-id $CHAT_RESOURCE_ID \
        --path-part coaching \
        --query 'id' \
        --output text \
        --region us-east-1)
    print_success "Created /chat/coaching resource"
fi

# Create POST method
aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method POST \
    --authorization-type NONE \
    --region us-east-1 2>/dev/null || print_warning "POST method already exists"

# Create OPTIONS method for CORS
aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method OPTIONS \
    --authorization-type NONE \
    --region us-east-1 2>/dev/null || print_warning "OPTIONS method already exists"

# Get Lambda function ARN
LAMBDA_ARN=$(aws lambda get-function --function-name $FUNCTION_NAME --query 'Configuration.FunctionArn' --output text --region us-east-1)

# Set up Lambda integration for POST
aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method POST \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
    --region us-east-1

# Set up CORS integration for OPTIONS
aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json":"{\"statusCode\": 200}"}' \
    --region us-east-1

# Set up method responses
aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method POST \
    --status-code 200 \
    --region us-east-1 2>/dev/null || true

aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Origin":false,"method.response.header.Access-Control-Allow-Methods":false,"method.response.header.Access-Control-Allow-Headers":false}' \
    --region us-east-1 2>/dev/null || true

# Set up integration responses
aws apigateway put-integration-response \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method POST \
    --status-code 200 \
    --region us-east-1 2>/dev/null || true

aws apigateway put-integration-response \
    --rest-api-id $API_ID \
    --resource-id $COACHING_RESOURCE_ID \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Origin":"'"'"'*'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'OPTIONS,POST'"'"'","method.response.header.Access-Control-Allow-Headers":"'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"'"'"}' \
    --region us-east-1 2>/dev/null || true

# Add Lambda permission for API Gateway
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id apigateway-invoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:us-east-1:458252603969:$API_ID/*/*/*" \
    --region us-east-1 2>/dev/null || print_warning "Lambda permission already exists"

# Deploy API
print_status "Deploying API to $STAGE_NAME stage..."
aws apigateway create-deployment \
    --rest-api-id $API_ID \
    --stage-name $STAGE_NAME \
    --description "Pin High coaching chat API deployment" \
    --region us-east-1

print_success "API deployed successfully"

# Step 6: Set up monitoring
print_status "Step 6: Setting up monitoring..."
./cloudwatch-monitoring-setup.sh
print_success "Monitoring configured"

# Clean up
rm -f $ZIP_FILE package.json package-lock.json
rm -rf node_modules/

# Get API endpoint
API_ENDPOINT="https://$API_ID.execute-api.us-east-1.amazonaws.com/$STAGE_NAME"

print_success "🎉 Pin High Coaching Chat deployment complete!"
echo ""
echo "📋 Deployment Summary:"
echo "===================="
echo "• DynamoDB Table: coaching-conversations"
echo "• Lambda Function: $FUNCTION_NAME"
echo "• IAM Role: $ROLE_NAME"
echo "• API Gateway: $API_NAME (ID: $API_ID)"
echo "• API Endpoint: $API_ENDPOINT/chat/coaching"
echo "• CloudWatch Dashboard: PinHigh-CoachingChat"
echo ""
echo "🔧 Next Steps:"
echo "1. Set OPENAI_API_KEY environment variable in Lambda function"
echo "2. Update mobile app to use: $API_ENDPOINT/chat/coaching"
echo "3. Test the API endpoint with sample requests"
echo "4. Monitor CloudWatch dashboard for performance metrics"
echo ""
echo "📱 Mobile App Integration:"
echo "Update API_BASE_URL in mobile app to: $API_ENDPOINT"
echo ""
print_success "Deployment complete! 🚀"