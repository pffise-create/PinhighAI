# Sprint 3A: Context-Aware Chat API & DynamoDB Table with Security

**Project:** Golf Coach AI - Smart Coaching Conversation Architecture  
**Sprint:** 3A  
**Duration:** Week 3, Part A  
**Dependencies:** Sprint 2A (Enhanced ResultsScreen), Sprint 2B (Enhanced ChatScreen)

## 🎯 Business Problem Statement

**Current Infrastructure Gap:**
- Mobile app has context-aware coaching features but no backend to support them
- No persistent storage for coaching conversations and themes
- Enhanced ChatScreen and ResultsScreen need API endpoints that don't exist yet
- Missing security, cost controls, and monitoring for production coaching system

**Business Value:**
- Enable coaching continuity features to work in production
- Scalable, secure backend infrastructure for coaching conversations
- Cost-controlled AI usage with monitoring and alerting
- Production-ready system that supports business growth

## 📋 Implementation Requirements

### 1. CREATE DYNAMODB TABLE: coaching-conversations

#### Table Creation Script
```bash
# AWS CLI commands to create table
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
  --region us-east-1
```

#### Table Schema
```javascript
{
  conversation_id: "conv_user123_20250820", // Primary Key
  user_id: "user123", // GSI Hash Key
  last_updated: "2025-08-20T10:30:00Z", // GSI Range Key
  created_at: "2025-08-20T09:00:00Z",
  recent_messages: [
    {
      message_id: "msg_001",
      role: "user|assistant",
      content: "message text",
      timestamp: "ISO_string",
      swing_reference: "swing_id|null",
      tokens_used: 45
    }
  ],
  coaching_themes: {
    primary_focus: "weight_shift",
    secondary_focus: "setup_consistency",
    recent_improvements: ["grip", "stance"],
    session_count: 8,
    progress_indicators: {...}
  },
  referenced_swings: ["swing_001", "swing_002"],
  total_tokens_used: 2340,
  conversation_status: "active|archived|compressed"
}
```

### 2. CREATE IAM ROLE: golf-coaching-chat-role

#### IAM Policy Definition
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:458252603969:table/coaching-conversations",
        "arn:aws:dynamodb:us-east-1:458252603969:table/coaching-conversations/index/*",
        "arn:aws:dynamodb:us-east-1:458252603969:table/golf-coach-analyses"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:458252603969:*"
    }
  ]
}
```

### 3. CREATE LAMBDA FUNCTION: golf-coaching-chat

#### Core Lambda Structure
```javascript
// golf-coaching-chat-lambda.js main structure
export const handler = async (event) => {
  try {
    // 1. Validate and parse request
    const request = validateRequest(event);
    
    // 2. Check rate limits and cost controls
    await checkUserLimits(request.userId);
    
    // 3. Assemble coaching context
    const context = await assembleCoachingContext(request);
    
    // 4. Call GPT-4o with context-aware prompt
    const response = await callGPTWithCoachingContext(context);
    
    // 5. Store conversation state
    await storeConversationState(request.userId, response);
    
    // 6. Return coaching response
    return formatCoachingResponse(response);
    
  } catch (error) {
    return handleCoachingError(error);
  }
};
```

### 4. COST PROTECTION IMPLEMENTATION
- **Hard token limit:** 1,500 tokens per request (including response)
- **Rate limiting:** 15 requests per user per hour
- **Daily cost limits:** $5 per user, $100 total
- **Token usage tracking and alerting**
- **Graceful degradation when limits exceeded**

### 5. SECURITY IMPLEMENTATION
- **Input validation and sanitization** for all parameters
- **Rate limiting by user_id and IP address**
- **Request size limits** (10KB max request body)
- **Response sanitization and content filtering**
- **Security logging** without exposing sensitive data

### 6. ERROR HANDLING & RESILIENCE
- **Comprehensive try-catch** with specific error types
- **Circuit breaker pattern** for external API calls
- **Exponential backoff** for retries
- **Graceful degradation scenarios**
- **User-friendly error responses** maintaining coaching tone

### 7. MONITORING & ALERTING
```javascript
// CloudWatch metrics to implement
const metrics = {
  'ConversationRequests': 'Count',
  'TokensUsed': 'Sum',
  'ResponseTime': 'Average',
  'ErrorRate': 'Percentage',
  'CostPerDay': 'Sum',
  'UserActiveConversations': 'Count'
};

// Alarms to create
const alarms = {
  'HighTokenUsage': 'TokensUsed > 10000 per hour',
  'HighErrorRate': 'ErrorRate > 5%',
  'SlowResponses': 'ResponseTime > 5 seconds',
  'DailyCostLimit': 'CostPerDay > $100'
};
```

### 8. API GATEWAY INTEGRATION
- **New endpoint:** POST /api/chat/coaching
- **CORS configuration** for mobile app
- **Request/response validation**
- **Basic API rate limiting**
- **Error response standardization**

## 🔧 Technical Implementation Details

### Lambda Function Core Logic
```javascript
// Context assembly function
async function assembleCoachingContext(request) {
  const context = {
    userId: request.userId,
    currentMessage: request.message,
    conversationHistory: await getConversationHistory(request.userId),
    coachingThemes: await getCoachingThemes(request.userId),
    recentSwings: await getRecentSwingAnalyses(request.userId),
    userProfile: await getUserProfile(request.userId)
  };
  
  return context;
}

// GPT-4o integration with coaching context
async function callGPTWithCoachingContext(context) {
  const prompt = buildCoachingPrompt(context);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: prompt.messages,
      max_tokens: 800,
      temperature: 0.7
    })
  });
  
  return await response.json();
}

// Conversation state storage
async function storeConversationState(userId, response) {
  const conversationId = generateConversationId(userId);
  
  await dynamodb.updateItem({
    TableName: 'coaching-conversations',
    Key: { conversation_id: conversationId },
    UpdateExpression: 'SET recent_messages = list_append(recent_messages, :msg), last_updated = :timestamp',
    ExpressionAttributeValues: {
      ':msg': [response],
      ':timestamp': new Date().toISOString()
    }
  }).promise();
}
```

### Security Validation
```javascript
function validateRequest(event) {
  // Input validation
  const body = JSON.parse(event.body || '{}');
  
  if (!body.message || typeof body.message !== 'string') {
    throw new Error('Invalid message format');
  }
  
  if (body.message.length > 1000) {
    throw new Error('Message too long');
  }
  
  if (!body.userId || typeof body.userId !== 'string') {
    throw new Error('Invalid user ID');
  }
  
  // Sanitize inputs
  return {
    message: sanitizeInput(body.message),
    userId: sanitizeInput(body.userId),
    context: body.context || {}
  };
}
```

### Cost Control Implementation
```javascript
async function checkUserLimits(userId) {
  // Check hourly rate limit
  const hourlyRequests = await getHourlyRequestCount(userId);
  if (hourlyRequests >= 15) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }
  
  // Check daily cost limit
  const dailyCost = await getDailyCost(userId);
  if (dailyCost >= 5) {
    throw new Error('Daily usage limit reached. Premium users get higher limits.');
  }
  
  // Check total system cost
  const totalCost = await getTotalDailyCost();
  if (totalCost >= 100) {
    throw new Error('System at capacity. Please try again later.');
  }
}
```

## 📁 Files to Create

### Lambda Implementation
- **golf-coaching-chat-lambda.js** - Main coaching chat function
- **context-assembly.js** - Coaching context logic
- **gpt-integration.js** - OpenAI API integration
- **conversation-storage.js** - DynamoDB operations
- **cost-controls.js** - Rate limiting and cost management
- **security-validation.js** - Input validation and sanitization

### Infrastructure Configuration
- **iam-role-policy.json** - IAM permissions
- **dynamodb-table-creation.sh** - Table creation scripts
- **cloudwatch-dashboard.json** - Monitoring configuration
- **api-gateway-config.json** - Endpoint configuration

### Deployment Configuration
- **lambda-deployment.yaml** - CloudFormation template
- **environment-config.js** - Environment variables
- **monitoring-setup.sh** - CloudWatch alarms setup

## 🎯 Success Criteria

### Technical Performance
- **Response Time:** <3 seconds for all coaching requests
- **Error Rate:** <2% across all operations
- **Availability:** 99.5% uptime for coaching endpoints
- **Cost Control:** Stay under $5 per user per day

### Security Validation
- **Penetration testing:** No critical vulnerabilities
- **Input validation:** 100% request validation coverage
- **Rate limiting:** Effective protection against abuse
- **Data protection:** Secure storage and transmission

### Monitoring & Alerting
- **Real-time metrics:** All key metrics captured
- **Proactive alerting:** Issues detected before user impact
- **Cost tracking:** Daily cost monitoring and reporting
- **Performance insights:** Response time and usage patterns

## 🔍 Testing Scenarios

### Functional Testing
1. **Basic coaching request** - Context assembly and response
2. **Rate limiting** - Proper enforcement of limits
3. **Cost controls** - Limits trigger correctly
4. **Error handling** - Graceful failure scenarios

### Security Testing
1. **Input validation** - Malformed requests rejected
2. **SQL injection attempts** - Protection effective
3. **Rate limit bypass attempts** - Security holds
4. **Oversized requests** - Proper rejection

### Performance Testing
1. **Load testing** - 100 concurrent users
2. **Stress testing** - System limits and degradation
3. **Cost projection** - Usage scaling scenarios
4. **Database performance** - Query optimization

## 📊 Deployment Configuration

### Lambda Settings
- **Memory:** 1GB
- **Timeout:** 30 seconds
- **Concurrency:** 100 (reserved)
- **Environment Variables:**
  - OPENAI_API_KEY
  - DYNAMODB_TABLE_COACHING
  - DYNAMODB_TABLE_ANALYSES
  - COST_LIMIT_PER_USER
  - RATE_LIMIT_PER_HOUR

### DynamoDB Configuration
- **Read Capacity:** 5 units (auto-scaling enabled)
- **Write Capacity:** 5 units (auto-scaling enabled)
- **Point-in-time recovery:** Enabled
- **Encryption:** At rest and in transit

### API Gateway Configuration
- **Rate limiting:** 100 requests per minute per IP
- **CORS:** Enabled for mobile app domains
- **Request validation:** JSON schema validation
- **Response caching:** Disabled (personalized responses)

## 🚀 Implementation Order

1. **Create DynamoDB table** and verify structure
2. **Set up IAM roles** and test permissions
3. **Implement core Lambda function** with basic functionality
4. **Add context assembly logic** and test with sample data
5. **Integrate OpenAI API** with coaching prompts
6. **Implement cost controls** and rate limiting
7. **Add security validation** and input sanitization
8. **Set up monitoring** and alerting
9. **Deploy to API Gateway** and test end-to-end
10. **Load test and optimize** performance

---

**Next Sprint:** Sprint 3B - Enhanced Follow-up API with Context Integration