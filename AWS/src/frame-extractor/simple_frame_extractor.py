import json
import boto3
import tempfile
import os
import subprocess
import uuid
from datetime import datetime

s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')
dynamodb = boto3.resource('dynamodb')
analyses_table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE', 'golf-coach-analyses'))

def lambda_handler(event, context):
    temp_video_path = None
    temp_files = []
    
    try:
        # Handle both S3 event and direct invocation formats
        if 'Records' in event:
            # S3 event format
            bucket_name = event['Records'][0]['s3']['bucket']['name']
            video_key = event['Records'][0]['s3']['object']['key']
            analysis_id = extract_analysis_id_from_key(video_key) or str(uuid.uuid4())
            user_id = extract_user_id_from_key(video_key)
        else:
            # Direct invocation format
            bucket_name = event['s3_bucket']
            video_key = event['s3_key']
            analysis_id = event['analysis_id']
            user_id = event['user_id']
        
        print(f"🏌️ Simple Frame Extraction: {bucket_name}/{video_key}")
        
        update_progress(analysis_id, user_id, "PROCESSING", "Frame extraction starting...")
        
        # Download video
        temp_video_path = download_video_from_s3(bucket_name, video_key)
        
        # Extract frames every 0.25 seconds using ffmpeg
        extracted_frames = extract_frames_ffmpeg(temp_video_path, analysis_id)
        
        # Upload frames to S3
        frame_analysis = upload_frames_to_s3(extracted_frames, bucket_name, analysis_id, user_id)
        
        update_progress(analysis_id, user_id, "COMPLETED", 
                       f"Frame extraction completed. Extracted {len(extracted_frames)} frames for analysis.", 
                       frame_analysis)
        
        # Trigger AI analysis processor
        trigger_ai_analysis(analysis_id, user_id)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'analysis_id': analysis_id,
                'status': 'completed',
                'message': f'Frame extraction successful! Extracted {len(extracted_frames)} frames.',
                'frames_extracted': len(extracted_frames)
            })
        }
        
    except Exception as e:
        print(f"Frame extraction error: {str(e)}")
        if 'analysis_id' in locals() and 'user_id' in locals():
            update_progress(analysis_id, user_id, "FAILED", f"Frame extraction failed: {str(e)}")
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}
    
    finally:
        # Cleanup
        if temp_video_path and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)

def extract_user_id_from_key(video_key):
    parts = video_key.split('/')
    if len(parts) >= 2 and parts[0] == 'golf-swings':
        return parts[1] 
    return 'unknown-user'

def extract_analysis_id_from_key(video_key):
    parts = video_key.split('/')
    if len(parts) >= 3:
        filename = parts[2].replace('.mov', '').replace('.mp4', '').replace('.avi', '')
        return filename
    return None

def download_video_from_s3(bucket_name, video_key):
    temp_video = tempfile.NamedTemporaryFile(delete=False, suffix='.mov')
    temp_video_path = temp_video.name
    temp_video.close()
    
    s3_client.download_file(bucket_name, video_key, temp_video_path)
    print(f"Downloaded video: {temp_video_path}")
    return temp_video_path

def extract_frames_ffmpeg(video_path, analysis_id):
    """Extract frames every 0.25 seconds using ffmpeg"""
    try:
        # Get video duration first
        duration_cmd = [
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', video_path
        ]
        duration_result = subprocess.run(duration_cmd, capture_output=True, text=True)
        video_duration = float(duration_result.stdout.strip())
        
        print(f"Video duration: {video_duration} seconds")
        
        # Create temp directory for frames
        temp_dir = tempfile.mkdtemp()
        frame_pattern = os.path.join(temp_dir, f"{analysis_id}_frame_%03d.jpg")
        
        # Extract frames every 0.25 seconds
        ffmpeg_cmd = [
            'ffmpeg', '-i', video_path, '-vf', 'fps=4',  # 4 fps = 0.25 second intervals
            '-q:v', '2',  # High quality
            '-y', frame_pattern
        ]
        
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"ffmpeg failed: {result.stderr}")
        
        # Collect extracted frames
        frame_files = []
        for filename in sorted(os.listdir(temp_dir)):
            if filename.endswith('.jpg'):
                frame_path = os.path.join(temp_dir, filename)
                frame_number = int(filename.split('_')[-1].split('.')[0])
                timestamp = (frame_number - 1) * 0.25  # Convert frame number to timestamp
                
                frame_files.append({
                    'path': frame_path,
                    'phase': f'frame_{frame_number-1:03d}',
                    'timestamp': timestamp,
                    'description': f'Frame at {timestamp:.2f}s'
                })
        
        print(f"Extracted {len(frame_files)} frames using ffmpeg")
        return frame_files
        
    except Exception as e:
        print(f"Error extracting frames: {str(e)}")
        raise

def upload_frames_to_s3(frame_files, bucket_name, analysis_id, user_id):
    """Upload extracted frames to S3"""
    try:
        frame_data = []
        
        for i, frame_info in enumerate(frame_files):
            # Upload to S3
            s3_key = f"golf-swings/{user_id}/{analysis_id}/frames/{analysis_id}/{frame_info['phase']}_Frame_at_{frame_info['timestamp']:.2f}s.jpg"
            
            s3_client.upload_file(frame_info['path'], bucket_name, s3_key)
            
            # Create frame URL
            frame_url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
            
            frame_data.append({
                'phase': frame_info['phase'],
                'url': frame_url,
                'timestamp': frame_info['timestamp'],
                'description': frame_info['description'],
                'frame_number': i
            })
            
            # Clean up local file
            os.remove(frame_info['path'])
        
        return {
            'frames': frame_data,
            'frames_extracted': len(frame_data),
            'video_duration': max([f['timestamp'] for f in frame_data]) + 0.25 if frame_data else 0,
            'fps': 4  # 4 fps = 0.25 second intervals
        }
        
    except Exception as e:
        print(f"Error uploading frames: {str(e)}")
        raise

def update_progress(analysis_id, user_id, status, message, analysis_results=None):
    """Update analysis progress in DynamoDB"""
    try:
        update_expression = "SET #status = :status, progress_message = :message, updated_at = :timestamp"
        expression_values = {
            ':status': status,
            ':message': message,
            ':timestamp': datetime.now().isoformat()
        }
        expression_names = {'#status': 'status'}
        
        if analysis_results:
            update_expression += ", analysis_results = :results"
            expression_values[':results'] = analysis_results
        
        analyses_table.update_item(
            Key={'analysis_id': analysis_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values
        )
        
        print(f"Progress: {status} - {message}")
        
    except Exception as e:
        print(f"DynamoDB update error: {e}")

def trigger_ai_analysis(analysis_id, user_id):
    """Trigger AI analysis processor after frame extraction completes"""
    try:
        print(f"Triggering AI analysis for: {analysis_id}")
        
        payload = {
            'analysis_id': analysis_id,
            'user_id': user_id,
            'status': 'COMPLETED'
        }
        
        response = lambda_client.invoke(
            FunctionName=os.environ.get('AI_ANALYSIS_PROCESSOR_FUNCTION_NAME', 'golf-ai-analysis-processor'),
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(payload)
        )
        
        print(f"Successfully triggered AI analysis for: {analysis_id}")
        
    except Exception as e:
        print(f"Error triggering AI analysis for {analysis_id}: {str(e)}")