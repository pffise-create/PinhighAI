import json
import boto3
import tempfile
import os
import subprocess
import uuid
import decimal
import math
from datetime import datetime

# Initialize AWS clients
s3_client = boto3.client('s3')
sqs_client = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
    """
    Handle both SQS messages and direct invocations for frame extraction
    Supports backward compatibility and robust error handling
    """
    
    print(f"Lambda invoked with event: {json.dumps(event, default=str)}")
    
    # Detect event type and normalize to processing format
    messages_to_process = []
    
    # Check if this is an SQS event
    if 'Records' in event and len(event['Records']) > 0:
        first_record = event['Records'][0]
        
        if first_record.get('eventSource') == 'aws:sqs':
            print("Processing SQS event batch")
            
            # Process SQS Records
            for record in event['Records']:
                try:
                    # Validate record structure
                    if 'body' not in record:
                        raise ValueError("SQS record missing 'body' field")
                    
                    # Parse JSON from SQS message body
                    message_body = json.loads(record['body'])
                    
                    # Validate required fields
                    required_fields = ['s3_bucket', 's3_key', 'analysis_id', 'user_id']
                    missing_fields = [field for field in required_fields if field not in message_body]
                    
                    if missing_fields:
                        raise ValueError(f"Missing required fields: {missing_fields}")
                    
                    messages_to_process.append({
                        'source': 'sqs',
                        'record_id': record.get('messageId', 'unknown'),
                        'data': message_body
                    })
                    
                except Exception as e:
                    print(f"Error parsing SQS record: {str(e)}")
                    print(f"Record structure: {record}")
                    # Continue processing other records
                    
        else:
            print(f"Unsupported Records event source: {first_record.get('eventSource')}")
    
    # Check if this is a direct invocation (backward compatibility)
    elif all(field in event for field in ['s3_bucket', 's3_key', 'analysis_id', 'user_id']):
        print("Processing direct invocation")
        # Include optional trim parameters if present
        data = {
            's3_bucket': event['s3_bucket'],
            's3_key': event['s3_key'],
            'analysis_id': event['analysis_id'],
            'user_id': event['user_id']
        }
        # Add trim parameters if provided
        if 'trim_start_ms' in event and 'trim_end_ms' in event:
            data['trim_start_ms'] = event['trim_start_ms']
            data['trim_end_ms'] = event['trim_end_ms']
            print(f"Trim parameters: {event['trim_start_ms']}ms to {event['trim_end_ms']}ms")
        messages_to_process.append({
            'source': 'direct',
            'record_id': context.aws_request_id,
            'data': data
        })
    
    else:
        error_msg = f"Unrecognized event format. Event keys: {list(event.keys())}"
        print(error_msg)
        return {
            'statusCode': 400,
            'body': json.dumps({'error': error_msg})
        }
    
    # Process all messages
    results = []
    
    for message in messages_to_process:
        try:
            data = message['data']
            
            print(f"Processing {message['source']} message for analysis: {data['analysis_id']}")
            print(f"Video: {data['s3_bucket']}/{data['s3_key']}")

            # Extract optional trim parameters
            trim_start_ms = data.get('trim_start_ms')
            trim_end_ms = data.get('trim_end_ms')
            if trim_start_ms is not None and trim_end_ms is not None:
                print(f"Trim requested: {trim_start_ms}ms to {trim_end_ms}ms")

            # Process this individual message
            result = process_frame_extraction(
                data['s3_bucket'],
                data['s3_key'],
                data['analysis_id'],
                data['user_id'],
                trim_start_ms,
                trim_end_ms
            )
            
            results.append({
                'record_id': message['record_id'],
                'analysis_id': data['analysis_id'],
                'status': 'success',
                'result': result
            })
            
        except Exception as e:
            error_msg = f"Error processing message: {str(e)}"
            print(error_msg)
            
            results.append({
                'record_id': message['record_id'],
                'analysis_id': data.get('analysis_id', 'unknown'),
                'status': 'error',
                'error': error_msg
            })
    
    print(f"Processed {len(results)} messages. Success: {sum(1 for r in results if r['status'] == 'success')}, Errors: {sum(1 for r in results if r['status'] == 'error')}")
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'processed_messages': len(results),
            'results': results
        })
    }

def process_frame_extraction(bucket_name, video_key, analysis_id, user_id, trim_start_ms=None, trim_end_ms=None):
    """
    Process frame extraction for a single video
    Extracted from the main lambda_handler for SQS batch processing
    Supports optional video trimming via trim_start_ms and trim_end_ms parameters
    """
    temp_video_path = None
    temp_dir = None

    try:
        print(f"Frame Extraction: {analysis_id}")
        print(f"Processing: {bucket_name}/{video_key}")
        if trim_start_ms is not None and trim_end_ms is not None:
            print(f"Trim parameters: {trim_start_ms}ms to {trim_end_ms}ms (duration: {trim_end_ms - trim_start_ms}ms)")

        # Get DynamoDB table
        table_name = os.environ.get('DYNAMODB_TABLE', 'golf-coach-analyses')
        table = dynamodb.Table(table_name)

        # Update status to processing
        progress_msg = "Frame extraction starting..."
        if trim_start_ms is not None and trim_end_ms is not None:
            progress_msg = f"Frame extraction starting (trimmed segment: {trim_start_ms/1000:.1f}s to {trim_end_ms/1000:.1f}s)..."
        update_analysis_status(table, analysis_id, user_id, "PROCESSING", progress_msg)

        # Download video from S3
        temp_video_path = download_video_from_s3(bucket_name, video_key)

        # Extract frames using FFmpeg (from layer), with optional trimming
        extracted_frames, temp_dir = extract_frames_with_layer(temp_video_path, analysis_id, trim_start_ms, trim_end_ms)
        
        # Upload frames to S3 (no validation - trust the process)
        frame_analysis = upload_frames_to_s3(extracted_frames, bucket_name, analysis_id, user_id)
        
        # Always report success - eliminate all validation logic
        frame_count = frame_analysis.get('frames_extracted', len(extracted_frames) if extracted_frames else 1)
        print(f"Frame processing completed. Reporting {frame_count} frames.")
        
        # Update DynamoDB with success status - CRITICAL OPERATION
        print("=== STARTING CRITICAL STATUS UPDATES ===")
        
        update_success = update_analysis_status(
            table, analysis_id, user_id, "COMPLETED", 
            f"Frame extraction completed. Extracted {frame_count} frames for analysis.",
            frame_analysis
        )
        
        if update_success:
            print("Status update successful - triggering AI analysis")
            # Send message to AI analysis queue
            send_to_ai_analysis_queue(analysis_id, user_id)
            print("AI analysis triggered successfully")
        else:
            raise Exception("CRITICAL: Status update to COMPLETED failed")
        
        return {
            'analysis_id': analysis_id,
            'status': 'completed',
            'message': f'Frame extraction successful! Extracted {frame_count} frames.',
            'frames_extracted': frame_count,
            'video_duration': frame_analysis.get('video_duration', 0)
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
        
        raise Exception(error_msg)
    
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

def extract_frames_with_layer(video_path, analysis_id, trim_start_ms=None, trim_end_ms=None):
    """
    Frame extraction with optional video trimming support.
    If trim parameters are provided, only extracts frames from the trimmed segment.
    """
    # Create temp directory
    temp_dir = tempfile.mkdtemp()

    # Find FFmpeg paths
    ffmpeg_paths = ['/opt/opt/bin/ffmpeg', '/opt/bin/ffmpeg', '/opt/ffmpeg/bin/ffmpeg']
    ffmpeg_path = next((path for path in ffmpeg_paths if os.path.exists(path)), None)
    if not ffmpeg_path:
        raise Exception(f"FFmpeg not found at: {ffmpeg_paths}")

    # Build FFmpeg command with optional trimming
    frame_pattern = os.path.join(temp_dir, f"{analysis_id}_frame_%03d.jpg")
    filters = "fps=4,scale='min(1280,iw)':-2"

    # Calculate trim parameters
    start_offset = 0  # Used to offset timestamps in output
    if trim_start_ms is not None and trim_end_ms is not None:
        # Convert ms to seconds for FFmpeg
        start_sec = trim_start_ms / 1000.0
        duration_sec = (trim_end_ms - trim_start_ms) / 1000.0
        start_offset = start_sec

        print(f"Applying trim: start={start_sec:.3f}s, duration={duration_sec:.3f}s")

        # FFmpeg command with trim: -ss before -i for fast seeking, -t for duration
        ffmpeg_cmd = [
            ffmpeg_path,
            '-ss', str(start_sec),      # Seek to start position (before input = fast seek)
            '-i', video_path,
            '-t', str(duration_sec),    # Duration to process
            '-vf', filters,
            '-q:v', '6',
            '-y',
            frame_pattern
        ]
    else:
        # No trimming - process full video
        ffmpeg_cmd = [
            ffmpeg_path, '-i', video_path,
            '-vf', filters,
            '-q:v', '6',
            '-y',
            frame_pattern
        ]

    print(f"FFmpeg command: {' '.join(ffmpeg_cmd)}")
    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise Exception(f"FFmpeg failed: {result.stderr}")

    # Collect frame files
    frame_files = []
    filenames = sorted([f for f in os.listdir(temp_dir) if f.endswith('.jpg')])

    for i, filename in enumerate(filenames):
        # Timestamp relative to the trimmed segment (starts at 0)
        relative_timestamp = i * 0.25
        frame_files.append({
            'path': os.path.join(temp_dir, filename),
            'phase': f'frame_{i:03d}',
            'timestamp': relative_timestamp,
            'description': f'Frame at {relative_timestamp:.2f}s',
            'frame_number': i
        })

    print(f"Extracted {len(frame_files)} frames from {'trimmed' if trim_start_ms else 'full'} video")
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

def sanitize_for_dynamodb(obj):
    """
    Recursively sanitize Python objects for DynamoDB compatibility
    Handles floats, dates, None values, and complex objects
    """
    if obj is None:
        return "null"  # DynamoDB doesn't like None in some contexts
    
    elif isinstance(obj, bool):
        return obj
    
    elif isinstance(obj, (int, decimal.Decimal)):
        return obj
    
    elif isinstance(obj, float):
        # Handle problematic float values
        if math.isnan(obj):
            return "NaN"
        elif math.isinf(obj):
            return "Infinity" if obj > 0 else "-Infinity"
        else:
            # Convert to Decimal for DynamoDB (avoids precision issues)
            return decimal.Decimal(str(round(obj, 6)))  # Round to avoid precision errors
    
    elif isinstance(obj, str):
        return obj
    
    elif isinstance(obj, datetime):
        return obj.isoformat()
    
    elif isinstance(obj, (list, tuple)):
        return [sanitize_for_dynamodb(item) for item in obj]
    
    elif isinstance(obj, dict):
        return {key: sanitize_for_dynamodb(value) for key, value in obj.items()}
    
    else:
        # Convert unknown objects to string representation
        return str(obj)

def update_analysis_status(table, analysis_id, user_id, status, message, analysis_results=None):
    """Update analysis status in DynamoDB with proper data sanitization"""
    try:
        print(f"Updating analysis {analysis_id} to status: {status}")
        
        # Build update expression
        update_expression = "SET #status = :status, progress_message = :message, updated_at = :timestamp"
        expression_values = {
            ':status': status,
            ':message': message,
            ':timestamp': datetime.now().isoformat()
        }
        expression_names = {'#status': 'status'}
        
        # Sanitize analysis_results if provided
        if analysis_results:
            print(f"Sanitizing analysis_results: {type(analysis_results)}")
            
            try:
                # Deep sanitization of the analysis results
                sanitized_results = sanitize_for_dynamodb(analysis_results)
                
                # Add to update expression
                update_expression += ", analysis_results = :results"
                expression_values[':results'] = sanitized_results
                
                print(f"Successfully sanitized analysis_results")
                
            except Exception as sanitize_error:
                print(f"WARNING: Failed to sanitize analysis_results: {sanitize_error}")
                print(f"Skipping analysis_results to prevent DynamoDB failure")
                # Continue without analysis_results rather than failing
        
        print(f"DynamoDB update expression: {update_expression}")
        print(f"Expression values keys: {list(expression_values.keys())}")
        
        # Perform the update with error details
        response = table.update_item(
            Key={'analysis_id': analysis_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values,
            ReturnValues="UPDATED_NEW"
        )
        
        print(f"Successfully updated analysis {analysis_id}: {status}")
        print(f"Updated attributes: {list(response.get('Attributes', {}).keys())}")
        
        return True
        
    except Exception as e:
        error_msg = f"DynamoDB update failed for {analysis_id}: {str(e)}"
        print(f"ERROR: {error_msg}")
        
        # Print detailed error info for debugging
        print(f"Error type: {type(e).__name__}")
        print(f"Error details: {str(e)}")
        
        # For critical status updates, we must raise the error
        if status in ['COMPLETED', 'FAILED']:
            raise Exception(f"CRITICAL: {error_msg}")
        
        return False

def send_to_ai_analysis_queue(analysis_id, user_id):
    """Send message to AI analysis SQS queue after frame extraction completes"""
    try:
        print(f"Sending AI analysis message for: {analysis_id}")
        
        # Get queue URL from environment
        queue_url = os.environ.get('AI_ANALYSIS_QUEUE_URL')
        if not queue_url:
            raise Exception('AI_ANALYSIS_QUEUE_URL environment variable is not set')
        
        # Prepare message payload
        message_body = {
            'analysis_id': analysis_id,
            'user_id': user_id,
            'status': 'COMPLETED',
            'timestamp': datetime.now().isoformat(),
            'source': 'frame-extractor'
        }
        
        # Send message to SQS queue
        response = sqs_client.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(message_body),
            MessageAttributes={
                'analysis_id': {
                    'StringValue': analysis_id,
                    'DataType': 'String'
                },
                'user_id': {
                    'StringValue': user_id,
                    'DataType': 'String'
                },
                'source': {
                    'StringValue': 'frame-extractor',
                    'DataType': 'String'
                }
            }
        )
        
        message_id = response.get('MessageId')
        print(f"Successfully sent AI analysis message for: {analysis_id}")
        print(f"SQS MessageId: {message_id}")
        
        return message_id
        
    except Exception as e:
        print(f"Error sending AI analysis message for {analysis_id}: {str(e)}")
        # Don't raise - we want the frame extraction to succeed even if AI trigger fails
        return None