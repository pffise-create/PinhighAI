const MAX_VIDEO_LENGTH_SECONDS = 5;

const createVideoPickerOptions = ({ allowsEditing }) => {
  return {
    mediaTypes: ['videos'],
    allowsEditing: !!allowsEditing,
    quality: 0.8,
    preferredAssetRepresentationMode: 'current',
  };
};

const getDurationSecondsFromAsset = (asset) => {
  if (!asset?.duration) return 0;
  return asset.duration / 1000;
};

const isCancelledResult = (result) => !result || result.canceled || !result.assets?.length;

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTrimOutput = (trimOutput, fallbackUri) => {
  if (!trimOutput) return null;

  if (typeof trimOutput === 'string') {
    return { uri: trimOutput, trimData: null };
  }

  if (typeof trimOutput !== 'object') {
    return null;
  }

  const uri = trimOutput.uri || trimOutput.outputPath || trimOutput.url || fallbackUri;
  if (!uri) return null;

  const startTimeMs = toFiniteNumber(
    trimOutput.startTimeMs ?? trimOutput.trimStartMs ?? trimOutput.startTime
  );
  const endTimeMs = toFiniteNumber(
    trimOutput.endTimeMs ?? trimOutput.trimEndMs ?? trimOutput.endTime
  );
  const durationMs = toFiniteNumber(trimOutput.durationMs ?? trimOutput.duration);

  let trimData = null;
  if (startTimeMs !== null && endTimeMs !== null && endTimeMs > startTimeMs) {
    trimData = {
      startTimeMs: Math.round(startTimeMs),
      endTimeMs: Math.round(endTimeMs),
      durationMs: Math.round(endTimeMs - startTimeMs),
    };
  } else if (durationMs !== null && durationMs > 0) {
    trimData = {
      startTimeMs: 0,
      endTimeMs: Math.round(durationMs),
      durationMs: Math.round(durationMs),
    };
  }

  return { uri, trimData };
};

const resolveVideoAttachment = async ({
  isTrimAvailable,
  trimVideo,
  pickVideo,
  preferSystemEditor = false,
}) => {
  if (preferSystemEditor) {
    const systemResult = await pickVideo({ allowsEditing: true });
    if (isCancelledResult(systemResult)) {
      return { cancelled: true };
    }

    const selectedAsset = systemResult.assets[0];
    // iOS edited-video metadata may still report the original pre-trim duration.
    // Trust system editor output and only clamp for display/upload metadata.
    const durationSeconds = getDurationSecondsFromAsset(selectedAsset);
    const normalizedDuration = durationSeconds > 0
      ? Math.min(durationSeconds, MAX_VIDEO_LENGTH_SECONDS)
      : MAX_VIDEO_LENGTH_SECONDS;
    const normalizedDurationMs = Math.round(normalizedDuration * 1000);

    return {
      cancelled: false,
      rejectedTooLong: false,
      uri: selectedAsset.uri,
      durationSeconds: normalizedDuration,
      // System editor UX is best on iOS, but it can return an untrimmed file.
      // Always send deterministic backend trim bounds as a safety net.
      trimData: {
        startTimeMs: 0,
        endTimeMs: normalizedDurationMs,
        durationMs: normalizedDurationMs,
      },
    };
  }

  const initialResult = await pickVideo({
    allowsEditing: !isTrimAvailable,
  });

  if (isCancelledResult(initialResult)) {
    return { cancelled: true };
  }

  let selectedAsset = initialResult.assets[0];
  let durationSeconds = getDurationSecondsFromAsset(selectedAsset);
  let trimmedUri = selectedAsset.uri;
  let trimData = null;

  if (isTrimAvailable) {
    try {
      const trimOutput = await trimVideo(selectedAsset.uri);
      const normalizedTrim = normalizeTrimOutput(trimOutput, selectedAsset.uri);
      if (!normalizedTrim?.uri) {
        return { cancelled: true };
      }
      trimmedUri = normalizedTrim.uri;
      trimData = normalizedTrim.trimData;

      if (trimData?.durationMs) {
        durationSeconds = trimData.durationMs / 1000;
      }
      if (durationSeconds > 0) {
        durationSeconds = Math.min(durationSeconds, MAX_VIDEO_LENGTH_SECONDS);
      }
    } catch {
      if (durationSeconds > MAX_VIDEO_LENGTH_SECONDS) {
        const fallbackResult = await pickVideo({ allowsEditing: true });
        if (isCancelledResult(fallbackResult)) {
          return { cancelled: true };
        }
        selectedAsset = fallbackResult.assets[0];
        trimmedUri = selectedAsset.uri;
        durationSeconds = getDurationSecondsFromAsset(selectedAsset);
        trimData = null;
      }
    }
  }

  if (durationSeconds > MAX_VIDEO_LENGTH_SECONDS) {
    return { rejectedTooLong: true };
  }

  return {
    cancelled: false,
    rejectedTooLong: false,
    uri: trimmedUri,
    durationSeconds,
    trimData,
  };
};

export {
  MAX_VIDEO_LENGTH_SECONDS,
  createVideoPickerOptions,
  getDurationSecondsFromAsset,
  resolveVideoAttachment,
};
