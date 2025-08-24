# User Data Structure and Profile Storage Design

## Overview
This document defines the data structure for user profiles, coaching history, and analytics in the Golf Coach AI system.

## User Profile Data Structure

### Core User Information
```json
{
  "user_id": "cognito-user-uuid",
  "email": "user@example.com", 
  "name": "John Doe",
  "picture": "https://profile-picture-url.jpg",
  "user_type": "authenticated|guest|premium",
  "subscription_tier": "free|premium|pro",
  "created_at": "2025-08-21T10:00:00Z",
  "last_active": "2025-08-21T15:30:00Z"
}
```

### Golf Profile Information
```json
{
  "golf_profile": {
    "handicap": 14,
    "dominant_hand": "right",
    "experience_level": "intermediate", // beginner|intermediate|advanced|professional
    "preferred_coaching_style": "technical|feel|hybrid",
    "goals": [
      "reduce_slice",
      "improve_distance", 
      "better_short_game"
    ],
    "physical_limitations": [
      "back_issues",
      "limited_rotation"
    ]
  }
}
```

## DynamoDB Table Structures

### 1. User Profiles Table: `golf-coach-users`
```json
{
  "TableName": "golf-coach-users",
  "KeySchema": [
    {
      "AttributeName": "user_id",
      "KeyType": "HASH"
    }
  ],
  "AttributeDefinitions": [
    {
      "AttributeName": "user_id", 
      "AttributeType": "S"
    },
    {
      "AttributeName": "email",
      "AttributeType": "S" 
    }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "email-index",
      "KeySchema": [
        {
          "AttributeName": "email",
          "KeyType": "HASH"
        }
      ]
    }
  ]
}
```

### 2. Enhanced Analyses Table: `golf-coach-analyses`
Current structure enhanced with user context:
```json
{
  "analysis_id": "analysis-123",
  "user_id": "cognito-user-id",
  "user_email": "user@example.com",
  "user_name": "John Doe",
  "user_type": "authenticated|guest", 
  "is_authenticated": true,
  
  // Existing fields
  "status": "COMPLETED",
  "s3_key": "videos/video.mp4",
  "bucket_name": "golf-videos",
  "ai_analysis": {
    "technical_analysis": "...",
    "coaching_recommendations": "...",
    "focus_areas": ["backswing_plane", "impact_position"],
    "confidence_scores": {
      "backswing_plane": 0.95,
      "impact_position": 0.87
    }
  },
  "coaching_context": {
    "session_number": 5,
    "previous_focus_areas": ["grip", "stance"],
    "improvement_areas": ["impact"],
    "coaching_style": "technical"
  },
  "created_at": "2025-08-21T10:00:00Z",
  "updated_at": "2025-08-21T10:05:00Z"
}
```

### 3. Coaching Sessions Table: `golf-coach-sessions`
```json
{
  "session_id": "session-uuid",
  "user_id": "cognito-user-id",
  "analysis_ids": ["analysis-1", "analysis-2", "analysis-3"],
  "session_date": "2025-08-21",
  "focus_areas": ["backswing_plane", "impact_position"],
  "coaching_plan": {
    "primary_focus": "backswing_plane",
    "secondary_focuses": ["impact_position"],
    "drills_recommended": [
      {
        "drill_name": "Mirror Work",
        "description": "Practice backswing plane with mirror feedback",
        "frequency": "5 minutes daily"
      }
    ]
  },
  "progress_metrics": {
    "improvement_score": 0.75,
    "consistency_score": 0.82,
    "areas_improved": ["grip"],
    "areas_needing_work": ["follow_through"]
  },
  "next_session_plan": {
    "recommended_date": "2025-08-28",
    "focus_areas": ["impact_position", "follow_through"],
    "preparation_notes": "Continue mirror work for backswing"
  },
  "created_at": "2025-08-21T10:00:00Z"
}
```

### 4. Progress Tracking Table: `golf-coach-progress`
```json
{
  "progress_id": "progress-uuid",
  "user_id": "cognito-user-id", 
  "metric_type": "handicap|consistency|distance|accuracy",
  "metric_value": 14.2,
  "measurement_date": "2025-08-21",
  "measurement_method": "self_reported|calculated|measured",
  "context": {
    "course_played": "Pebble Beach",
    "conditions": "windy",
    "notes": "Played in challenging conditions"
  },
  "trend_data": {
    "previous_value": 15.1,
    "change": -0.9,
    "trend": "improving",
    "confidence": 0.85
  },
  "created_at": "2025-08-21T10:00:00Z"
}
```

## Data Access Patterns

### 1. User Profile Management
```javascript
// Get user profile
const getUserProfile = async (userId) => {
  const params = {
    TableName: 'golf-coach-users',
    Key: { user_id: userId }
  };
  return await dynamodb.send(new GetCommand(params));
};

// Update user profile  
const updateUserProfile = async (userId, updates) => {
  const params = {
    TableName: 'golf-coach-users',
    Key: { user_id: userId },
    UpdateExpression: 'SET #attr = :val, updated_at = :timestamp',
    ExpressionAttributeNames: { '#attr': Object.keys(updates)[0] },
    ExpressionAttributeValues: { 
      ':val': Object.values(updates)[0],
      ':timestamp': new Date().toISOString()
    }
  };
  return await dynamodb.send(new UpdateCommand(params));
};
```

### 2. Coaching History Retrieval
```javascript
// Get user's coaching history (for context-aware responses)
const getUserCoachingHistory = async (userId, limit = 10) => {
  const params = {
    TableName: 'golf-coach-analyses',
    IndexName: 'user-date-index',
    KeyConditionExpression: 'user_id = :userId',
    ExpressionAttributeValues: { ':userId': userId },
    ScanIndexForward: false, // Latest first
    Limit: limit,
    FilterExpression: 'attribute_exists(ai_analysis)'
  };
  return await dynamodb.send(new QueryCommand(params));
};
```

### 3. Progress Analytics
```javascript
// Get user's progress over time
const getUserProgress = async (userId, metricType, timeframe = '3months') => {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 3);
  
  const params = {
    TableName: 'golf-coach-progress',
    IndexName: 'user-metric-date-index',
    KeyConditionExpression: 'user_id = :userId AND metric_type = :metricType',
    FilterExpression: 'measurement_date >= :cutoff',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':metricType': metricType,
      ':cutoff': cutoffDate.toISOString().split('T')[0]
    },
    ScanIndexForward: true // Chronological order
  };
  return await dynamodb.send(new QueryCommand(params));
};
```

## Privacy and Data Management

### 1. Data Retention Policies
- **Guest Users**: Data retained for 30 days, then deleted
- **Authenticated Users**: Data retained indefinitely unless user requests deletion
- **Inactive Users**: Data archived after 1 year of inactivity

### 2. User Data Export
```javascript
// Export all user data (GDPR compliance)
const exportUserData = async (userId) => {
  const userData = {
    profile: await getUserProfile(userId),
    analyses: await getUserAnalyses(userId),
    sessions: await getUserSessions(userId), 
    progress: await getUserProgress(userId)
  };
  return userData;
};
```

### 3. User Data Deletion
```javascript
// Delete all user data (GDPR right to be forgotten)
const deleteUserData = async (userId) => {
  // Delete from all tables
  await deleteFromTable('golf-coach-users', userId);
  await deleteFromTable('golf-coach-analyses', userId); 
  await deleteFromTable('golf-coach-sessions', userId);
  await deleteFromTable('golf-coach-progress', userId);
};
```

## Coaching Intelligence Features

### 1. Personalized Coaching Context
The system builds personalized coaching by analyzing:
- User's coaching history and progress patterns
- Previous focus areas and improvement rates
- Preferred coaching style (technical vs feel-based)
- Physical limitations and constraints

### 2. Smart Focus Area Management
- Maximum 3 active focus areas per user
- Automatic graduation when consistent improvement is shown
- Priority system for introducing new focus areas
- Context-aware coaching that builds on previous sessions

### 3. Progress Tracking and Analytics
- Objective metrics: handicap, consistency scores, distance
- Subjective feedback: user satisfaction, perceived improvement
- Trend analysis and predictive coaching recommendations
- Comparative analysis against similar golfers

## Implementation Priority

### Phase 1: Basic User Management
- ✅ Enhanced DynamoDB analyses table with user context
- ⚠️ Create golf-coach-users table
- ⚠️ Implement basic profile management in React Native app

### Phase 2: Coaching Intelligence  
- Implement coaching history retrieval
- Add session tracking and management
- Build progress analytics dashboard

### Phase 3: Advanced Features
- Predictive coaching recommendations
- Comparative analytics
- Social features and sharing

## Technical Considerations

### 1. Performance
- Use DynamoDB indexes efficiently for user-specific queries
- Cache frequently accessed user data in Lambda memory
- Implement pagination for large coaching histories

### 2. Scalability
- Partition data by user_id for horizontal scaling
- Use DynamoDB auto-scaling for varying loads
- Consider read replicas for analytics queries

### 3. Security
- All user data queries filtered by authenticated user_id
- No cross-user data access
- Encrypt sensitive profile information at rest