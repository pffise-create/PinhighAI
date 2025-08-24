# Video Optimization Guide for Cinematic SignIn

## 🎯 **Current Video Status**
- **AdobeStock_1391840411.mp4** - 28MB ✅ (Good size)
- **AdobeStock_162188287.mp4** - 45MB ⚠️ (Should compress to ~15MB)  
- **AdobeStock_385100237.mov** - 757MB ❌ (Must convert and compress)

## 📱 **Target Specifications for Mobile**
- **Format**: MP4 (H.264)
- **Resolution**: 1920x1080 (or maintain original if smaller)
- **Bitrate**: 2-4 Mbps
- **File Size**: 5-15MB each
- **Frame Rate**: 30fps
- **Audio**: Remove (muted for background use)

## 🔧 **Option 1: FFmpeg Commands (if available)**

If you have FFmpeg installed, use these commands:

### Convert and Optimize the .mov file:
```bash
ffmpeg -i "C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed\stock videos\AdobeStock_385100237.mov" -vcodec libx264 -crf 28 -preset medium -vf scale=1920:1080 -r 30 -an -movflags +faststart "C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed\assets\videos\golf-background-1.mp4"
```

### Compress the large MP4 files:
```bash
ffmpeg -i "C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed\stock videos\AdobeStock_162188287.mp4" -vcodec libx264 -crf 28 -preset medium -r 30 -an -movflags +faststart "C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed\assets\videos\golf-background-2.mp4"
```

### Copy the acceptable file:
```bash
copy "C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed\stock videos\AdobeStock_1391840411.mp4" "C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed\assets\videos\golf-background-3.mp4"
```

## 🌐 **Option 2: Online Converters (Recommended)**

### CloudConvert.com:
1. Go to cloudconvert.com
2. Upload your .mov file
3. Convert to MP4 with these settings:
   - Video Codec: H.264
   - Quality: Medium (reduces file size)
   - Resolution: 1920x1080 (if larger)
   - Remove audio track
   - Optimize for web/mobile

### Alternative Online Tools:
- **Convertio.co** - Simple drag & drop
- **FreeConvert.com** - Good compression options
- **Media.io** - Professional quality

## 📁 **File Naming Convention**
Save optimized files as:
- `golf-background-1.mp4` (from AdobeStock_385100237.mov)
- `golf-background-2.mp4` (from AdobeStock_162188287.mp4) 
- `golf-background-3.mp4` (from AdobeStock_1391840411.mp4)

## 🎬 **Compression Settings Explained**

### **CRF Value (Constant Rate Factor):**
- CRF 18: Very high quality (~50-100MB)
- **CRF 23**: High quality (~20-40MB) 
- **CRF 28**: Good quality (~5-15MB) ← **Recommended**
- CRF 32: Lower quality (~2-8MB)

### **Preset (Encoding Speed):**
- ultrafast: Largest files, fastest encoding
- **medium**: Balanced ← **Recommended**
- slow: Smaller files, slower encoding

## ✅ **After Optimization**

Once you have the optimized videos:

1. **Place files** in `assets/videos/` folder
2. **I'll update** the SignIn screen to use real videos
3. **Test performance** on mobile devices

## 📊 **Expected Results**
- **File 1**: AdobeStock_385100237 → ~10-15MB MP4
- **File 2**: AdobeStock_162188287 → ~10-15MB MP4  
- **File 3**: AdobeStock_1391840411 → Keep as-is (28MB acceptable)

**Total**: ~50-60MB for all 3 videos (much better than 757MB!)

## 🚀 **Next Steps**
1. Convert/optimize videos using preferred method
2. Place in `assets/videos/` with correct names
3. Let me know when ready and I'll update the code
4. Test the cinematic experience!

The cinematic SignIn screen will look amazing with your actual golf footage! 🏌️‍♂️