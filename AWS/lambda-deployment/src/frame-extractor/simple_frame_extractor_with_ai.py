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
analyses_table = dynamodb.Table('golf-coach-analyses')

def lambda_handler(event, context):
    temp_video_path = None
    temp_frames = []
    
    try:
        # Handle S3 event
        bucket_name = event['Records'][0]['s3']['bucket']['name']
        video_key = event['Records'][0]['s3']['object']['key']
        
        print(f"🏌️ Processing video: {bucket_name}/{video_key}")
        
        # Extract analysis metadata
        user_id = extract_user_id_from_key(video_key)
        analysis_id = extract_analysis_id_from_key(video_key) or str(uuid.uuid4())
        
        update_progress(analysis_id, user_id, "PROCESSING", "Starting frame extraction...")
        
        # Download video from S3
        temp_video_path = download_video_from_s3(bucket_name, video_key)
        
        # Extract frames every 0.25 seconds (4 fps)
        extracted_frames = extract_frames_every_quarter_second(temp_video_path)
        
        if not extracted_frames:
            raise Exception("No frames could be extracted from video")
        
        print(f"✅ Extracted {len(extracted_frames)} frames")
        
        # Upload frames to S3
        uploaded_frames = upload_frames_to_s3(extracted_frames, bucket_name, analysis_id)
        
        # Create analysis results
        analysis_results = {
            'frames': uploaded_frames,
            'frames_count': len(uploaded_frames),
            'extraction_method': 'simple_quarter_second',
            'processed_at': datetime.utcnow().isoformat()
        }
        
        # Update progress to COMPLETED
        update_progress(analysis_id, user_id, "COMPLETED", 
                       f"Frame extraction complete! {len(uploaded_frames)} frames extracted.", 
                       analysis_results)
        
        # Trigger AI analysis
        ai_trigger_result = trigger_ai_analysis(analysis_id, user_id)
        print(f"AI trigger result: {ai_trigger_result}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'analysis_id': analysis_id,
                'status': 'completed',
                'message': f'Frame extraction successful! {len(uploaded_frames)} frames extracted.',
                'frames_count': len(uploaded_frames),
                'ai_trigger': ai_trigger_result
            })
        }
        
    except Exception as e:
        error_msg = f"Frame extraction failed: {str(e)}"
        print(f"❌ {error_msg}")
        
        if 'analysis_id' in locals() and 'user_id' in locals():
            update_progress(analysis_id, user_id, "FAILED", error_msg)
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': error_msg})
        }
    
    finally:
        # Cleanup
        if temp_video_path and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        for frame_path in temp_frames:
            if os.path.exists(frame_path):
                os.remove(frame_path)

def extract_user_id_from_key(video_key):
    """Extract user ID from S3 key path: golf-swings/user-id/video.mp4"""
    parts = video_key.split('/')
    if len(parts) >= 2 and parts[0] == 'golf-swings':
        return parts[1]
    return 'unknown-user'

def extract_analysis_id_from_key(video_key):
    """Extract analysis ID from filename"""
    parts = video_key.split('/')
    if len(parts) >= 3:
        filename = parts[2]
        # Remove common video extensions
        for ext in ['.mov', '.mp4', '.avi', '.m4v']:
            filename = filename.replace(ext, '')
        return filename
    return None

def download_video_from_s3(bucket_name, video_key):
    """Download video from S3 to temporary file"""
    try:
        temp_fd, temp_path = tempfile.mkstemp(suffix='.mp4')
        os.close(temp_fd)
        
        print(f"Downloading {video_key}...")
        s3_client.download_file(bucket_name, video_key, temp_path)
        
        file_size = os.path.getsize(temp_path)
        print(f"Downloaded: {file_size / (1024*1024):.2f} MB")
        
        return temp_path
        
    except Exception as e:
        print(f"Download error: {e}")
        raise e

def extract_frames_every_quarter_second(video_path):
    """Extract frames every 0.25 seconds using FFmpeg"""
    try:
        # Create temp directory for frames
        temp_dir = tempfile.mkdtemp()
        frame_pattern = os.path.join(temp_dir, 'frame_%03d.jpg')
        
        # FFmpeg command to extract frames at 4 fps (every 0.25 seconds)
        ffmpeg_cmd = [
            '/opt/opt/bin/ffmpeg',  # FFmpeg from layer (corrected path)
            '-i', video_path,
            '-vf', 'fps=4',  # 4 frames per second = every 0.25s
            '-q:v', '2',  # High quality
            '-y',  # Overwrite output files
            frame_pattern
        ]
        
        print(f"Running FFmpeg: {' '.join(ffmpeg_cmd)}")
        
        result = subprocess.run(ffmpeg_cmd, 
                              capture_output=True, 
                              text=True, 
                              timeout=300)  # 5 minute timeout
        
        if result.returncode != 0:
            print(f"FFmpeg stderr: {result.stderr}")
            print(f"FFmpeg stdout: {result.stdout}")
            raise Exception(f"FFmpeg failed with code {result.returncode}")
        
        # Collect extracted frames
        extracted_frames = []
        frame_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.jpg')])
        
        for i, frame_file in enumerate(frame_files):
            frame_path = os.path.join(temp_dir, frame_file)
            extracted_frames.append({
                'frame_number': i,
                'timestamp': i * 0.25,  # Every 0.25 seconds
                'frame_path': frame_path
            })
        
        print(f"✅ FFmpeg extracted {len(extracted_frames)} frames")
        return extracted_frames
        
    except Exception as e:
        print(f"Frame extraction error: {e}")
        raise e

def upload_frames_to_s3(extracted_frames, bucket_name, analysis_id):
    """Upload extracted frames to S3"""
    uploaded_frames = []
    
    try:
        for frame_data in extracted_frames:
            # Read frame file
            with open(frame_data['frame_path'], 'rb') as f:
                frame_bytes = f.read()
            
            # S3 key for frame
            frame_key = f"analyses/{analysis_id}/frame_{frame_data['frame_number']:03d}.jpg"
            
            # Upload to S3
            s3_client.put_object(
                Bucket=bucket_name,
                Key=frame_key,
                Body=frame_bytes,
                ContentType='image/jpeg'
            )
            
            # Generate presigned URL (24 hour expiry)
            frame_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket_name, 'Key': frame_key},
                ExpiresIn=86400
            )
            
            uploaded_frames.append({
                'frame_number': frame_data['frame_number'],
                'timestamp': frame_data['timestamp'],
                'url': frame_url,
                's3_key': frame_key
            })
            
            # Cleanup temp file
            os.remove(frame_data['frame_path'])
        
        return uploaded_frames
        
    except Exception as e:
        print(f"Frame upload error: {e}")
        raise e

def trigger_ai_analysis(analysis_id, user_id):
    """Trigger AI analysis processor after frame extraction"""
    try:
        print(f"🚀 Triggering AI analysis for: {analysis_id}")
        
        # Get AI function name from environment
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
        
        return {
            'success': True,
            'status_code': response.get('StatusCode'),
            'ai_function': ai_function_name
        }
        
    except Exception as e:
        print(f"❌ Error triggering AI analysis for {analysis_id}: {str(e)}")
        # Don't raise - we want frame extraction to succeed even if AI trigger fails
        return {
            'success': False,
            'error': str(e)
        }

def update_progress(analysis_id, user_id, status, message, analysis_data=None):
    """Update analysis progress in DynamoDB"""
    try:
        item = {
            'analysis_id': analysis_id,
            'user_id': user_id,
            'status': status,
            'progress_message': message,
            'updated_at': datetime.utcnow().isoformat()
        }
        
        if status == "STARTED":
            item['created_at'] = datetime.utcnow().isoformat()
        
        if analysis_data:
            item['analysis_results'] = analysis_data
        
        analyses_table.put_item(Item=item)
        print(f"Progress: {status} - {message}")
        
    except Exception as e:
        print(f"DynamoDB update error: {e}")