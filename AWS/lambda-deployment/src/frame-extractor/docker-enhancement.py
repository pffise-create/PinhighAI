# AI Trigger Enhancement for Docker Frame Extractor
# Add this code to the existing Docker container

import json
import boto3
import os

# Initialize Lambda client for triggering AI analysis
lambda_client = boto3.client('lambda')

def trigger_ai_analysis(analysis_id, user_id):
    """Trigger AI analysis processor after frame extraction completes"""
    try:
        print(f"🚀 Triggering AI analysis for: {analysis_id}")
        
        # Get function name from environment
        ai_function_name = os.environ.get('AI_ANALYSIS_PROCESSOR_FUNCTION_NAME', 'golf-ai-analysis-processor')
        
        payload = {
            'analysis_id': analysis_id,
            'user_id': user_id, 
            'status': 'COMPLETED'
        }
        
        response = lambda_client.invoke(
            FunctionName=ai_function_name,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(payload)
        )
        
        print(f"✅ Successfully triggered AI analysis for: {analysis_id}")
        print(f"Lambda response: {response.get('StatusCode', 'Unknown')}")
        return True
        
    except Exception as e:
        print(f"❌ Error triggering AI analysis for {analysis_id}: {str(e)}")
        # Don't raise - we want the frame extraction to succeed even if AI trigger fails
        return False

def extract_analysis_id_from_key(video_key):
    """Extract analysis ID from S3 key filename"""
    parts = video_key.split('/')
    if len(parts) >= 3:
        filename = parts[2]
        # Remove file extension
        for ext in ['.mov', '.mp4', '.avi', '.m4v']:
            filename = filename.replace(ext, '')
        return filename
    return None

def extract_user_id_from_key(video_key):
    """Extract user ID from S3 key path"""
    parts = video_key.split('/')
    if len(parts) >= 2 and parts[0] == 'golf-swings':
        return parts[1]
    return 'unknown-user'

# INTEGRATION POINT: Add this call at the end of your Docker container's main processing function
# After frame extraction completes and DynamoDB is updated with results, add:

def integrate_ai_trigger(event):
    """
    Integration function - call this at the end of your Docker frame extraction
    """
    try:
        # Handle both S3 event and direct invocation formats
        if 'Records' in event:
            # S3 event format
            video_key = event['Records'][0]['s3']['object']['key']
            analysis_id = extract_analysis_id_from_key(video_key)
            user_id = extract_user_id_from_key(video_key)
        else:
            # Direct invocation format
            analysis_id = event.get('analysis_id')
            user_id = event.get('user_id', 'guest-user')
        
        if analysis_id and user_id:
            success = trigger_ai_analysis(analysis_id, user_id)
            return {
                'ai_trigger_success': success,
                'analysis_id': analysis_id,
                'user_id': user_id
            }
    except Exception as e:
        print(f"AI trigger integration error: {str(e)}")
        return {'ai_trigger_success': False, 'error': str(e)}

# EXAMPLE INTEGRATION:
# At the end of your Docker lambda_handler function, add:
#
# # Trigger AI analysis
# ai_result = integrate_ai_trigger(event)
# print(f"AI trigger result: {ai_result}")
#
# return {
#     'statusCode': 200,
#     'body': json.dumps({
#         'message': 'Frame extraction completed successfully',
#         'frames_extracted': len(extracted_frames),
#         'ai_trigger': ai_result
#     })
# }