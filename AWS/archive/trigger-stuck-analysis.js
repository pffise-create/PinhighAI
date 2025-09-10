// Trigger AI analysis for stuck records
const AWS = require('@aws-sdk/client-lambda');

const lambda = new AWS.LambdaClient({ region: 'us-east-1' });

// Records that need AI analysis
const stuckRecords = [
    '1755839350950-63h9ym58s',
    '1755834886933-90e44aita', 
    '1755835149180-maqldgysh'
];

async function triggerAIAnalysis(analysisId) {
    const event = {
        Records: [{
            eventName: 'MODIFY',
            dynamodb: {
                NewImage: {
                    analysis_id: { S: analysisId },
                    status: { S: 'COMPLETED' },
                    ai_analysis_completed: { BOOL: false },
                    user_id: { S: 'guest-user' },
                    is_authenticated: { BOOL: false }
                }
            }
        }]
    };

    try {
        console.log(`Triggering AI analysis for ${analysisId}...`);
        const result = await lambda.send(new AWS.InvokeCommand({
            FunctionName: 'golf-ai-analysis',
            Payload: JSON.stringify(event)
        }));
        
        const response = JSON.parse(Buffer.from(result.Payload).toString());
        console.log(`✅ ${analysisId}: ${response.statusCode}`);
        
        if (response.statusCode !== 200) {
            console.log(`❌ Error: ${response.body}`);
        }
    } catch (error) {
        console.error(`❌ Failed to trigger ${analysisId}:`, error.message);
    }
}

async function main() {
    console.log('Triggering AI analysis for stuck records...');
    for (const analysisId of stuckRecords) {
        await triggerAIAnalysis(analysisId);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s between calls
    }
    console.log('Done!');
}

main().catch(console.error);