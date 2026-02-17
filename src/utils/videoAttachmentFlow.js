const MAX_VIDEO_LENGTH_SECONDS = 5;

const createVideoPickerOptions = ({ allowsEditing }) => {
  const options = {
    mediaTypes: ['videos'],
    allowsEditing: !!allowsEditing,
    quality: 0.8,
    preferredAssetRepresentationMode: 'current',
  };

  if (allowsEditing) {
    options.videoMaxDuration = MAX_VIDEO_LENGTH_SECONDS;
  }

  return options;
};

const getDurationSecondsFromAsset = (asset) => {
  if (!asset?.duration) return 0;
  return asset.duration / 1000;
};

const isCancelledResult = (result) => !result || result.canceled || !result.assets?.length;

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
      : durationSeconds;

    return {
      cancelled: false,
      rejectedTooLong: false,
      uri: selectedAsset.uri,
      durationSeconds: normalizedDuration,
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

  if (isTrimAvailable) {
    try {
      trimmedUri = await trimVideo(selectedAsset.uri);
      if (!trimmedUri) {
        return { cancelled: true };
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
  };
};

export {
  MAX_VIDEO_LENGTH_SECONDS,
  createVideoPickerOptions,
  getDurationSecondsFromAsset,
  resolveVideoAttachment,
};
