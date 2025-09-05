# Technical System Audit Prompt for Claude-Code

**Copy and paste this prompt to Claude-code along with all your project files:**

---

## Objective
Create a comprehensive technical audit document for a golf coaching app that combines React Native frontend with AWS serverless backend. The system is experiencing frequent failures and needs rearchitecting. Document everything needed for a successful redesign.

## Context
This is a mobile golf coaching app where users upload swing videos for AI analysis. The app has two working but disconnected components:
1. React Native mobile app (currently mock functionality)  
2. AWS serverless backend (video processing + AI analysis)

The main blocker is unreliable integration between these systems.

## Required Documentation Structure

### 1. AWS Backend Architecture Audit

**Infrastructure Inventory:**
- List all AWS resources (Lambda functions, DynamoDB tables, S3 buckets, API Gateway endpoints)
- Document function names, purposes, and trigger relationships
- Map the complete data flow from video upload through AI analysis
- Identify all environment variables and configuration dependencies

**Lambda Function Analysis:**
- Analyze each Lambda function's responsibilities and code complexity
- Document timeout settings, memory allocation, and runtime requirements
- Identify functions that violate single responsibility principle
- Map function invocation patterns and dependencies

**Data Architecture:**
- Document all DynamoDB table schemas and access patterns
- Map data relationships and how records flow between tables
- Identify S3 bucket structure and file organization
- Document API Gateway routes and their Lambda integrations

**Error Pattern Analysis:**
- Review CloudWatch logs patterns (if accessible)
- Identify common failure points from code structure
- Document error handling patterns and inconsistencies
- Map potential race conditions and timing issues

### 2. React Native Frontend Audit

**App Architecture Analysis:**
- Document navigation structure and screen hierarchy
- List all components and their dependencies
- Identify state management approach and data flow
- Map service files and their responsibilities

**Integration Points:**
- Document all API call locations and endpoints
- Identify authentication/authorization implementation
- Map data storage patterns (AsyncStorage, etc.)
- Document video recording and upload implementation

**Mock vs Real Functionality:**
- Clearly identify which features are mock vs working
- Document data flow gaps between frontend and backend
- Identify missing integration points

### 3. Critical Integration Analysis

**Authentication Flow:**
- Document current user authentication approach
- Map user ID handling between frontend and backend
- Identify authentication state management

**Video Upload Pipeline:**
- Document the complete video upload flow (or planned flow)
- Identify presigned URL generation and usage
- Map error handling for failed uploads

**API Communication:**
- Document all REST endpoints and their purposes
- Identify missing endpoints needed for full functionality
- Map request/response formats and error handling

### 4. Configuration and Environment Management

**Environment Variables:**
- List all environment variables across all services
- Identify missing or misconfigured variables
- Document secrets management approach

**Deployment Architecture:**
- Document how code is deployed to AWS
- Identify version control and deployment process
- Map development vs production environment differences

### 5. Performance and Cost Analysis

**Resource Utilization:**
- Analyze Lambda function resource allocation efficiency
- Identify over-provisioned or under-provisioned functions
- Document current cost structure and optimization opportunities

**Scalability Concerns:**
- Identify bottlenecks in the current architecture
- Document concurrent execution limitations
- Map potential scaling failure points

### 6. Failure Risk Assessment

**Single Points of Failure:**
- Identify critical dependencies that could break the entire system
- Document functions that are too complex or handle too many responsibilities
- Map data consistency risks

**Error Recovery:**
- Document current error handling and recovery mechanisms
- Identify gaps in error reporting and monitoring
- Map user experience during failure scenarios

### 7. Rearchitecture Recommendations

**Immediate Fixes:**
- Prioritize critical issues that could be fixed quickly
- Identify environment configuration issues
- Document simple integration points that could be established

**Structural Improvements:**
- Recommend function decomposition strategies
- Suggest improved error handling patterns
- Propose better integration architecture

**Long-term Architecture:**
- Suggest optimal service separation
- Recommend monitoring and observability improvements
- Propose cost optimization strategies

## Deliverable Format

Create a single comprehensive document that includes:

1. **Executive Summary** - Key findings and critical issues
2. **Current State Assessment** - Complete system documentation
3. **Risk Analysis** - Failure points and reliability concerns  
4. **Rearchitecture Roadmap** - Prioritized improvement plan
5. **Integration Blueprint** - Specific steps to connect frontend/backend

## Instructions for Claude-Code

1. **Analyze all provided files systematically** - Don't skip any service or component
2. **Focus on integration gaps** - Where are the disconnection points?
3. **Identify architectural violations** - What's causing the reliability issues?
4. **Be specific and actionable** - Include exact file names, function names, and line references where relevant
5. **Prioritize by impact** - What changes would have the most reliability improvement?

## File Analysis Priority

**High Priority Files:**
- Any Lambda function handler files (especially AI analysis functions)
- React Native service files (API communication, video handling)
- DynamoDB schema and data access patterns
- API Gateway configuration

**Medium Priority Files:**
- React Native screen components
- Utility and helper functions
- Configuration and environment files

**Context Files:**
- Documentation files
- Package.json files
- Any infrastructure-as-code files

---

**Upload all your project files and use this prompt to get the comprehensive technical audit needed for successful rearchitecting.**