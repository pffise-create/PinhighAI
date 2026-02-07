// useVideoTrim.js - Hook wrapping react-native-video-trim native editor
// Shows the native iOS/Android trim UI, enforces maxDuration, returns trimmed URI.
import { useState, useEffect, useCallback, useRef } from 'react';
import { isValidVideo, showEditor } from 'react-native-video-trim';
import { NativeEventEmitter, NativeModules } from 'react-native';

const MAX_DURATION_SECONDS = 5;

const useVideoTrim = () => {
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimmedUri, setTrimmedUri] = useState(null);
  const [error, setError] = useState(null);

  // Stable refs that survive re-renders — holds the Promise resolve/reject
  // for the current trimVideo() call so native event callbacks can settle it.
  const resolveRef = useRef(null);
  const rejectRef = useRef(null);

  useEffect(() => {
    // Subscribe to native trim events
    const eventEmitter = new NativeEventEmitter(NativeModules.VideoTrim);

    const finishSub = eventEmitter.addListener('onFinishTrimming', (event) => {
      const uri = event.outputPath || event.url;
      setTrimmedUri(uri);
      setIsTrimming(false);
      resolveRef.current?.(uri);
      resolveRef.current = null;
    });

    const cancelSub = eventEmitter.addListener('onCancelTrimming', () => {
      setIsTrimming(false);
      resolveRef.current?.(null);
      resolveRef.current = null;
    });

    const errorSub = eventEmitter.addListener('onError', (event) => {
      const err = new Error(event?.message || 'Video trim failed');
      setError(err);
      setIsTrimming(false);
      rejectRef.current?.(err);
      rejectRef.current = null;
    });

    return () => {
      finishSub.remove();
      cancelSub.remove();
      errorSub.remove();
    };
  }, []);

  // Opens the native trim editor. Returns a Promise<string|null> (trimmed URI or null if cancelled).
  const trimVideo = useCallback(async (videoUri) => {
    setError(null);
    setTrimmedUri(null);

    const valid = await isValidVideo(videoUri);
    if (!valid) {
      throw new Error('Selected file is not a valid video');
    }

    setIsTrimming(true);

    return new Promise((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
      showEditor(videoUri, { maxDuration: MAX_DURATION_SECONDS });
    });
  }, []);

  const reset = useCallback(() => {
    setTrimmedUri(null);
    setError(null);
    setIsTrimming(false);
  }, []);

  return { trimVideo, isTrimming, trimmedUri, error, reset };
};

export default useVideoTrim;
