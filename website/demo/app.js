const sessions = {
  driver: {
    breadcrumb: 'Driver session',
    view: 'Down the line',
    stageLabel: 'Driver · Today',
    findingShort: 'Trail elbow depth',
    confidence: 'High confidence',
    findingTitle: 'Your trail elbow gets behind your rib cage in transition.',
    findingBody: 'That narrows delivery space, leaves the face open, and sends the path left. The result is the start-right fade you described.',
    practiceTitle: '3× pump drill',
    practiceBody: 'Three slow rehearsals, then one ball at 70% speed.',
    contextTitle: 'Driver · Down the line',
    contextMeta: 'Today · 4.8 second swing',
    opening: 'The pattern is clear: your setup and shoulder turn are strong. The miss starts when your trail elbow slips behind you in transition.',
    priority: 'Keep that elbow in front of your shirt seam as the downswing begins. It gives the club room to shallow without holding the face open.',
    suggestions: ['What changed from my last driver session?', 'Why does this create a fade?', 'Give me one drill.'],
    compareResponse: 'Compared with your previous driver session, your backswing is more centered and the finish is better balanced. The trail elbow is still moving behind you, but it happens later and by a smaller amount. That is real progress.',
    causeResponse: 'The ball starts right because the face is open to the target at impact. It fades because the club path is even farther left than the face. The elbow position contributes to both by crowding the club in transition.',
    drillResponse: 'Make three slow pump rehearsals. Pause halfway down with the trail elbow in front of your shirt seam, then return to the top. On the fourth motion, swing through at 70%. Keep the ball flight secondary to the feel.',
    feelResponse: 'It should feel as if the trail elbow points toward the front pocket while your pressure moves into the lead heel. The elbow does not need to pin against your side; it only needs to stay in front of the rib cage.',
    accent: 'transition',
  },
  iron: {
    breadcrumb: '7 iron session',
    view: 'Face on',
    stageLabel: '7 iron · Aug 22',
    findingShort: 'Transition tempo',
    confidence: 'Strong signal',
    findingTitle: 'Your transition speeds up before pressure reaches the lead side.',
    findingBody: 'The upper body starts down first, moving the low point behind the ball. Your best swings create a quieter change of direction.',
    practiceTitle: 'Step-through drill',
    practiceBody: 'Rehearse a patient top, then let the lead foot start the motion.',
    contextTitle: '7 iron · Face on',
    contextMeta: 'Aug 22 · 5.1 second swing',
    opening: 'Your structure is athletic and the backswing is complete. The opportunity is sequencing: pressure needs to move before the shoulders unwind.',
    priority: 'Let the lead heel receive pressure before the shoulders unwind. That moves the low point forward without asking your hands to rescue the strike.',
    suggestions: ['What changed from my last iron session?', 'Why is my low point moving back?', 'Give me a sequencing drill.'],
    compareResponse: 'Your latest iron swing has a more complete turn and less lateral movement away from the ball. The transition is still quick, but contact is tightening because the pressure shift starts earlier than it did last session.',
    causeResponse: 'When the shoulders start down before pressure reaches the lead foot, your center stays behind the ball. The club bottoms out early, so contact moves between heavy and thin even when the face is stable.',
    drillResponse: 'Use a step-through drill: begin with your feet close together, start the backswing, then step toward the target before the club changes direction. Hit five half-speed shots and keep the finish balanced.',
    feelResponse: 'Feel the lead heel get heavy for a fraction of a second before the chest turns through. It should feel patient at the top, not slow through the ball.',
    accent: 'tempo',
  },
  wedge: {
    breadcrumb: 'Wedge session',
    view: 'Down the line',
    stageLabel: 'Wedge · Aug 17',
    findingShort: 'Low-point control',
    confidence: 'High confidence',
    findingTitle: 'Your chest stalls while the club passes your hands through impact.',
    findingBody: 'That moves the bottom of the arc backward and makes strike quality timing-dependent. Keep the chest turning through the shot.',
    practiceTitle: 'Towel line drill',
    practiceBody: 'Place a towel four inches behind the ball and miss it for five shots.',
    contextTitle: 'Wedge · Down the line',
    contextMeta: 'Aug 17 · 3.9 second swing',
    opening: 'The backswing length is well matched to the shot. Your contact changes when rotation pauses and the clubhead has to pass your hands.',
    priority: 'Keep the chest turning through the strike while the handle stays moving. That stabilizes the bottom of the arc without adding effort.',
    suggestions: ['Is my wedge strike improving?', 'Why does my chest stall?', 'Give me a low-point drill.'],
    compareResponse: 'Yes. Your strike window is narrower than it was two sessions ago and the finish is more stable. The remaining misses appear when chest rotation pauses through impact.',
    causeResponse: 'The chest stalls when the motion becomes hand-dominant near the ball. Once rotation stops, the clubhead passes the handle and the low point shifts backward.',
    drillResponse: 'Place a folded towel four inches behind the ball. Hit five waist-high wedges without touching it, keeping the chest moving toward the target through the strike.',
    feelResponse: 'Feel the shirt buttons continue turning left while the club brushes the turf. The finish can stay short, but the chest should never stop.',
    accent: 'impact',
  },
};

const phases = [
  {
    name: 'ADDRESS',
    time: '00:00',
    annotationLabel: 'Setup',
    annotationTitle: 'Balanced posture creates room to turn',
    caption: 'Pressure centered. Arms hang naturally under the shoulders.',
  },
  {
    name: 'TRANSITION',
    time: '02:18',
    annotationLabel: 'Transition',
    annotationTitle: 'Elbow moves behind the shirt seam',
    caption: 'Keep the trail elbow in front as pressure shifts left.',
  },
  {
    name: 'IMPACT',
    time: '03:04',
    annotationLabel: 'Impact',
    annotationTitle: 'Open face meets a path moving left',
    caption: 'Create delivery space earlier instead of saving the face late.',
  },
  {
    name: 'FINISH',
    time: '04:11',
    annotationLabel: 'Finish',
    annotationTitle: 'Athletic balance is a clear strength',
    caption: 'Keep the finish. Change only the transition priority.',
  },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const stage = $('#film-stage');
const swingImage = $('#swing-image');
const stagePlay = $('#stage-play');
const transportPlay = $('#transport-play');
const phaseButtons = $$('.phase-track button[data-phase]');
const overlay = $('#analysis-overlay');
const overlayToggle = $('#overlay-toggle');
const coachThread = $('#coach-thread');
const coachInput = $('#coach-input');
const coachForm = $('#coach-form');
const uploadDialog = $('#upload-dialog');
const videoFile = $('#video-file');
const uploadProgress = $('#upload-progress');
const uploadStatus = $('#upload-status');
const uploadPercent = $('#upload-percent');
const uploadRule = $('.progress-rule span');
const toast = $('#toast');

let activeSession = 'driver';
let activePhase = 1;
let playTimer = null;
let localVideoUrl = null;
let currentMedia = swingImage;

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function updateSession(key) {
  const session = sessions[key];
  if (!session) return;

  activeSession = key;
  restoreCuratedMedia();
  $$('.session-card').forEach((card) => card.classList.toggle('is-active', card.dataset.session === key));
  setText('#breadcrumb-session', session.breadcrumb);
  setText('#session-view', session.view);
  setText('#stage-session-label', session.stageLabel);
  setText('#finding-short', session.findingShort);
  setText('#confidence-label', session.confidence);
  setText('#finding-title', session.findingTitle);
  setText('#finding-body', session.findingBody);
  setText('#practice-title', session.practiceTitle);
  setText('#practice-body', session.practiceBody);
  setText('#context-title', session.contextTitle);
  setText('#context-meta', session.contextMeta);
  setText('#coach-opening', session.opening);
  const priority = $('#coach-priority');
  priority.textContent = '';
  const priorityLead = document.createElement('strong');
  priorityLead.textContent = 'One priority: ';
  priority.append(priorityLead, document.createTextNode(session.priority));
  $$('#suggestion-list button').forEach((button, index) => {
    const suggestion = session.suggestions[index];
    button.textContent = suggestion;
    button.dataset.prompt = suggestion;
  });
  setPhase(session.accent === 'impact' ? 2 : 1);
  resetCoachConversation();
  showToast(`${session.breadcrumb} loaded`);
}

function restoreCuratedMedia() {
  if (currentMedia?.tagName !== 'VIDEO') return;

  currentMedia.pause();
  const image = document.createElement('img');
  image.src = 'assets/swing-session.jpg';
  image.alt = 'Golfer at the top of a driver swing on a fairway';
  image.width = 1800;
  image.height = 2706;
  image.fetchPriority = 'high';
  currentMedia.replaceWith(image);
  currentMedia = image;
  if (localVideoUrl) {
    URL.revokeObjectURL(localVideoUrl);
    localVideoUrl = null;
  }
}

function setPhase(index) {
  const phase = phases[index];
  if (!phase) return;

  activePhase = index;
  stage.dataset.phase = String(index);
  phaseButtons.forEach((button, buttonIndex) => {
    const isActive = buttonIndex === index;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  setText('#phase-stamp', `${phase.name} / ${phase.time}`);
  setText('#annotation-title', phase.annotationTitle);
  setText('.annotation small', phase.annotationLabel);
  setText('#stage-caption', phase.caption);

  const caption = $('#stage-caption');
  if (caption) {
    caption.textContent = '';
    const label = document.createElement('span');
    label.textContent = 'Coach cue';
    caption.append(label, document.createTextNode(` ${phase.caption}`));
  }

  $('#track-progress').style.width = `${index * 33.33}%`;
}

function stopPlayback() {
  if (playTimer) window.clearInterval(playTimer);
  playTimer = null;
  stage.classList.remove('is-playing');
  stagePlay.classList.remove('is-playing');
  transportPlay.classList.remove('is-playing');
}

function togglePlayback() {
  if (playTimer) {
    stopPlayback();
    return;
  }

  stage.classList.add('is-playing');
  stagePlay.classList.add('is-playing');
  transportPlay.classList.add('is-playing');
  setPhase((activePhase + 1) % phases.length);
  playTimer = window.setInterval(() => setPhase((activePhase + 1) % phases.length), 1450);
}

function createCoachMessage(text, className = 'coach-message') {
  if (className === 'user-message') {
    const userMessage = document.createElement('div');
    userMessage.className = className;
    userMessage.textContent = text;
    return userMessage;
  }

  const article = document.createElement('article');
  article.className = className;
  const mark = document.createElement('div');
  mark.className = 'message-mark';
  mark.innerHTML = '<svg aria-hidden="true"><use href="#icon-spark"></use></svg>';
  const body = document.createElement('div');
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  body.append(paragraph);
  article.append(mark, body);
  return article;
}

function chooseResponse(question) {
  const normalized = question.toLowerCase();
  const session = sessions[activeSession];
  if (/changed|last|previous|compare|improving/.test(normalized)) return session.compareResponse;
  if (/feel|pump/.test(normalized)) return session.feelResponse;
  if (/drill|practice|range|work on/.test(normalized)) return session.drillResponse;
  if (/fade|right|path|face|ball flight|low point|stall|why/.test(normalized)) return session.causeResponse;
  return `The clearest priority in this session is ${session.findingShort.toLowerCase()}. Keep the next practice block centered on that one change rather than rebuilding the whole swing.`;
}

function askCoach(question) {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) return;

  coachThread.append(createCoachMessage(cleanQuestion, 'user-message'));
  coachInput.value = '';
  coachInput.style.height = '';
  $('#suggestion-list').style.display = 'none';

  const typing = document.createElement('article');
  typing.className = 'coach-message typing-row';
  typing.innerHTML = '<div class="message-mark"><svg aria-hidden="true"><use href="#icon-spark"></use></svg></div><div class="typing-message"><i></i><i></i><i></i></div>';
  coachThread.append(typing);
  coachThread.scrollTop = coachThread.scrollHeight;

  window.setTimeout(() => {
    typing.replaceWith(createCoachMessage(chooseResponse(cleanQuestion)));
    coachThread.scrollTo({ top: coachThread.scrollHeight, behavior: 'smooth' });
  }, 760);
}

function resetCoachConversation() {
  $$('.user-message, .typing-row', coachThread).forEach((node) => node.remove());
  const messages = $$('.coach-message', coachThread);
  messages.slice(1).forEach((node) => node.remove());
  $('#suggestion-list').style.display = '';
}

function openUpload() {
  uploadDialog.hidden = false;
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => $('#video-file').focus(), 30);
}

function closeUpload() {
  uploadDialog.hidden = true;
  document.body.style.overflow = '';
  uploadProgress.hidden = true;
  uploadRule.style.width = '0%';
  uploadPercent.textContent = '0%';
}

function previewLocalVideo(file) {
  if (!file) return;
  uploadProgress.hidden = false;
  const steps = [
    [16, 'Reading video'],
    [43, 'Finding swing motion'],
    [71, 'Preparing film room'],
    [100, 'Preview ready'],
  ];
  let step = 0;

  const advance = () => {
    const [percent, label] = steps[step];
    uploadPercent.textContent = `${percent}%`;
    uploadStatus.textContent = label;
    uploadRule.style.width = `${percent}%`;
    step += 1;

    if (step < steps.length) {
      window.setTimeout(advance, 360);
      return;
    }

    window.setTimeout(() => {
      if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
      localVideoUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = localVideoUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('aria-label', `Local preview: ${file.name}`);
      currentMedia.replaceWith(video);
      currentMedia = video;
      setText('#stage-session-label', `Local preview · ${file.name}`);
      setText('#breadcrumb-session', 'Local video preview');
      closeUpload();
      showToast('Local swing preview ready');
    }, 420);
  };

  advance();
}

let toastTimer;
function showToast(message) {
  $('span', toast).textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

stage.dataset.phase = String(activePhase);

phaseButtons.forEach((button) => button.addEventListener('click', () => {
  stopPlayback();
  setPhase(Number(button.dataset.phase));
}));

stagePlay.addEventListener('click', togglePlayback);
transportPlay.addEventListener('click', togglePlayback);

overlayToggle.addEventListener('click', () => {
  const isVisible = !overlay.classList.toggle('is-hidden');
  overlayToggle.classList.toggle('is-active', isVisible);
  overlayToggle.setAttribute('aria-pressed', String(isVisible));
});

$$('.session-card').forEach((card) => card.addEventListener('click', () => updateSession(card.dataset.session)));
$$('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
  askCoach(button.dataset.prompt);
  $('#coach-pane').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

coachForm.addEventListener('submit', (event) => {
  event.preventDefault();
  askCoach(coachInput.value);
});

coachInput.addEventListener('input', () => {
  coachInput.style.height = 'auto';
  coachInput.style.height = `${Math.min(coachInput.scrollHeight, 82)}px`;
});

coachInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    coachForm.requestSubmit();
  }
});

$$('[data-open-upload]').forEach((button) => button.addEventListener('click', openUpload));
$$('[data-close-upload]').forEach((button) => button.addEventListener('click', closeUpload));
videoFile.addEventListener('change', () => previewLocalVideo(videoFile.files[0]));

$('[data-focus-coach]').addEventListener('click', () => {
  $('#coach-pane').scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => coachInput.focus(), 450);
});

$('[data-scroll-sessions]').addEventListener('click', () => {
  if (window.innerWidth <= 1020) showToast('Use session history on a wider screen');
  else $('#sessions').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.addEventListener('keydown', (event) => {
  if (!uploadDialog.hidden && event.key === 'Escape') closeUpload();
  if (event.target.matches('textarea, input')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayback();
  }
  if (/^[1-4]$/.test(event.key)) {
    stopPlayback();
    setPhase(Number(event.key) - 1);
  }
});

window.addEventListener('beforeunload', () => {
  if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
});
