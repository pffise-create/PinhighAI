const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
  if (request === '@aws-sdk/lib-dynamodb') {
    return {
      DynamoDBDocumentClient: { from: () => ({}) },
      GetCommand: class {},
      UpdateCommand: class {},
    };
  }
  if (request === '@aws-sdk/client-lambda') {
    return {
      LambdaClient: class {},
      InvokeCommand: class {},
    };
  }
  if (request === '@aws-sdk/client-s3') {
    return {
      S3Client: class {},
      GetObjectCommand: class {},
      PutObjectCommand: class {},
    };
  }
  if (request === '@aws-sdk/client-secrets-manager') {
    return {
      SecretsManagerClient: class {},
      GetSecretValueCommand: class {},
    };
  }
  return originalLoad(request, parent, isMain);
};

const processorPath = path.join(__dirname, '..', 'src', 'video-breakdown', 'video-breakdown-processor.js');
delete require.cache[require.resolve(processorPath)];
const {
  __private: {
    BREAKDOWN_REQUIRE_MARKED_FRAMES,
    buildFallbackStoryboard,
    buildMuxNarrationArgs,
    derivePreciseImpactTimestamp,
    estimateBreakdownRuntime,
    finalizeSceneHeadline,
    formatSubtitleTimestamp,
    isWeakStoryboard,
    normalizeSpokenText,
    selectFrameForScene,
    tightenScenesForRuntime,
  },
} = require(processorPath);
Module._load = originalLoad;

test('selectFrameForScene promotes the nearest marked frame when the phase pick is plain', () => {
  const frames = [
    {
      phase: 'setup',
      url: 'https://example.com/plain-setup.jpg',
      marked_url: 'https://example.com/marked-setup.jpg',
      timestamp: 0.1,
    },
    {
      phase: 'transition',
      url: 'https://example.com/plain-transition.jpg',
      marked_url: null,
      timestamp: 1.1,
    },
    {
      phase: 'impact',
      url: 'https://example.com/plain-impact.jpg',
      marked_url: 'https://example.com/marked-impact.jpg',
      timestamp: 1.3,
    },
  ];

  const lookup = {
    frames,
    pickForPhase: (phase) => frames.find((frame) => frame.phase === phase) || null,
  };

  const selected = selectFrameForScene(lookup, 'transition', 1);
  assert.equal(selected.marked_url, 'https://example.com/marked-impact.jpg');
});

test('estimateBreakdownRuntime accounts for scene overlaps', () => {
  const runtime = estimateBreakdownRuntime([3.6, 3.9, 4.1]);
  assert.equal(Number(runtime.toFixed(2)), 11.24);
});

test('marked frames are required by default for rendered breakdown scenes', () => {
  assert.equal(BREAKDOWN_REQUIRE_MARKED_FRAMES, true);
});

test('formatSubtitleTimestamp emits WebVTT and SRT-compatible timestamps', () => {
  assert.equal(formatSubtitleTimestamp(5.212, 'vtt'), '00:00:05.212');
  assert.equal(formatSubtitleTimestamp(65.847, 'srt'), '00:01:05,847');
});

test('derivePreciseImpactTimestamp interpolates between top and finish when no anchor exists', () => {
  assert.equal(
    derivePreciseImpactTimestamp({
      anchorTime: null,
      pickForPhase: (phase) => ({
        top: { timestamp: 0.75 },
        finish: { timestamp: 1.5 },
      }[phase] || null),
    }),
    1.2
  );
});

test('normalizeSpokenText downgrades smart punctuation for overlay-safe copy', () => {
  assert.equal(
    normalizeSpokenText('Practice: top feels centered—ribs over zipper… “now”'),
    'Practice: top feels centered, ribs over zipper... "now"'
  );
});

test('tightenScenesForRuntime stabilizes the one-feel headline into a clearer takeaway', () => {
  const scenes = tightenScenesForRuntime([
    {
      headline: 'High hands with trail-side lean',
      caption: 'Top gets high with extra lean away from target.',
      narration: 'At the top, your hands ride high and your chest leans back.',
    },
    {
      headline: 'Low point drifts behind the ball',
      caption: 'Late low point = thin strikes or a last-second flip.',
      narration: 'That makes the low point late, so contact turns thin or flippy.',
    },
    {
      headline: 'Rehearse: ribs stacked over zip…',
      caption: 'Practice: top feels centered—ribs over zipper.',
      narration: 'Rehearse this: at the top, keep ribs stacked over your zipper—centered.',
    },
  ]);

  const scene = scenes[2];
  assert.equal(scene.headline, 'Feel Centered at the Top');
  assert.equal(scene.caption, 'Practice: top feels centered, ribs over zipper.');
});

test('finalizeSceneHeadline keeps scene-three takeaway headlines short and specific', () => {
  assert.equal(
    finalizeSceneHeadline({
      headline: 'Rehearse: ribs stacked over zip…',
      caption: 'Practice: top feels centered, ribs over zipper.',
      narration: 'Rehearse this feel at the top.',
    }, 2),
    'Feel Centered at the Top'
  );
});

test('buildMuxNarrationArgs preserves the full subtitle track and fast-start metadata', () => {
  const args = buildMuxNarrationArgs({
    videoPath: 'video.mp4',
    audioPath: 'audio.m4a',
    subtitlePath: 'captions.srt',
    outputPath: 'out.mp4',
  });

  assert.ok(!args.includes('-shortest'));
  assert.deepEqual(
    args.slice(args.indexOf('-movflags'), args.indexOf('-movflags') + 2),
    ['-movflags', '+faststart']
  );
});

test('buildFallbackStoryboard turns analysis into fault-cost-feel-keep coaching scenes', () => {
  const storyboard = buildFallbackStoryboard({
    aiAnalysis: {
      coaching_response: [
        'Your hands get quite high with noticeable trail-side tilt at the top.',
        'That can move the low point back and make contact more timing-dependent.',
        'Feel more centered at the top so the low point stays forward.',
        'Keep your finish exactly like this.',
      ].join(' '),
      visual_observations: [
        {
          phase: 'backswing',
          observation: 'At the top of the backswing, hands are high and the club shaft is near-horizontal above the head.',
          confidence: 0.8,
          impact: 'neutral',
        },
        {
          phase: 'backswing',
          observation: 'Upper body shows a pronounced tilt/side bend away from the target at the top.',
          confidence: 0.78,
          impact: 'neutral',
        },
        {
          phase: 'follow_through',
          observation: 'Finish position shows weight largely on the lead foot with the trail foot up on the toe.',
          confidence: 0.9,
          impact: 'positive',
        },
      ],
    },
    frameLookup: {
      frames: [
        { phase: 'frame_000', marked_url: 'setup.jpg', url: 'setup.jpg', timestamp: 0 },
        { phase: 'frame_003', marked_url: 'top.jpg', url: 'top.jpg', timestamp: 0.75 },
        { phase: 'frame_004', marked_url: 'delivery.jpg', url: 'delivery.jpg', timestamp: 1 },
        { phase: 'frame_006', marked_url: 'finish.jpg', url: 'finish.jpg', timestamp: 1.5 },
      ],
      pickForPhase: (phase) => ({
        top: { marked_url: 'top.jpg', url: 'top.jpg', timestamp: 0.75 },
        delivery: { marked_url: 'delivery.jpg', url: 'delivery.jpg', timestamp: 1 },
        finish: { marked_url: 'finish.jpg', url: 'finish.jpg', timestamp: 1.5 },
      }[phase] || { marked_url: 'top.jpg', url: 'top.jpg', timestamp: 0.75 }),
    },
  });

  assert.deepEqual(
    storyboard.scenes.map((scene) => scene.headline),
    [
      'High Hands with Trail-Side Lean',
      'Low Point Gets Late',
      'Feel Centered at the Top',
      'Keep the Balanced Finish',
    ]
  );
  assert.equal(storyboard.scenes[0].frame_phase, 'top');
  assert.equal(storyboard.scenes[1].frame_phase, 'delivery');
  assert.equal(storyboard.scenes[2].frame_phase, 'top');
  assert.equal(storyboard.scenes[3].frame_phase, 'finish');
});

test('isWeakStoryboard rejects generic or clipped scripted scenes', () => {
  assert.equal(
    isWeakStoryboard({
      scenes: [
        { headline: 'Main Issue', caption: 'At the top...', narration: 'At the top...', frame_url: 'a.jpg' },
        { headline: 'What It Costs', caption: 'Low point...', narration: 'Low point...', frame_url: 'b.jpg' },
        { headline: 'One Feel', caption: 'Practice...', narration: 'Practice...', frame_url: 'c.jpg' },
        { headline: 'Keep This', caption: 'Finish...', narration: 'Finish...', frame_url: 'd.jpg' },
      ],
    }),
    true
  );

  assert.equal(
    isWeakStoryboard({
      scenes: [
        { headline: 'Center the Top', caption: 'High hands combine with extra trail-side lean.', narration: 'At the top, your hands get high while your chest leans away from.', frame_url: 'a.jpg' },
        { headline: 'Protect the Low Point', caption: 'A late low point creates thin or flippy contact.', narration: 'That moves the low point behind the ball.', frame_url: 'b.jpg' },
        { headline: 'Rehearse a Centered Feel', caption: 'Rehearse: ribs stacked over zipper at the top.', narration: 'Rehearse this immediately: at the top, feel your ribs stacked over your zipper.', frame_url: 'c.jpg' },
        { headline: 'Keep the Balanced Finish', caption: 'Keep the balanced finish with weight forward.', narration: 'Keep your strong finish: chest through, weight forward, and trail toe lifted.', frame_url: 'd.jpg' },
      ],
    }),
    true
  );
});
