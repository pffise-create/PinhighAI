import json
import boto3
import tempfile
import os
import subprocess
import uuid
from datetime import datetime

def lambda_handler(event, context):
    """Debug mode for checking FFmpeg layer paths"""
    try:
        # Check if this is debug mode
        if event.get('debug_mode'):
            print("🔍 DEBUG MODE: Checking layer paths")
            
            # Check various possible paths for FFmpeg
            possible_paths = [
                '/opt/bin/ffmpeg',
                '/opt/ffmpeg/bin/ffmpeg',
                '/opt/ffmpeg',
                '/usr/bin/ffmpeg',
                '/usr/local/bin/ffmpeg',
                'ffmpeg'  # system PATH
            ]
            
            debug_info = {
                "layer_paths_checked": [],
                "environment_vars": dict(os.environ),
                "opt_directory_contents": [],
                "path_variable": os.environ.get('PATH', 'Not set')
            }
            
            # Check each possible path
            for path in possible_paths:
                exists = os.path.exists(path)
                debug_info["layer_paths_checked"].append({
                    "path": path,
                    "exists": exists,
                    "executable": os.access(path, os.X_OK) if exists else False
                })
                print(f"Path {path}: {'EXISTS' if exists else 'NOT FOUND'}")
            
            # List contents of /opt directory
            try:
                if os.path.exists('/opt'):
                    for root, dirs, files in os.walk('/opt'):
                        for item in dirs + files:
                            item_path = os.path.join(root, item)
                            debug_info["opt_directory_contents"].append({
                                "path": item_path,
                                "type": "dir" if os.path.isdir(item_path) else "file",
                                "executable": os.access(item_path, os.X_OK) if os.path.exists(item_path) else False
                            })
                        # Limit to prevent too much output
                        if len(debug_info["opt_directory_contents"]) > 50:
                            break
            except Exception as e:
                debug_info["opt_scan_error"] = str(e)
            
            # Try to find ffmpeg using 'which'
            try:
                which_result = subprocess.run(['which', 'ffmpeg'], capture_output=True, text=True, timeout=10)
                debug_info["which_ffmpeg"] = {
                    "found": which_result.returncode == 0,
                    "path": which_result.stdout.strip() if which_result.returncode == 0 else None,
                    "error": which_result.stderr.strip() if which_result.stderr else None
                }
            except Exception as e:
                debug_info["which_error"] = str(e)
            
            return {
                'statusCode': 200,
                'body': json.dumps(debug_info, indent=2)
            }
        
        # Normal processing would go here
        return {
            'statusCode': 400,
            'body': json.dumps({"error": "Not in debug mode. Add 'debug_mode': true to test layer paths."})
        }
        
    except Exception as e:
        print(f"Error in debug: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({"error": str(e)})
        }