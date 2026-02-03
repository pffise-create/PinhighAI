// AI Analysis Processor - Focused Lambda for processing completed frame extractions with Amazon Bedrock
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const https = require('https');

// Initialize clients
let dynamodb = null;
let s3Client = null;
let secretsManager = null;
let cachedOpenAIKey = null;

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

function getSecretsManagerClient() {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
}

async function ensureOpenAIKey() {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  if (process.env.OPENAI_API_KEY) {
    cachedOpenAIKey = process.env.OPENAI_API_KEY;
    return cachedOpenAIKey;
  }
  const secretId = process.env.OPENAI_SECRET_NAME || process.env.OPENAI_SECRET_ARN;
  if (!secretId) {
    throw new Error('OPENAI_API_KEY not configured. Set OPENAI_SECRET_NAME or OPENAI_SECRET_ARN.');
  }
  const sm = getSecretsManagerClient();
  const resp = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!resp.SecretString) {
    throw new Error('OpenAI secret is empty');
  }
  cachedOpenAIKey = resp.SecretString;
  process.env.OPENAI_API_KEY = resp.SecretString;
  return cachedOpenAIKey;
}

// HTTP request helper for OpenAI API
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

// Get or create user thread for OpenAI Assistant
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
    
    console.log(`No existing thread found for user ${userId}, creating new thread`);
    
    // Create new OpenAI thread
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
    const threadData = {
      user_id: userId,
      thread_id: newThread.id,
      swing_count: 0,
      message_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Store in DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Item: threadData
    }));
    
    console.log(`Created new thread ${newThread.id} for user ${userId}`);
    return threadData;
    
  } catch (error) {
    console.error(`Error getting/creating user thread for ${userId}:`, error);
    throw error;
  }
}

// Add analysis results to user's assistant thread
async function addAnalysisToUserThread(userId, analysis, analysisId) {
  try {
    console.log(`Adding swing analysis to user thread for: ${userId}`);
    
    // Get or create user thread
    const userThread = await getUserThread(userId);
    const threadId = userThread.thread_id;
    
    // Format the analysis message
    const analysisMessage = `**Swing Analysis Complete** (ID: ${analysisId})

${analysis}

You can ask me questions about this analysis or request tips for improvement!`;
    
    // Add message to OpenAI thread
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
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: analysisMessage
        }
      ]
    }));
    
    // Update thread metadata
    const dynamodb = getDynamoClient();
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.USER_THREADS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET swing_count = swing_count + :inc, updated_at = :timestamp',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':timestamp': new Date().toISOString()
      }
    }));
    
    console.log(`Analysis automatically added to thread ${threadId} for user ${userId}`);
    
  } catch (error) {
    console.error(`Error adding analysis to user thread for ${userId}:`, error);
    // Don't throw - analysis succeeded even if thread posting failed
    console.warn('Analysis completed but thread posting failed - user can still access results');
  }
}

// Main AI analysis function using OpenAI GPT-5
async function analyzeSwingWithGPT5(frameData, swingData) {
  try {
    console.log('Starting analyzeSwingWithGPT5 function with OpenAI GPT-5');

    // Extract userId from swingData
    const analysisId = swingData.analysis_id;
    const userId = swingData.user_id;
    
    console.log(`Processing swing analysis for user: ${userId}`);
    
    // Process all frames from frameData.frame_urls
    const allFrameUrls = frameData.frame_urls || {};
    const allFrames = Object.keys(allFrameUrls).sort().map(frameKey => ({
      phase: frameKey,
      url: allFrameUrls[frameKey]
    }));
    
    if (allFrames.length === 0) {
      throw new Error('No valid frame URLs found for analysis');
    }
    
    console.log(`Converting ${allFrames.length} frames to base64 for GPT-5 analysis`);
    
    // Download and convert all frames to base64
    const base64Images = [];
    for (const frame of allFrames) {
      try {
        console.log(`Processing frame: ${frame.phase}`);
        const base64Image = await downloadAndCompressImage(frame.url);
        base64Images.push({
          phase: frame.phase,
          image: base64Image
        });
        console.log(`Successfully converted frame ${frame.phase} to base64`);
      } catch (error) {
        console.error(`Failed to process frame ${frame.phase}:`, error.message);
      }
    }
    
    if (base64Images.length === 0) {
      throw new Error('No frame images could be converted');
    }
    
    console.log(`Successfully prepared ${base64Images.length} frames for GPT-5 analysis`);
    
    // GPT-5 has a 10-image limit, so we need to batch the frames
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < base64Images.length; i += batchSize) {
      batches.push(base64Images.slice(i, i + batchSize));
    }
    
    console.log(`Splitting ${base64Images.length} frames into ${batches.length} batches for GPT-5`);
    
    const batchResults = [];
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const isFirstBatch = batchIndex === 0;
      const isLastBatch = batchIndex === batches.length - 1;
      
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} frames`);
      
      // Build the message content for this batch
      const messageContent = [
        {
          type: "text",
          text: isFirstBatch
            ? `You are Pin High, an AI-powered golf coach and supportive golf buddy with Tour-level analysis. You're reviewing a golfer's swing from sequential image batches that together represent the full video. The player is roughly an 8-25 handicapper. Stay conversational, encouraging, and a little playful while diagnosing the underlying swing fundamentals instead of just the symptoms. Avoid referencing frames, images, batches, or stills in your response. Use plain language with precise golf terms when they clarify the point. Explain what the body and club are doing, why it matters, and set the player up with actionable next steps. Provide:

1. Key strengths to reinforce
2. Primary root-cause diagnosis (plain language, connect multiple issues)
3. Priority corrections (ordered list with concise rationale)
4. Practice plan (drills or feels tailored to this player)

Wrap up by reminding the player that progress is iterative and that you're in it together.`
            : `Continue as Pin High analyzing the same swing video. Integrate what you see here with earlier batches so the player hears one cohesive story. Keep the conversational, encouraging, slightly playful tone, stay focused on root causes, and avoid mentioning frames, images, or batches. Highlight what the body and club are doing, why it matters, and set up actionable adjustments.`
        }
      ];

      // Attach frames with internal-only labels to preserve order
      batch.forEach(frame => {
        messageContent.push({
          type: "text",
          text: `Internal reference only: ${frame.phase}`
        });
        messageContent.push({
          type: "image_url",
          image_url: {
            url: frame.image
          }
        });
      });

      console.log(`Sending batch ${batchIndex + 1} with ${batch.length} frames to GPT-5 for analysis`);

      // Prepare OpenAI API request for this batch
      const openaiRequest = {
        model: "gpt-5", // GPT-5 with vision
        messages: [
          {
            role: "user",
            content: messageContent
          }
        ],
        max_completion_tokens: 2000,
        reasoning_effort: "low" // Required for GPT-5
      };
      
      console.log(`Sending GPT-5 request for batch ${batchIndex + 1}:`, JSON.stringify(openaiRequest, null, 2));

      const response = await makeHttpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(openaiRequest));
      
      const responseBody = JSON.parse(response);
      
      console.log(`GPT-5 response received for batch ${batchIndex + 1}:`, JSON.stringify(responseBody, null, 2));
    
      if (!responseBody.choices || !responseBody.choices[0] || !responseBody.choices[0].message) {
        console.error(`Invalid response structure for batch ${batchIndex + 1}:`, responseBody);
        throw new Error(`Invalid response from OpenAI GPT-5 API for batch ${batchIndex + 1}`);
      }

      const batchAnalysis = responseBody.choices[0].message.content;
      
      if (!batchAnalysis) {
        console.error(`Empty analysis content for batch ${batchIndex + 1}:`, responseBody.choices[0].message);
        throw new Error(`GPT-5 returned empty analysis content for batch ${batchIndex + 1}`);
      }
      
      console.log(`Batch ${batchIndex + 1} analysis length: ${batchAnalysis.length} characters`);
      batchResults.push({
        batchIndex: batchIndex + 1,
        frames: batch.map(f => f.phase),
        analysis: batchAnalysis,
        tokensUsed: responseBody.usage?.total_tokens || 0
      });
    }
    
    // Combine all batch results into a cohesive narrative
    console.log(`Combining results from ${batchResults.length} batches`);

    const segmentText = batchResults
      .map((result, index) => `Segment ${index + 1} analysis:\n${result.analysis}`)
      .join('\n\n');

    const consolidationRequest = {
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are Pin High, an AI-powered golf coach and supportive golf buddy with Tour-level analysis. Deliver a cohesive swing review that feels conversational, encouraging, and focused on root causes. Use plain language with precise golf terms when they help. Reinforce strengths, explain what the body and club are doing, outline prioritized corrections with rationale, share tailored drills, and remind the player that progress is iterative and you're alongside them.`
        },
        {
          role: "user",
          content: `You're Pin High continuing with the same golfer. Combine the insights below into a single, cohesive coaching report as if you watched the full swing end-to-end. Keep the tone conversational, encouraging, and a little playful while staying Tour-level insightful. Focus on root causes instead of just symptoms, and avoid mentioning batches, frames, or images. Structure the response with:\n\n- Opening encouragement (1 short paragraph)\n- Key strengths (bullet list, 2-3 items)\n- Primary root cause diagnosis (plain language, 2-3 sentences)\n- Priority corrections (ordered list, max 3 items, each with a short rationale)\n- Practice plan (1-2 drills or feels tied to the corrections)\n\nClose by reminding the player that progress is iterative and, if it feels natural, ask one short check-in question to keep the coaching dialogue going.\n\nSegment analyses:\n${segmentText}`
        }
      ],
      max_completion_tokens: 1600
    };

    const consolidationResponse = await makeHttpsRequest({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(consolidationRequest));

    const consolidationBody = JSON.parse(consolidationResponse);
    const finalAnalysis = consolidationBody.choices?.[0]?.message?.content;

    if (!finalAnalysis) {
      console.error('Consolidation response missing content:', consolidationBody);
      throw new Error('Failed to build cohesive swing analysis');
    }

    const totalTokens = batchResults.reduce((sum, result) => sum + (result.tokensUsed || 0), 0) +
      (consolidationBody.usage?.total_tokens || 0);

    console.log(`Final consolidated analysis length: ${finalAnalysis.length} characters`);

    // Automatically post consolidated analysis to user's assistant thread
    await addAnalysisToUserThread(userId, finalAnalysis, analysisId);

    return {
      success: true,
      response: finalAnalysis,
      coaching_response: finalAnalysis,
      frames_analyzed: base64Images.length,
      frames_skipped: 0,
      fallback_triggered: false,
      fallback_reason: null,
      skipped_frames: [],
      tokens_used: totalTokens,
      batches_processed: batchResults.length
    };
    
  } catch (error) {
    console.error('Error in analyzeSwingWithClaude:', error);
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
    
    // Check if frame data exists - frames are stored directly in analysis_results
    const frameData = fullSwingData.analysis_results?.frames;
    if (!frameData || frameData.length === 0) {
      console.error(`No frame data found for analysis: ${analysisId}. Available analysis_results structure:`, JSON.stringify(fullSwingData.analysis_results, null, 2));
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
    const aiResult = await analyzeSwingWithGPT5(convertedFrameData, fullSwingData);
    
    if (aiResult && aiResult.response) {
      console.log(`AI analysis completed successfully for: ${analysisId}`);
      
      // Log fallback status if triggered
      if (aiResult.fallback_triggered) {
        console.warn(`🚨 ANALYSIS COMPLETED WITH FALLBACK: ${analysisId}`);
        console.warn(`🚨 FALLBACK DETAILS: ${aiResult.fallback_reason}`);
        console.warn(`🚨 FRAMES: ${aiResult.frames_analyzed} analyzed, ${aiResult.frames_skipped} skipped`);
      }
      
      // Update the record with AI analysis results and fallback tracking
      await dynamodb.send(new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE,
        Key: { analysis_id: analysisId },
        UpdateExpression: 'SET ai_analysis = :analysis, ai_analysis_completed = :completed, #status = :status, progress_message = :progress, updated_at = :timestamp, fallback_triggered = :fallback, frames_analyzed = :frames_analyzed, frames_skipped = :frames_skipped',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':analysis': JSON.stringify(aiResult),
          ':completed': true,
          ':status': 'AI_COMPLETED',
          ':progress': aiResult.fallback_triggered 
            ? `AI analysis completed with fallback (${aiResult.frames_skipped} frames skipped)`
            : 'AI coaching analysis completed successfully',
          ':timestamp': new Date().toISOString(),
          ':fallback': aiResult.fallback_triggered || false,
          ':frames_analyzed': aiResult.frames_analyzed || 0,
          ':frames_skipped': aiResult.frames_skipped || 0
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
    await ensureOpenAIKey();
    
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
    
    // Handle SQS events from frame extractor queue
    if (event.Records && event.Records[0]?.eventSource === 'aws:sqs') {
      console.log(`Processing ${event.Records.length} SQS messages for AI analysis`);

      for (const record of event.Records) {
        try {
          const messageAttributes = record.messageAttributes || {};
          const body = typeof record.body === 'string' ? JSON.parse(record.body) : (record.body || {});

          const analysisId = body.analysis_id || messageAttributes.analysis_id?.stringValue;
          const userId = body.user_id || messageAttributes.user_id?.stringValue;
          const status = body.status || messageAttributes.status?.stringValue || 'COMPLETED';

          if (!analysisId) {
            console.warn('SQS message missing analysis_id, skipping:', record.messageId);
            continue;
          }

          await processSwingAnalysis({
            analysis_id: analysisId,
            user_id: userId,
            status: status
          });
        } catch (error) {
          console.error('Error processing SQS message:', record.messageId, error);
          throw error;
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'SQS messages processed', processed: event.Records.length })
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
