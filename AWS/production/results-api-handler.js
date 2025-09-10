// Results API Handler - Focused Lambda for retrieving analysis results
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize clients
let dynamodb = null;

function getDynamoClient() {
  if (!dynamodb) {
    const client = new DynamoDBClient({});
    dynamodb = DynamoDBDocumentClient.from(client);
  }
  return dynamodb;
}

// Main function to handle GET results requests
async function handleGetResults(jobId) {
  try {
    console.log(`Fetching results for jobId: ${jobId}`);
    
    const dynamodb = getDynamoClient();
    
    // Get the analysis from DynamoDB
    const command = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { analysis_id: jobId }
    });
    
    const result = await dynamodb.send(command);
    
    if (!result.Item) {
      console.log(`Analysis not found for jobId: ${jobId}`);
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Analysis not found',
          jobId: jobId
        })
      };
    }
    
    // Determine the status based on what's in the record
    let status = 'processing';
    if (result.Item.ai_analysis_completed) {
      status = 'completed';
    } else if (result.Item.status === 'FAILED') {
      status = 'failed';
    } else if (result.Item.status === 'COMPLETED' || result.Item.status === 'READY_FOR_AI') {
      status = 'analyzing';
    } else if (result.Item.status === 'AI_PROCESSING') {
      status = 'analyzing';
    } else if (result.Item.status === 'AI_COMPLETED') {
      status = 'completed';
    } else if (result.Item.status === 'PROCESSING') {
      status = 'processing';
    } else if (result.Item.status) {
      status = result.Item.status.toLowerCase();
    }
    
    // Build the response
    const response = {
      jobId: jobId,
      status: status,
      message: result.Item.progress_message || 'Processing...',
      created_at: result.Item.created_at,
      updated_at: result.Item.updated_at
    };
    
    // If AI analysis is complete, include it
    if (result.Item.ai_analysis_completed && result.Item.ai_analysis) {
      response.ai_analysis = result.Item.ai_analysis;
      response.ai_analysis_completed = true;
      
      // Parse the AI analysis if it's a string
      if (typeof result.Item.ai_analysis === 'string') {
        try {
          response.ai_analysis = JSON.parse(result.Item.ai_analysis);
        } catch (e) {
          console.warn(`Failed to parse AI analysis JSON for ${jobId}:`, e);
          // Keep as string if parsing fails
        }
      }
    }
    
    // Include analysis results if available (frame data)
    if (result.Item.analysis_results) {
      response.analysis_results = result.Item.analysis_results;
    }
    
    // Include user context for tracking
    if (result.Item.user_id) {
      response.user_id = result.Item.user_id;
    }
    if (result.Item.user_type) {
      response.user_type = result.Item.user_type;
    }
    if (result.Item.is_authenticated !== undefined) {
      response.is_authenticated = result.Item.is_authenticated;
    }
    
    console.log(`Returning results for ${jobId}, status: ${status}`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('Error fetching results:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to fetch results',
        message: error.message,
        jobId: jobId
      })
    };
  }
}

// Main Lambda handler
exports.handler = async (event) => {
  console.log('RESULTS API HANDLER - Event:', JSON.stringify(event, null, 2));
  console.log('RESULTS API HANDLER - Environment Check:', {
    dynamoTable: process.env.DYNAMODB_TABLE
  });
  
  try {
    // Validate this is a GET request with jobId
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: 'Method not allowed - GET required',
          method: event.httpMethod
        })
      };
    }
    
    // Extract jobId from path parameters
    const jobId = event.pathParameters?.jobId;
    
    if (!jobId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: 'Missing required path parameter: jobId',
          pathParameters: event.pathParameters
        })
      };
    }
    
    // Handle the results request
    return await handleGetResults(jobId);
    
  } catch (error) {
    console.error('Error in results API handler:', error);
    return { 
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: error.message
      }) 
    };
  }
};