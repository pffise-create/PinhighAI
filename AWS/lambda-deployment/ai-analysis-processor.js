// AI Analysis Processor - Focused Lambda for processing completed frame extractions with OpenAI
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');

// Initialize clients
let dynamodb = null;
let s3Client = null;

function getDynamoClient() {
  if (!dynamodb) {
    const client = new DynamoDBClient({});
    dynamodb = DynamoDBDocumentClient.from(client);
  }
  return dynamodb;
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

// HTTP request helper function
function makeHttpsRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Download and convert image to base64 with compression
async function downloadAndCompressImage(imageUrl) {
  try {
    // Parse the S3 URL
    const url = new URL(imageUrl);
    const key = decodeURIComponent(url.pathname.substring(1)); // Remove leading slash and decode
    const bucket = url.hostname.split('.')[0]; // Extract bucket from S3 hostname
    
    console.log(`Downloading image from S3: bucket=${bucket}, key=${key}`);
    
    const s3 = getS3Client();
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3.send(getObjectCommand);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // Simple base64 conversion
    const base64 = buffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;
    
    console.log(`Successfully converted ${key} to base64 (${buffer.length} bytes)`);
    
    return dataUrl;
    
  } catch (error) {
    console.error(`Error downloading image ${imageUrl}:`, error);
    throw error;
  }
}

// Download image as buffer for file upload
async function downloadImageAsBuffer(imageUrl) {
  try {
    // Parse the S3 URL
    const url = new URL(imageUrl);
    const key = decodeURIComponent(url.pathname.substring(1)); // Remove leading slash and decode
    const bucket = url.hostname.split('.')[0]; // Extract bucket from S3 hostname
    
    console.log(`Downloading image buffer from S3: bucket=${bucket}, key=${key}`);
    
    const s3 = getS3Client();
    
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    console.log(`Successfully downloaded image buffer: ${key} (${buffer.length} bytes)`);
    
    return buffer;
    
  } catch (error) {
    console.error(`Error downloading image buffer ${imageUrl}:`, error);
    throw error;
  }
}

// Upload image to OpenAI files API
async function uploadImageToOpenAI(imageBuffer, filename) {
  try {
    const boundary = `----WebKitFormBoundary${Math.random().toString(16).substr(2)}`;
    
    // Build multipart form data manually
    const parts = [];
    
    // Add purpose field
    parts.push(`--${boundary}\r\n`);
    parts.push('Content-Disposition: form-data; name="purpose"\r\n\r\n');
    parts.push('vision\r\n');
    
    // Add file field
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
    parts.push('Content-Type: image/jpeg\r\n\r\n');
    
    const header = Buffer.from(parts.join(''));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const formData = Buffer.concat([header, imageBuffer, footer]);
    
    console.log(`Uploading ${filename} (${imageBuffer.length} bytes)`);
    
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/files',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          console.log(`Upload response status: ${res.statusCode}`);
          console.log(`Upload response: ${body.substring(0, 200)}...`);
          
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const result = JSON.parse(body);
              if (!result.id) {
                reject(new Error(`File upload failed - no ID: ${JSON.stringify(result)}`));
              } else {
                console.log(`Successfully uploaded ${filename} as file ID: ${result.id}`);
                resolve(result.id);
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            }
          } catch (parseError) {
            reject(new Error(`Parse error: ${parseError.message} - Body: ${body}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error(`Request error uploading ${filename}:`, error);
        reject(error);
      });
      
      req.write(formData);
      req.end();
    });
  } catch (error) {
    console.error(`Error in uploadImageToOpenAI for ${filename}:`, error);
    throw error;
  }
}

// Get user thread data from DynamoDB
async function getUserThread(userId) {
  try {
    console.log(`Getting user thread for userId: ${userId}`);
    
    const dynamodb = getDynamoClient();
    
    const command = new GetCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Key: { user_id: userId }
    });
    
    const result = await dynamodb.send(command);
    
    if (result.Item) {
      console.log(`Found existing thread for user ${userId}: ${result.Item.thread_id}`);
      return result.Item;
    }
    
    console.log(`No existing thread found for user ${userId}`);
    return null;
    
  } catch (error) {
    console.error(`Error getting user thread for ${userId}:`, error);
    throw error;
  }
}

// Store user thread data in DynamoDB
async function storeUserThread(userId, threadData) {
  try {
    console.log(`Storing user thread for userId: ${userId}, threadId: ${threadData.thread_id}`);
    
    const dynamodb = getDynamoClient();
    
    const command = new PutCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Item: {
        user_id: userId,
        thread_id: threadData.thread_id,
        swing_count: threadData.swing_count || 0,
        created_at: threadData.created_at,
        updated_at: new Date().toISOString()
      }
    });
    
    await dynamodb.send(command);
    console.log(`Successfully stored thread for user ${userId}`);
    
  } catch (error) {
    console.error(`Error storing user thread for ${userId}:`, error);
    throw error;
  }
}

// Main AI analysis function using OpenAI threads
async function analyzeSwingWithGPT4o(frameData, swingData) {
  try {
    console.log('Starting analyzeSwingWithGPT4o function with Assistants API');
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }

    // Extract userId from swingData
    const analysisId = swingData.analysis_id;
    const userId = swingData.user_id;
    
    if (!userId) {
      throw new Error('userId is required for user thread management');
    }
    
    console.log(`Processing swing analysis for user: ${userId}`);
    
    // Get or create user thread
    let userThreadData = await getUserThread(userId);
    let threadId = userThreadData?.thread_id;
    
    // If no thread exists, create new OpenAI thread
    if (!threadId) {
      console.log(`Creating new coaching thread for user ${userId}`);
      const threadResponse = await makeHttpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/threads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        }
      }, JSON.stringify({}));
      
      const newThread = JSON.parse(threadResponse);
      threadId = newThread.id;
      
      userThreadData = {
        thread_id: threadId,
        swing_count: 0,
        created_at: new Date().toISOString()
      };
      await storeUserThread(userId, userThreadData);
    } else {
      console.log(`Using existing thread ${threadId} for user ${userId}`);
    }
    
    // Process all frames from frameData.frame_urls
    const allFrameUrls = frameData.frame_urls || {};
    const allFrames = Object.keys(allFrameUrls).sort().map(frameKey => ({
      phase: frameKey,
      url: allFrameUrls[frameKey]
    }));
    
    if (allFrames.length === 0) {
      throw new Error('No valid frame URLs found for analysis');
    }
    
    console.log(`Converting ${allFrames.length} frames to base64 for analysis`);
    
    // TEST: Use a simple test image first to isolate the issue
    console.log('TESTING: Using a minimal test image to debug data URL format');
    
    // Create a tiny 1x1 red pixel JPEG as base64 (known valid format)
    const testBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
    const testDataUrl = `data:image/jpeg;base64,${testBase64}`;
    
    const base64Images = [
      {
        phase: 'test_frame_000',
        image: testDataUrl
      }
    ];
    
    console.log('TEST IMAGE CREATED:');
    console.log('- Base64 length:', testBase64.length);
    console.log('- Data URL length:', testDataUrl.length);
    console.log('- Data URL starts:', testDataUrl.substring(0, 50));
    
    // TODO: Replace this test with actual frame processing once format is verified
    
    if (base64Images.length === 0) {
      throw new Error('No frame images could be converted');
    }
    
    console.log(`Successfully prepared ${base64Images.length} frames. Creating analysis messages...`);
    
    // Send frames in multiple messages (4 images max per message to stay under 10 content items)
    // Each image = 2 content items (text + image_url), so 4 images = 8 items + prompt = 9 items max
    const maxImagesPerMessage = 4;
    const batches = [];
    
    for (let i = 0; i < base64Images.length; i += maxImagesPerMessage) {
      batches.push(base64Images.slice(i, i + maxImagesPerMessage));
    }
    
    console.log(`Will send ${base64Images.length} frames across ${batches.length} messages (max ${maxImagesPerMessage} frames per message)`);
    
    console.log(`Starting to send ${batches.length} message batches:`);
    
    // Send first message with comprehensive prompt and first batch of images
    const firstBatch = batches[0];
    const firstMessageContent = [
      {
        type: "text",
        text: `You are a PGA-certified golf instructor analyzing a complete golf swing sequence of ${base64Images.length} frames.

I will send you the swing frames in multiple messages. This is message 1 of ${batches.length} containing frames: ${firstBatch.map(f => f.phase).join(', ')}

Once you receive ALL frames, provide comprehensive coaching feedback focusing on:

1. **Setup & Address Position**: Grip, stance, posture, alignment
2. **Takeaway & Backswing**: Club path, wrist hinge, shoulder turn, weight shift
3. **Transition & Downswing**: Sequence, plane, tempo  
4. **Impact Zone**: Club face, path, body position
5. **Follow-Through**: Extension, balance, finish position

Do NOT provide analysis until you receive all ${base64Images.length} frames. Simply acknowledge receipt of each batch.`
      }
    ];
    
    // Add first batch images
    firstBatch.forEach(frame => {
      firstMessageContent.push({
        type: "text", 
        text: `Frame: ${frame.phase}`
      });
      firstMessageContent.push({
        type: "image_url",
        image_url: {
          url: frame.image,
          detail: "high"
        }
      });
    });

    await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({
      role: 'user',
      content: firstMessageContent
    }));
    
    console.log(`Sent message 1 with ${firstBatch.length} frames`);
    
    // Send remaining batches
    for (let batchIndex = 1; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchMessageContent = [
        {
          type: "text",
          text: `Swing frames batch ${batchIndex + 1} of ${batches.length}: ${batch.map(f => f.phase).join(', ')}`
        }
      ];
      
      // Add batch images
      batch.forEach(frame => {
        batchMessageContent.push({
          type: "text", 
          text: `Frame: ${frame.phase}`
        });
        batchMessageContent.push({
          type: "image_url",
          image_url: {
            url: frame.image,
            detail: "high"
          }
        });
      });
      
      await makeHttpsRequest({
        hostname: 'api.openai.com',
        path: `/v1/threads/${threadId}/messages`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        }
      }, JSON.stringify({
        role: 'user',
        content: batchMessageContent
      }));
      
      console.log(`Sent batch ${batchIndex + 1} with ${batch.length} frames`);
    }
    
    // Send final analysis request
    const analysisRequest = `Now that you have received all ${base64Images.length} swing frames (${base64Images.map(f => f.phase).join(', ')}), please provide your comprehensive golf swing analysis with specific coaching feedback. Reference frame numbers when discussing technique.`;
    
    await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({
      role: 'user',
      content: analysisRequest
    }));
    
    console.log('Sent final analysis request');
    
    console.log('All frame batches sent to thread');
    
    // Create or get assistant
    const assistant = await getOrCreateGolfAssistant();
    console.log(`Using golf assistant: ${assistant.id}`);
    
    // Run the assistant
    const runResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: `/v1/threads/${threadId}/runs`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    }, JSON.stringify({
      assistant_id: assistant.id
    }));
    
    const run = JSON.parse(runResponse);
    console.log(`Started assistant run: ${run.id}`);
    
    // Poll for completion
    const analysis = await pollForCompletion(threadId, run.id);
    console.log('Analysis completed successfully');
    
    // Update swing count
    userThreadData.swing_count = (userThreadData.swing_count || 0) + 1;
    userThreadData.last_updated = new Date().toISOString();
    await storeUserThread(userId, userThreadData);
    
    return {
      success: true,
      response: analysis,
      coaching_response: analysis,
      thread_id: threadId,
      frames_analyzed: base64Images.length
    };
  } catch (error) {
    console.error('Error in analyzeSwingWithGPT4o:', error);
    throw error;
  }
}

// Process swing analysis from DynamoDB stream or direct invocation
async function processSwingAnalysis(swingData) {
  try {
    console.log('Processing swing analysis from trigger...');
    
    let analysisId, status, userId;
    
    // Handle both DynamoDB stream format and direct invocation format
    if (swingData.analysis_id?.S) {
      // DynamoDB stream format
      analysisId = swingData.analysis_id.S;
      status = swingData.status.S;
      userId = swingData.user_id?.S;
    } else {
      // Direct invocation format
      analysisId = swingData.analysis_id;
      status = swingData.status;
      userId = swingData.user_id;
    }
    
    if (!analysisId) {
      console.error('No analysis_id found in swing data');
      return;
    }
    
    console.log(`Starting AI analysis for: ${analysisId}, status: ${status}`);
    
    // Get the full analysis data from DynamoDB
    const dynamodb = getDynamoClient();
    
    const result = await dynamodb.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { analysis_id: analysisId }
    }));
    
    if (!result.Item) {
      console.error(`Analysis record not found: ${analysisId}`);
      return;
    }
    
    console.log('Got full record from DynamoDB');
    const fullSwingData = result.Item;
    
    // Check if frame data exists
    const frameData = fullSwingData.analysis_results?.frames;
    if (!frameData || frameData.length === 0) {
      console.error(`No frame data found for analysis: ${analysisId}`);
      return;
    }
    
    console.log(`Found ${frameData.length} frames for AI analysis`);
    
    // Convert frame data to expected format
    const frame_urls = {};
    frameData.forEach(frame => {
      if (frame.phase && frame.url) {
        frame_urls[frame.phase] = frame.url;
      }
    });
    
    const convertedFrameData = {
      frame_urls: frame_urls,
      video_duration: fullSwingData.analysis_results?.video_duration,
      fps: fullSwingData.analysis_results?.fps,
      frames_extracted: frameData.length
    };
    
    console.log(`Converted ${Object.keys(frame_urls).length} frame URLs for AI analysis`);
    
    // Update status to indicate AI analysis started
    await updateAnalysisStatus(analysisId, 'AI_PROCESSING', 'AI analysis in progress...');
    
    // Call AI analysis function
    const aiResult = await analyzeSwingWithGPT4o(convertedFrameData, fullSwingData);
    
    if (aiResult && aiResult.response) {
      console.log(`AI analysis completed successfully for: ${analysisId}`);
      
      // Update the record with AI analysis results
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE,
        Key: { analysis_id: analysisId },
        UpdateExpression: 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, #status = :status, progress_message = :progress, updated_at = :timestamp',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':analysis': JSON.stringify(aiResult),
          ':completed': true,
          ':status': 'AI_COMPLETED',
          ':progress': 'AI coaching analysis completed successfully',
          ':timestamp': new Date().toISOString()
        }
      }));
      
      console.log(`🎉 Analysis fully completed for: ${analysisId}`);
    } else {
      console.error(`AI analysis returned invalid result for: ${analysisId}`);
      await updateAnalysisStatus(analysisId, 'FAILED', 'AI analysis returned invalid result');
    }
    
  } catch (error) {
    console.error('Error in processSwingAnalysis:', error);
    
    // Update status to indicate failure
    const analysisId = swingData.analysis_id?.S || swingData.analysis_id;
    if (analysisId) {
      await updateAnalysisStatus(analysisId, 'FAILED', `AI analysis failed: ${error.message}`);
    }
  }
}

// Update analysis status in DynamoDB
async function updateAnalysisStatus(analysisId, status, progressMessage = null) {
  try {
    if (!analysisId) return;
    
    const dynamodb = getDynamoClient();
    
    const updateExpression = progressMessage 
      ? 'SET #status = :status, progress_message = :message, updated_at = :timestamp'
      : 'SET #status = :status, updated_at = :timestamp';
    
    const expressionAttributeValues = {
      ':status': status,
      ':timestamp': new Date().toISOString()
    };
    
    if (progressMessage) {
      expressionAttributeValues[':message'] = progressMessage;
    }
    
    const updateCommand = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { analysis_id: analysisId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: expressionAttributeValues
    });
    
    await dynamodb.send(updateCommand);
    console.log(`Updated analysis ${analysisId} status to: ${status}`);
    
  } catch (error) {
    console.error(`Error updating analysis status for ${analysisId}:`, error);
  }
}

// Main Lambda handler
exports.handler = async (event) => {
  console.log('AI ANALYSIS PROCESSOR - Event:', JSON.stringify(event, null, 2));
  console.log('AI ANALYSIS PROCESSOR - Environment Check:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    dynamoTable: process.env.DYNAMODB_TABLE,
    userThreadsTable: process.env.USER_THREADS_TABLE
  });
  
  try {
    // Handle direct invocation from frame extraction
    if (event.analysis_id && event.user_id) {
      console.log('Processing direct invocation from frame extractor');
      await processSwingAnalysis({
        analysis_id: event.analysis_id,
        user_id: event.user_id,
        status: event.status || 'COMPLETED'
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'AI analysis completed successfully' })
      };
    }
    
    // Handle DynamoDB stream records (legacy support)
    if (event.Records) {
      console.log('Processing DynamoDB stream records');
      
      for (const record of event.Records) {
        if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
          const swingData = record.dynamodb.NewImage;
          const status = swingData.status?.S;
          const aiCompleted = swingData.ai_analysis_completed?.BOOL;
          
          // Only process completed records that haven't had AI analysis yet
          if (status === 'COMPLETED' && (aiCompleted === false || aiCompleted === null || aiCompleted === undefined)) {
            await processSwingAnalysis(swingData);
          }
        }
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Stream records processed' })
      };
    }
    
    // Unknown event type
    console.log('Unknown event type received');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unknown event type' })
    };
    
  } catch (error) {
    console.error('Error in AI analysis processor:', error);
    return { 
      statusCode: 500,
      body: JSON.stringify({ error: error.message }) 
    };
  }
};