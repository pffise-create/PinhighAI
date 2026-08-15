const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFrameLookup,
  normalizeBreakdownRecord,
} = require('../src/video-breakdown/shared');

test('buildFrameLookup preserves marked frame urls and anchors phase picks around impact', () => {
  const lookup = buildFrameLookup({
    extraction: { anchor_time: 1.2 },
    frames: [
      {
        phase: 'setup',
        url: 'https://example.com/plain-setup.jpg',
        markedUrl: 'https://example.com/marked-setup.jpg',
        timestamp: 0.1,
      },
      {
        phase: 'backswing',
        url: 'https://example.com/plain-backswing.jpg',
        marked_url: 'https://example.com/marked-backswing.jpg',
        timestamp: 0.7,
      },
      {
        phase: 'impact',
        url: 'https://example.com/plain-impact.jpg',
        marked_url: 'https://example.com/marked-impact.jpg',
        timestamp: 1.2,
      },
      {
        phase: 'follow_through',
        url: 'https://example.com/plain-finish.jpg',
        marked_url: 'https://example.com/marked-finish.jpg',
        timestamp: 1.6,
      },
    ],
  });

  assert.equal(lookup.frames[0].marked_url, 'https://example.com/marked-setup.jpg');
  assert.equal(lookup.pickForPhase('setup').marked_url, 'https://example.com/marked-setup.jpg');
  assert.equal(lookup.pickForPhase('impact').timestamp, 1.2);
  assert.equal(lookup.pickForPhase('transition').timestamp, 1.2);
  assert.equal(lookup.pickForPhase('follow_through').marked_url, 'https://example.com/marked-finish.jpg');
});

test('buildFrameLookup recovers marked frame urls from analysis_results.marking.frames', () => {
  const lookup = buildFrameLookup({
    marking: {
      frames: [
        {
          phase: 'transition',
          marked_frame_url: 'https://example.com/marked-transition.jpg',
        },
        {
          phase: 'impact',
          marked_frame_url: 'https://example.com/marked-impact.jpg',
        },
      ],
    },
    frames: [
      {
        phase: 'transition',
        url: 'https://example.com/plain-transition.jpg',
        timestamp: 0.8,
      },
      {
        phase: 'impact',
        url: 'https://example.com/plain-impact.jpg',
        timestamp: 1.2,
      },
    ],
  });

  assert.equal(
    lookup.frames.find((frame) => frame.phase === 'transition')?.marked_url,
    'https://example.com/marked-transition.jpg'
  );
  assert.equal(
    lookup.frames.find((frame) => frame.phase === 'impact')?.marked_url,
    'https://example.com/marked-impact.jpg'
  );
});

test('buildFrameLookup spreads phase picks across unanchored clips', () => {
  const lookup = buildFrameLookup({
    frames: Array.from({ length: 7 }, (_, index) => ({
      phase: `frame_${String(index).padStart(3, '0')}`,
      url: `https://example.com/frame-${index}.jpg`,
      timestamp: index * 0.25,
    })),
  });

  assert.equal(lookup.anchorTime, null);
  assert.equal(lookup.pickForPhase('setup')?.timestamp, 0);
  assert.equal(lookup.pickForPhase('backswing')?.timestamp, 0.75);
  assert.equal(lookup.pickForPhase('top')?.timestamp, 0.75);
  assert.equal(lookup.pickForPhase('transition')?.timestamp, 1);
  assert.equal(lookup.pickForPhase('delivery')?.timestamp, 1);
  assert.equal(lookup.pickForPhase('impact')?.timestamp, 1.25);
  assert.equal(lookup.pickForPhase('follow_through')?.timestamp, 1.5);
  assert.equal(lookup.pickForPhase('finish')?.timestamp, 1.5);
});

test('normalizeBreakdownRecord keeps cue timing, caption content, and mute-first defaults', () => {
  const breakdown = normalizeBreakdownRecord({
    status: 'completed',
    title: 'Coach Cut',
    summary: 'Muted by default. Captions stay on.',
    duration_seconds: 23.4,
    captions_url: 'https://example.com/breakdown.vtt',
    captions_default: true,
    embedded_captions: true,
    scenes: [
      {
        id: 'scene_1',
        phase: 'transition',
        frame_phase: 'delivery',
        headline: 'Club Settles',
        caption: 'The club starts to shallow into transition.',
        narration: 'The club starts to shallow into transition.',
        start_seconds: 5.212,
        end_seconds: 10.847,
        frame_url: 'https://example.com/marked-transition.jpg',
        poster_url: 'https://example.com/poster.jpg',
        marked: true,
      },
    ],
  });

  assert.equal(breakdown.muted_default, true);
  assert.equal(breakdown.duration_seconds, 23.4);
  assert.equal(breakdown.captions_url, 'https://example.com/breakdown.vtt');
  assert.equal(breakdown.embedded_captions, true);
  assert.equal(breakdown.scenes.length, 1);
  assert.deepEqual(breakdown.scenes[0], {
    id: 'scene_1',
    phase: 'transition',
    frame_phase: 'delivery',
    headline: 'Club Settles',
    caption: 'The club starts to shallow into transition.',
    narration: 'The club starts to shallow into transition.',
    start_seconds: 5.21,
    end_seconds: 10.85,
    frame_timestamp: null,
    frame_url: 'https://example.com/marked-transition.jpg',
    poster_url: 'https://example.com/poster.jpg',
    marked: true,
  });
});
