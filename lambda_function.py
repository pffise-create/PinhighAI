import json
import boto3
import tempfile
import os
import subprocess
import math
from datetime import datetime
from PIL import Image, ImageChops
from io import BytesIO

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
analyses_table = dynamodb.Table('golf-coach-analyses')

def lambda_handler(event, context):
    temp_video_path = None
    temp_files = []
    
    try:
        bucket_name = event['Records'][0]['s3']['bucket']['name']
        video_key = event['Records'][0]['s3']['object']['key']
        
        print(f"🏌️ Smart Golf Analysis: {bucket_name}/{video_key}")
        
        user_id = extract_user_id_from_key(video_key)
        analysis_id = extract_analysis_id_from_key(video_key) or str(uuid.uuid4())
        
        update_progress(analysis_id, user_id, "PROCESSING", "Smart motion detection starting...")
        
        # Download video
        temp_video_path = download_video_from_s3(bucket_name, video_key)
        
        # Smart golf swing detection
        swing_data = detect_golf_swing_smart(temp_video_path)
        
        if not swing_data:
            raise Exception("No golf swing detected in video")
        
        update_progress(analysis_id, user_id, "UPLOADING", "Uploading swing frames...")
        
        # Extract P1-P10 frames from detected swing
        extracted_frames = extract_p1_p10_frames(temp_video_path, swing_data)
        
        # Upload frames to S3
        swing_analysis = upload_frames_and_create_analysis(
            extracted_frames, bucket_name, analysis_id, swing_data
        )
        
        update_progress(analysis_id, user_id, "COMPLETED", 
                       f"Smart swing detection complete! Swing: {swing_data['swing_start']:.1f}s-{swing_data['swing_end']:.1f}s", 
                       swing_analysis)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'analysis_id': analysis_id,
                'status': 'completed',
                'message': 'Smart golf swing detection successful!',
                'swing_detected': f"{swing_data['swing_start']:.1f}s to {swing_data['swing_end']:.1f}s",
                'confidence': swing_data['confidence']
            })
        }
        
    except Exception as e:
        print(f"Smart detection error: {str(e)}")
        if 'analysis_id' in locals() and 'user_id' in locals():
            update_progress(analysis_id, user_id, "FAILED", f"Smart detection failed: {str(e)}")
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
    try:
        temp_fd, temp_path = tempfile.mkstemp(suffix='.mov')
        os.close(temp_fd)
        
        print(f"Downloading {video_key}")
        s3_client.download_file(bucket_name, video_key, temp_path)
        
        file_size = os.path.getsize(temp_path)
        print(f"Downloaded: {file_size / (1024*1024):.2f} MB")
        
        return temp_path
        
    except Exception as e:
        print(f"Download error: {e}")
        raise e

def detect_golf_swing_smart(video_path):
    """Smart golf swing detection that handles waggles and false motions"""
    
    print("🔍 Analyzing motion patterns...")
    
    # Step 1: Get video metadata
    video_info = get_video_info(video_path)
    duration = video_info['duration']
    
    # Step 2: Extract motion timeline
    motion_timeline = extract_motion_timeline(video_path, video_info)
    
    if not motion_timeline:
        print("⚠️ No motion detected, using fallback")
        return create_fallback_swing_data(duration)
    
    # Step 3: Find all motion events
    motion_events = find_motion_events(motion_timeline)
    print(f"Found {len(motion_events)} motion events")
    
    # Step 4: Score each event for golf swing probability
    swing_candidates = []
    for i, event in enumerate(motion_events):
        score = score_golf_swing_probability(event, motion_timeline)
        print(f"Event {i+1}: {event['start']:.1f}s-{event['end']:.1f}s, score: {score:.2f}")
        
        if score > 0.3:  # Minimum threshold for consideration
            swing_candidates.append({
                'event': event,
                'score': score,
                'start': event['start'],
                'end': event['end'],
                'confidence': score
            })
    
    # Step 5: Select best swing candidate
    if swing_candidates:
        best_swing = max(swing_candidates, key=lambda x: x['score'])
        
        print(f"✅ Best swing: {best_swing['start']:.1f}s-{best_swing['end']:.1f}s (confidence: {best_swing['confidence']:.2f})")
        
        return {
            'swing_start': best_swing['start'],
            'swing_end': best_swing['end'],
            'confidence': best_swing['confidence'],
            'duration': best_swing['end'] - best_swing['start'],
            'method': 'smart_detection'
        }
    else:
        print("⚠️ No clear swing detected, using longest motion event")
        longest_event = max(motion_events, key=lambda x: x['duration']) if motion_events else None
        
        if longest_event:
            return {
                'swing_start': longest_event['start'],
                'swing_end': longest_event['end'],
                'confidence': 0.5,
                'duration': longest_event['duration'],
                'method': 'fallback_longest'
            }
        else:
            return create_fallback_swing_data(duration)

def get_video_info(video_path):
    """Get video metadata using FFprobe"""
    try:
        # Get duration
        duration_cmd = ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', video_path]
        duration = float(subprocess.check_output(duration_cmd).decode().strip())
        
        # Get frame rate
        fps_cmd = ['ffprobe', '-v', 'quiet', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video_path]
        fps_str = subprocess.check_output(fps_cmd).decode().strip()
        if '/' in fps_str:
            num, den = fps_str.split('/')
            fps = float(num) / float(den)
        else:
            fps = float(fps_str)
        
        return {
            'duration': duration,
            'fps': fps,
            'total_frames': int(duration * fps)
        }
    except Exception as e:
        print(f"Error getting video info: {e}")
        return {'duration': 30.0, 'fps': 30.0, 'total_frames': 900}

def extract_motion_timeline(video_path, video_info):
    """Extract motion data over time using frame differences"""
    
    duration = video_info['duration']
    sample_interval = 0.1  # Sample every 0.1 seconds for higher precision
    samples = int(duration / sample_interval)
    
    motion_timeline = []
    prev_frame_path = None
    
    print(f"Extracting {samples} motion samples...")
    
    for i in range(samples):
        timestamp = i * sample_interval
        
        # Extract frame at this timestamp
        frame_path = f'/tmp/motion_frame_{i:04d}.jpg'
        
        cmd = [
            'ffmpeg', '-ss', str(timestamp), '-i', video_path,
            '-vframes', '1', '-q:v', '10', '-s', '320x240',  # Small frames for speed
            frame_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if os.path.exists(frame_path):
            motion_score = 0
            
            if prev_frame_path and os.path.exists(prev_frame_path):
                motion_score = calculate_frame_difference(prev_frame_path, frame_path)
            
            motion_timeline.append({
                'timestamp': timestamp,
                'motion_score': motion_score,
                'frame_path': frame_path
            })
            
            # Cleanup previous frame
            if prev_frame_path and os.path.exists(prev_frame_path):
                os.remove(prev_frame_path)
            
            prev_frame_path = frame_path
        
        if i % 10 == 0:
            print(f"Motion analysis: {i}/{samples}")
    
    # Cleanup last frame
    if prev_frame_path and os.path.exists(prev_frame_path):
        os.remove(prev_frame_path)
    
    return motion_timeline

def calculate_frame_difference(frame1_path, frame2_path):
    """Calculate motion between two frames"""
    try:
        img1 = Image.open(frame1_path).convert('L')  # Grayscale
        img2 = Image.open(frame2_path).convert('L')
        
        # Calculate absolute difference
        diff = ImageChops.difference(img1, img2)
        
        # Sum all pixel differences and normalize
        histogram = diff.histogram()
        motion_score = sum(i * count for i, count in enumerate(histogram))
        
        # Normalize by image size
        total_pixels = img1.size[0] * img1.size[1]
        normalized_score = motion_score / (total_pixels * 255)
        
        return normalized_score
        
    except Exception as e:
        print(f"Frame difference error: {e}")
        return 0

def find_motion_events(motion_timeline):
    """Find distinct motion events in the timeline"""
    
    if not motion_timeline:
        return []
    
    # Calculate motion threshold
    motion_scores = [point['motion_score'] for point in motion_timeline]
    avg_motion = sum(motion_scores) / len(motion_scores)
    motion_threshold = avg_motion + (max(motion_scores) - avg_motion) * 0.3
    
    print(f"Motion threshold: {motion_threshold:.4f} (avg: {avg_motion:.4f})")
    
    events = []
    in_motion = False
    start_idx = None
    
    for i, point in enumerate(motion_timeline):
        score = point['motion_score']
        
        if score > motion_threshold and not in_motion:
            # Motion event starts
            in_motion = True
            start_idx = i
            
        elif score < motion_threshold * 0.4 and in_motion:
            # Motion event ends
            in_motion = False
            
            if start_idx is not None:
                start_time = motion_timeline[start_idx]['timestamp']
                end_time = point['timestamp']
                duration = end_time - start_time
                
                # Calculate event statistics
                event_scores = [motion_timeline[j]['motion_score'] for j in range(start_idx, i)]
                peak_motion = max(event_scores)
                avg_motion_in_event = sum(event_scores) / len(event_scores)
                
                events.append({
                    'start': start_time,
                    'end': end_time,
                    'duration': duration,
                    'peak_motion': peak_motion,
                    'avg_motion': avg_motion_in_event,
                    'motion_scores': event_scores
                })
    
    return events

def score_golf_swing_probability(motion_event, motion_timeline):
    """Score how likely this motion event is a golf swing vs waggle"""
    
    score = 0.0
    
    # 1. Duration scoring (golf swings are 2-4 seconds)
    duration = motion_event['duration']
    if duration < 1.0:
        duration_score = 0.0  # Too short
    elif duration < 2.0:
        duration_score = duration / 2.0  # Ramping up
    elif duration <= 4.0:
        duration_score = 1.0  # Perfect range
    elif duration <= 6.0:
        duration_score = (6.0 - duration) / 2.0  # Too long
    else:
        duration_score = 0.0  # Way too long
    
    score += duration_score * 0.3
    
    # 2. Intensity scoring (golf swings have high peak motion)
    peak_motion = motion_event['peak_motion']
    all_peaks = [e['peak_motion'] for e in [motion_event]]  # Would compare to other events
    if peak_motion > 0.1:  # Significant motion
        intensity_score = min(peak_motion / 0.2, 1.0)  # Scale to 0-1
    else:
        intensity_score = 0.0
    
    score += intensity_score * 0.3
    
    # 3. Motion progression (golf swings build momentum)
    motion_scores = motion_event['motion_scores']
    if len(motion_scores) >= 6:
        first_third = motion_scores[:len(motion_scores)//3]
        last_third = motion_scores[-len(motion_scores)//3:]
        
        if max(first_third) > 0:
            progression_ratio = max(last_third) / max(first_third)
            progression_score = min(progression_ratio / 2.0, 1.0)
        else:
            progression_score = 0.5
    else:
        progression_score = 0.3  # Penalize very short events
    
    score += progression_score * 0.2
    
    # 4. Sustained motion (golf swings maintain high motion)
    high_motion_threshold = motion_event['peak_motion'] * 0.6
    sustained_frames = sum(1 for s in motion_scores if s > high_motion_threshold)
    sustained_ratio = sustained_frames / len(motion_scores)
    sustained_score = min(sustained_ratio * 2.0, 1.0)
    
    score += sustained_score * 0.2
    
    print(f"  Scoring: duration={duration_score:.2f}, intensity={intensity_score:.2f}, progression={progression_score:.2f}, sustained={sustained_score:.2f}")
    
    return min(score, 1.0)

def create_fallback_swing_data(duration):
    """Create fallback swing data when no motion detected"""
    # Assume swing is in the middle third of the video
    start_time = duration * 0.35
    end_time = duration * 0.65
    
    return {
        'swing_start': start_time,
        'swing_end': end_time,
        'confidence': 0.3,
        'duration': end_time - start_time,
        'method': 'fallback_timing'
    }

def extract_p1_p10_frames(video_path, swing_data):
    """Extract P1-P10 frames from the detected swing"""
    
    swing_start = swing_data['swing_start']
    swing_duration = swing_data['duration']
    
    # P1-P10 positions within the detected swing
    swing_phases = [
        ('P1_address', 0.00),      # Start of swing
        ('P2_takeaway', 0.15),     # Early takeaway
        ('P3_backswing', 0.35),    # Backswing parallel
        ('P4_top', 0.50),          # Top of backswing
        ('P5_transition', 0.65),   # Transition
        ('P6_downswing', 0.80),    # Downswing parallel
        ('P7_impact', 0.90),       # Impact
        ('P8_followthrough', 0.97), # Follow-through
        ('P9_finish', 1.00),       # Finish
    ]
    
    extracted_frames = []
    
    for phase_name, percentage in swing_phases:
        # Calculate timestamp within the swing
        timestamp = swing_start + (swing_duration * percentage)
        
        # Extract frame
        frame_path = f'/tmp/{phase_name}_{int(timestamp*1000)}.jpg'
        
        cmd = [
            'ffmpeg', '-ss', str(timestamp), '-i', video_path,
            '-vframes', '1', '-q:v', '2', frame_path
        ]
        
        subprocess.run(cmd, capture_output=True)
        
        if os.path.exists(frame_path):
            extracted_frames.append({
                'phase': phase_name,
                'timestamp': timestamp,
                'frame_path': frame_path,
                'swing_percentage': percentage
            })
            
            print(f"Extracted {phase_name} at {timestamp:.2f}s")
    
    return extracted_frames

def upload_frames_and_create_analysis(extracted_frames, bucket_name, analysis_id, swing_data):
    """Upload frames to S3 and create analysis structure"""
    try:
        uploaded_frames = []
        
        for i, frame_data in enumerate(extracted_frames):
            # Read and optimize image
            with open(frame_data['frame_path'], 'rb') as f:
                img_data = f.read()
            
            # Resize for optimization
            image = Image.open(frame_data['frame_path'])
            image.thumbnail((800, 600), Image.Resampling.LANCZOS)
            
            img_byte_array = BytesIO()
            image.save(img_byte_array, format='JPEG', quality=85, optimize=True)
            img_bytes = img_byte_array.getvalue()
            
            # Upload to S3
            frame_key = f"analyses/{analysis_id}/frame_{i:03d}_{frame_data['phase']}.jpg"
            
            s3_client.put_object(
                Bucket=bucket_name,
                Key=frame_key,
                Body=img_bytes,
                ContentType='image/jpeg'
            )
            
            # Generate presigned URL
            frame_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket_name, 'Key': frame_key},
                ExpiresIn=86400
            )
            
            uploaded_frames.append({
                'frame_number': i,
                'timestamp': frame_data['timestamp'],
                'phase': frame_data['phase'],
                'url': frame_url,
                's3_key': frame_key,
                'swing_percentage': frame_data['swing_percentage']
            })
            
            # Cleanup temp file
            os.remove(frame_data['frame_path'])
        
        return {
            'swing_detection': swing_data,
            'frames': uploaded_frames,
            'frames_generated': len(uploaded_frames),
            'processing_method': 'smart_motion_detection',
            'extraction_timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        print(f"Frame upload error: {e}")
        raise e

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

