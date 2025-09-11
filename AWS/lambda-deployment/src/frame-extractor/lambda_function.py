import json
import boto3
import tempfile
import os
import subprocess
import uuid
from datetime import datetime

# Initialize AWS clients
s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')
dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
    temp_video_path = None
    temp_dir = None
    
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
        
        print(f"🏌️‍♂️ Optimized Frame Extraction: {analysis_id}")
        print(f"Processing: {bucket_name}/{video_key}")
        
        # Get DynamoDB table
        table_name = os.environ.get('DYNAMODB_TABLE', 'golf-coach-analyses')
        table = dynamodb.Table(table_name)
        
        # Update status to processing
        update_analysis_status(table, analysis_id, user_id, "PROCESSING", "Frame extraction starting...")
        
        # Download video from S3
        temp_video_path = download_video_from_s3(bucket_name, video_key)
        
        # Extract frames using FFmpeg (from layer)
        extracted_frames, temp_dir = extract_frames_with_layer(temp_video_path, analysis_id)
        
        # Check immediately after extraction
        if not extracted_frames or len(extracted_frames) == 0:
            raise Exception("No frames were extracted from the video")
        
        print(f"Successfully extracted {len(extracted_frames)} frames")
        
        # Update status immediately after successful extraction
        update_analysis_status(table, analysis_id, user_id, "PROCESSING", "Frames extracted successfully, uploading to S3...")
        
        # Upload frames to S3
        frame_analysis = upload_frames_to_s3(extracted_frames, bucket_name, analysis_id, user_id)
        
        # DEBUG: Check if extracted_frames is still valid after upload
        print(f"POST-UPLOAD DEBUG: extracted_frames type: {type(extracted_frames)}")
        print(f"POST-UPLOAD DEBUG: extracted_frames length: {len(extracted_frames)}")
        print(f"POST-UPLOAD DEBUG: frame_analysis: {frame_analysis}")
        
        # This is where the logic breaks - find out why
        if not extracted_frames:
            print("ERROR: extracted_frames became invalid after successful upload!")
            raise Exception("Logic error: frames uploaded but list corrupted")
        
        # Update DynamoDB with results
        update_analysis_status(
            table, analysis_id, user_id, "COMPLETED", 
            f"Frame extraction completed. Extracted {len(extracted_frames)} frames for analysis.",
            frame_analysis
        )
        
        # Trigger AI analysis processor
        trigger_ai_analysis(analysis_id, user_id)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'analysis_id': analysis_id,
                'status': 'completed',
                'message': f'Frame extraction successful! Extracted {len(extracted_frames)} frames.',
                'frames_extracted': len(extracted_frames),
                'video_duration': frame_analysis.get('video_duration', 0)
            })
        }
        
    except Exception as e:
        error_msg = f"Frame extraction error: {str(e)}"
        print(error_msg)
        
        # Update status to failed if we have the analysis_id
        if 'analysis_id' in locals() and 'table' in locals():
            try:
                update_analysis_status(table, analysis_id, user_id, "FAILED", error_msg)
            except:
                pass
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
    
    finally:
        # Cleanup temporary files
        if temp_video_path and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        if temp_dir and os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)

def extract_user_id_from_key(video_key):
    """Extract user ID from S3 key path"""
    parts = video_key.split('/')
    if len(parts) >= 2 and parts[0] == 'golf-swings':
        return parts[1]
    return 'unknown-user'

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

def download_video_from_s3(bucket_name, video_key):
    """Download video file from S3 to temporary location"""
    temp_video = tempfile.NamedTemporaryFile(delete=False, suffix='.mov')
    temp_video_path = temp_video.name
    temp_video.close()
    
    print(f"Downloading video to: {temp_video_path}")
    s3_client.download_file(bucket_name, video_key, temp_video_path)
    print(f"Downloaded {os.path.getsize(temp_video_path)} bytes")
    
    return temp_video_path

def extract_frames_with_layer(video_path, analysis_id):
    """Simple, clean frame extraction"""
    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    
    # Find FFmpeg paths
    ffmpeg_paths = ['/opt/opt/bin/ffmpeg', '/opt/bin/ffmpeg', '/opt/ffmpeg/bin/ffmpeg']
    ffmpeg_path = next((path for path in ffmpeg_paths if os.path.exists(path)), None)
    if not ffmpeg_path:
        raise Exception(f"FFmpeg not found at: {ffmpeg_paths}")
    
    # Extract frames every 0.25 seconds (4 fps)
    frame_pattern = os.path.join(temp_dir, f"{analysis_id}_frame_%03d.jpg")
    ffmpeg_cmd = [
        ffmpeg_path, '-i', video_path,
        '-vf', 'fps=4',
        '-q:v', '2',
        '-y',
        frame_pattern
    ]
    
    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise Exception(f"FFmpeg failed: {result.stderr}")
    
    # Collect frame files
    frame_files = []
    filenames = sorted([f for f in os.listdir(temp_dir) if f.endswith('.jpg')])
    
    for i, filename in enumerate(filenames):
        frame_files.append({
            'path': os.path.join(temp_dir, filename),
            'phase': f'frame_{i:03d}',
            'timestamp': i * 0.25,
            'description': f'Frame at {i * 0.25:.2f}s',
            'frame_number': i
        })
    
    return frame_files, temp_dir

def upload_frames_to_s3(frame_files, bucket_name, analysis_id, user_id):
    """Upload extracted frames to S3 and return analysis data"""
    try:
        print(f"Uploading {len(frame_files)} frames to S3...")
        
        frame_data = []
        calculated_duration = 0
        
        for frame_info in frame_files:
            # Create S3 key
            s3_key = f"golf-swings/{user_id}/{analysis_id}/frames/{analysis_id}/{frame_info['phase']}_Frame_at_{frame_info['timestamp']:.2f}s.jpg"
            
            # Upload to S3
            s3_client.upload_file(frame_info['path'], bucket_name, s3_key)
            
            # Create frame data entry
            frame_url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
            
            frame_data.append({
                'phase': frame_info['phase'],
                'url': frame_url,
                'timestamp': frame_info['timestamp'],
                'description': frame_info['description'],
                'frame_number': frame_info['frame_number']
            })
            
            # Track maximum timestamp for calculated duration
            calculated_duration = max(calculated_duration, frame_info['timestamp'])
            
            # Don't clean up individual files here - finally block handles temp directory cleanup
        
        # Add a bit to calculated duration since last frame isn't at the very end
        calculated_duration += 0.25
        
        print(f"Successfully uploaded {len(frame_data)} frames")
        
        return {
            'frames': frame_data,
            'frames_extracted': len(frame_data),
            'video_duration': calculated_duration,
            'fps': 4.0,  # 4 fps = 0.25 second intervals
            'swing_detected': True,
            'total_frames': len(frame_data)
        }
        
    except Exception as e:
        print(f"Error uploading frames: {str(e)}")
        raise

def update_analysis_status(table, analysis_id, user_id, status, message, analysis_results=None):
    """Update analysis status in DynamoDB"""
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
        
        table.update_item(
            Key={'analysis_id': analysis_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values
        )
        
        print(f"Updated analysis {analysis_id}: {status} - {message}")
        
    except Exception as e:
        print(f"Error updating DynamoDB: {str(e)}")
        # Don't raise here - we don't want to fail the whole process for a status update

def trigger_ai_analysis(analysis_id, user_id):
    """Trigger AI analysis processor after frame extraction completes"""
    try:
        print(f"Triggering AI analysis for: {analysis_id}")
        
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
        
        print(f"Successfully triggered AI analysis for: {analysis_id}")
        print(f"Lambda response: {response.get('StatusCode', 'Unknown')}")
        
    except Exception as e:
        print(f"Error triggering AI analysis for {analysis_id}: {str(e)}")
        # Don't raise - we want the frame extraction to succeed even if AI trigger fails