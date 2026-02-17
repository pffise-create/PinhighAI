const {
  MAX_VIDEO_LENGTH_SECONDS,
  createVideoPickerOptions,
  resolveVideoAttachment,
} = require('../../src/utils/videoAttachmentFlow');

describe('videoAttachmentFlow', () => {
  it('builds editing picker options with a 5-second cap', () => {
    const options = createVideoPickerOptions({ allowsEditing: true });

    expect(options).toEqual(
      expect.objectContaining({
        mediaTypes: ['videos'],
        allowsEditing: true,
        videoMaxDuration: MAX_VIDEO_LENGTH_SECONDS,
      })
    );
  });

  it('uses native trim when available', async () => {
    const pickVideo = jest.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://original.mov', duration: 12000 }],
    });
    const trimVideo = jest.fn().mockResolvedValue('file://trimmed.mov');

    const result = await resolveVideoAttachment({
      isTrimAvailable: true,
      trimVideo,
      pickVideo,
    });

    expect(pickVideo).toHaveBeenCalledTimes(1);
    expect(pickVideo).toHaveBeenCalledWith({ allowsEditing: false });
    expect(trimVideo).toHaveBeenCalledWith('file://original.mov');
    expect(result).toEqual({
      cancelled: false,
      rejectedTooLong: false,
      uri: 'file://trimmed.mov',
      durationSeconds: MAX_VIDEO_LENGTH_SECONDS,
    });
  });

  it('uses system editor path when preferred (iOS mode)', async () => {
    const pickVideo = jest.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://ios-edited.mov', duration: 4300 }],
    });
    const trimVideo = jest.fn();

    const result = await resolveVideoAttachment({
      isTrimAvailable: true,
      trimVideo,
      pickVideo,
      preferSystemEditor: true,
    });

    expect(pickVideo).toHaveBeenCalledTimes(1);
    expect(pickVideo).toHaveBeenCalledWith({ allowsEditing: true });
    expect(trimVideo).not.toHaveBeenCalled();
    expect(result).toEqual({
      cancelled: false,
      rejectedTooLong: false,
      uri: 'file://ios-edited.mov',
      durationSeconds: 4.3,
    });
  });

  it('does not reject long metadata in system editor mode and clamps duration', async () => {
    const pickVideo = jest.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://ios-too-long.mov', duration: 6200 }],
    });
    const trimVideo = jest.fn();

    const result = await resolveVideoAttachment({
      isTrimAvailable: true,
      trimVideo,
      pickVideo,
      preferSystemEditor: true,
    });

    expect(trimVideo).not.toHaveBeenCalled();
    expect(result).toEqual({
      cancelled: false,
      rejectedTooLong: false,
      uri: 'file://ios-too-long.mov',
      durationSeconds: MAX_VIDEO_LENGTH_SECONDS,
    });
  });

  it('falls back to picker editor if native trim fails on a long clip', async () => {
    const pickVideo = jest
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file://original.mov', duration: 12000 }],
      })
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file://fallback-trimmed.mov', duration: 4200 }],
      });
    const trimVideo = jest.fn().mockRejectedValue(new Error('trim failure'));

    const result = await resolveVideoAttachment({
      isTrimAvailable: true,
      trimVideo,
      pickVideo,
    });

    expect(pickVideo).toHaveBeenNthCalledWith(1, { allowsEditing: false });
    expect(pickVideo).toHaveBeenNthCalledWith(2, { allowsEditing: true });
    expect(result).toEqual({
      cancelled: false,
      rejectedTooLong: false,
      uri: 'file://fallback-trimmed.mov',
      durationSeconds: 4.2,
    });
  });

  it('rejects long clips when no trim path is available', async () => {
    const pickVideo = jest.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://original.mov', duration: 12000 }],
    });
    const trimVideo = jest.fn();

    const result = await resolveVideoAttachment({
      isTrimAvailable: false,
      trimVideo,
      pickVideo,
    });

    expect(pickVideo).toHaveBeenCalledWith({ allowsEditing: true });
    expect(trimVideo).not.toHaveBeenCalled();
    expect(result).toEqual({ rejectedTooLong: true });
  });

  it('keeps the original clip if native trim fails but video is already short', async () => {
    const pickVideo = jest.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://short.mov', duration: 3800 }],
    });
    const trimVideo = jest.fn().mockRejectedValue(new Error('trim failure'));

    const result = await resolveVideoAttachment({
      isTrimAvailable: true,
      trimVideo,
      pickVideo,
    });

    expect(pickVideo).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      cancelled: false,
      rejectedTooLong: false,
      uri: 'file://short.mov',
      durationSeconds: 3.8,
    });
  });

  it('returns cancelled when picker is cancelled', async () => {
    const pickVideo = jest.fn().mockResolvedValue({ canceled: true, assets: [] });
    const trimVideo = jest.fn();

    const result = await resolveVideoAttachment({
      isTrimAvailable: false,
      trimVideo,
      pickVideo,
    });

    expect(result).toEqual({ cancelled: true });
  });
});
