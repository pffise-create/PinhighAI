// useVideoTrim.js - Hook wrapping react-native-video-trim native editor
// Shows the native iOS/Android trim UI, enforces maxDuration, returns trimmed URI.
// Gracefully degrades when the native module is unavailable (Expo Go / dev-client mismatch).
import { useState, useEffect, useCallback, useRef } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';

const MAX_DURATION_SECONDS = 5;

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTimeToMs = (value) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed < 0) return null;
  // react-native-video-trim can surface seconds in JS callbacks; normalize to ms.
  return parsed <= MAX_DURATION_SECONDS + 1 ? Math.round(parsed * 1000) : Math.round(parsed);
};

// Safely check if the native module is available before importing bridge functions
const nativeModule = NativeModules.VideoTrim;
let isValidFile;
let showEditor;
let trimModule;

if (nativeModule) {
  try {
    const trimLib = require('react-native-video-trim');
    isValidFile = trimLib.isValidFile;
    showEditor = trimLib.showEditor;
    trimModule = trimLib.default;
  } catch {
    // Module installed but native code not linked
  }
}

const useVideoTrim = () => {
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimmedUri, setTrimmedUri] = useState(null);
  const [error, setError] = useState(null);
  const isAvailable = !!showEditor && !!isValidFile;

  // Stable refs that survive re-renders and settle the active trim promise.
  const resolveRef = useRef(null);
  const rejectRef = useRef(null);

  useEffect(() => {
    const subscriptions = [];

    const handleFinish = (event) => {
      const uri = event?.outputPath || event?.url;
      const startTimeMs = normalizeTimeToMs(event?.startTime);
      const endTimeMs = normalizeTimeToMs(event?.endTime);
      const eventDurationMs = normalizeTimeToMs(event?.duration);
      const durationMs = eventDurationMs ?? (
        startTimeMs !== null && endTimeMs !== null && endTimeMs > startTimeMs
          ? endTimeMs - startTimeMs
          : null
      );

      const trimResult = {
        uri,
        startTimeMs,
        endTimeMs,
        durationMs,
      };

      setTrimmedUri(uri);
      setIsTrimming(false);
      resolveRef.current?.(trimResult);
      resolveRef.current = null;
      rejectRef.current = null;
    };

    const handleCancel = () => {
      setIsTrimming(false);
      resolveRef.current?.(null);
      resolveRef.current = null;
      rejectRef.current = null;
    };

    const handleError = (event) => {
      const err = new Error(event?.message || 'Video trim failed');
      setError(err);
      setIsTrimming(false);
      rejectRef.current?.(err);
      resolveRef.current = null;
      rejectRef.current = null;
    };

    const handleLegacyEvent = (event) => {
      if (!event?.name) return;
      switch (event.name) {
        case 'onFinishTrimming':
          handleFinish(event);
          break;
        case 'onCancelTrimming':
        case 'onCancel':
          handleCancel();
          break;
        case 'onError':
          handleError(event);
          break;
        default:
          break;
      }
    };

    // New architecture subscriptions
    if (typeof trimModule?.onFinishTrimming === 'function') {
      subscriptions.push(trimModule.onFinishTrimming(handleFinish));
    }
    if (typeof trimModule?.onCancelTrimming === 'function') {
      subscriptions.push(trimModule.onCancelTrimming(handleCancel));
    }
    if (typeof trimModule?.onCancel === 'function') {
      subscriptions.push(trimModule.onCancel(handleCancel));
    }
    if (typeof trimModule?.onHide === 'function') {
      subscriptions.push(trimModule.onHide(handleCancel));
    }
    if (typeof trimModule?.onError === 'function') {
      subscriptions.push(trimModule.onError(handleError));
    }

    // Old architecture emitter subscriptions
    if (nativeModule) {
      const eventEmitter = new NativeEventEmitter(nativeModule);
      subscriptions.push(eventEmitter.addListener('onFinishTrimming', handleFinish));
      subscriptions.push(eventEmitter.addListener('onCancelTrimming', handleCancel));
      subscriptions.push(eventEmitter.addListener('onCancel', handleCancel));
      subscriptions.push(eventEmitter.addListener('onHide', handleCancel));
      subscriptions.push(eventEmitter.addListener('onError', handleError));
      subscriptions.push(eventEmitter.addListener('VideoTrim', handleLegacyEvent));
    }

    return () => {
      subscriptions.forEach((subscription) => subscription?.remove?.());
      resolveRef.current = null;
      rejectRef.current = null;
    };
  }, []);

  // Opens the native trim editor. Returns Promise<{ uri, startTimeMs, endTimeMs, durationMs }|null>.
  // Throws TRIM_UNAVAILABLE if the native module is not linked.
  const trimVideo = useCallback(async (videoUri) => {
    if (!isAvailable) {
      throw new Error('TRIM_UNAVAILABLE');
    }

    setError(null);
    setTrimmedUri(null);

    const validationResult = await isValidFile(videoUri);
    const valid = typeof validationResult === 'boolean'
      ? validationResult
      : !!validationResult?.isValid;
    if (!valid) {
      throw new Error('Selected file is not a valid video');
    }

    setIsTrimming(true);

    return new Promise((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
      try {
        showEditor(videoUri, {
          maxDuration: MAX_DURATION_SECONDS,
          enableCancelDialog: false,
          enableSaveDialog: false,
        });
      } catch (nativeError) {
        setIsTrimming(false);
        resolveRef.current = null;
        rejectRef.current = null;
        reject(nativeError);
      }
    });
  }, [isAvailable]);

  const reset = useCallback(() => {
    setTrimmedUri(null);
    setError(null);
    setIsTrimming(false);
  }, []);

  return { trimVideo, isTrimming, trimmedUri, error, reset, isAvailable };
};

export default useVideoTrim;
