import { countEnabledCourses, serializeCourseRows } from './course-form-state.js';

const state = {
  status: null,
  discoveredCourses: [],
};

let autoSaveTimer = null;
let autoSaveRequestId = 0;

const statusPill = document.querySelector('#statusPill');
const statusCards = document.querySelector('#statusCards');
const banner = document.querySelector('#banner');
const courseForm = document.querySelector('#courseForm');
const courseTemplate = document.querySelector('#courseRowTemplate');
const courseCount = document.querySelector('#courseCount');
const alertsList = document.querySelector('#alertsList');
const alertCount = document.querySelector('#alertCount');
const helperText = document.querySelector('#helperText');

const connectButton = document.querySelector('#connectButton');
const discoverButton = document.querySelector('#discoverButton');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const ackButton = document.querySelector('#ackButton');
const testAlertButton = document.querySelector('#testAlertButton');
const saveCoursesButton = document.querySelector('#saveCoursesButton');

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  await post('/api/login/start');
  helperText.textContent = 'A Top Hat browser window opened. Sign in there, then click Refresh Courses.';
  connectButton.disabled = false;
});

discoverButton.addEventListener('click', async () => {
  discoverButton.disabled = true;
  const response = await post('/api/courses/discover');
  state.discoveredCourses = response.courses;
  helperText.textContent = response.courses.length
    ? 'Pick the courses you want monitored. Changes save automatically.'
    : 'No courses were found yet. Finish signing into Top Hat, then try Refresh Courses again.';
  renderCourses();
  discoverButton.disabled = false;
  await refreshStatus();
});

courseForm.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains('course-toggle')) {
    return;
  }

  updateCourseCountFromForm();
  helperText.textContent = 'Saving course choices...';
  scheduleAutoSave();
});

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  const response = await post('/api/watcher/start');
  if (!response.ok) {
    helperText.textContent = response.error || 'The companion could not start watching yet.';
  } else {
    helperText.textContent = 'Watching is on. One lightweight background checker will cycle through your selected courses until it needs your attention.';
  }
  startButton.disabled = false;
  await refreshStatus();
});

stopButton.addEventListener('click', async () => {
  await post('/api/watcher/stop');
  helperText.textContent = 'Watching is off for now.';
  await refreshStatus();
});

ackButton.addEventListener('click', async () => {
  await post('/api/alerts/acknowledge');
  await refreshStatus();
});

testAlertButton.addEventListener('click', async () => {
  await post('/api/alerts/test');
  helperText.textContent = 'Test alert sent.';
});

async function refreshStatus() {
  const response = await fetch('/api/status');
  const payload = await response.json();
  state.status = payload.status;
  if (state.discoveredCourses.length === 0) {
    state.discoveredCourses = payload.status.courses;
  }
  render();
}

function render() {
  renderStatus();
  renderCourses();
  renderAlerts();
  renderBanner();
}

function renderStatus() {
  const { status } = state;
  const enabledCourses = status.courses.filter((course) => course.enabled).length;
  statusPill.textContent = status.watcher.running ? 'Watching' : status.auth.profileReady ? 'Ready' : 'Needs setup';
  statusPill.dataset.tone = status.watcher.running ? 'good' : status.auth.profileReady ? 'soft' : 'warning';

  const cards = [
    { label: 'Top Hat', value: status.auth.profileReady ? 'Signed in or ready' : 'Needs connection' },
    { label: 'Courses', value: `${enabledCourses} selected` },
    { label: 'Last check', value: formatTime(status.watcher.lastCheckAt) },
    { label: 'Alerts', value: `${status.alerts.activeQueue.length} active` },
  ];

  statusCards.innerHTML = cards
    .map((card) => `<article class="status-card"><span>${card.label}</span><strong>${card.value}</strong></article>`)
    .join('');

  startButton.disabled = !status.courses.some((course) => course.enabled) || status.watcher.running;
  stopButton.disabled = !status.watcher.running;
  ackButton.disabled = status.alerts.activeQueue.length === 0;
}

function renderCourses() {
  const courses = state.discoveredCourses.length ? state.discoveredCourses : state.status?.courses ?? [];
  courseForm.innerHTML = '';
  if (courses.length === 0) {
    courseForm.innerHTML = '<p class="empty-copy">No courses yet. Connect Top Hat, then refresh courses.</p>';
    courseCount.textContent = '0 selected';
    return;
  }

  const selected = courses.filter((course) => course.enabled !== false).length;
  courseCount.textContent = `${selected} selected`;

  for (const course of courses) {
    const fragment = courseTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.course-row');
    row.dataset.courseKey = course.courseKey;
    row.dataset.name = course.name;
    row.dataset.lectureUrl = course.lectureUrl;
    fragment.querySelector('.course-name').textContent = course.name;
    fragment.querySelector('.course-url').textContent = course.lectureUrl;
    fragment.querySelector('input').checked = course.enabled !== false;
    courseForm.appendChild(fragment);
  }

  updateCourseCountFromForm();
}

function renderAlerts() {
  const alerts = state.status?.alerts?.activeQueue ?? [];
  alertCount.textContent = `${alerts.length} active`;
  if (alerts.length === 0) {
    alertsList.className = 'alerts-list empty-state';
    alertsList.innerHTML = '<p>No active alerts right now.</p>';
    return;
  }

  alertsList.className = 'alerts-list';
  alertsList.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card ${alert.kind}">
          <span class="alert-kind">${prettyKind(alert.kind)}</span>
          <strong>${alert.questionTitle}</strong>
          <p>${alert.courseName}</p>
        </article>
      `
    )
    .join('');
}

function renderBanner() {
  const currentBanner = state.status?.banner;
  if (!currentBanner) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  banner.dataset.tone = currentBanner.tone;
  banner.innerHTML = `<strong>${currentBanner.title}</strong><p>${currentBanner.message}</p>`;
}

function prettyKind(kind) {
  if (kind === 'question') return 'Question';
  if (kind === 'login-required') return 'Reconnect';
  return 'Attention';
}

function formatTime(value) {
  if (!value) return 'Waiting for first check';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });
  return response.json();
}

function scheduleAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  autoSaveTimer = window.setTimeout(() => {
    saveCourseSelections().catch(() => {
      helperText.textContent = 'The companion could not save course choices just now.';
    });
  }, 250);
}

async function saveCourseSelections() {
  const requestId = ++autoSaveRequestId;
  const courses = serializeCourseRows(courseForm.querySelectorAll('.course-row'));
  const response = await post('/api/courses/save', { courses });
  if (!response.ok) {
    throw new Error(response.error || 'Could not save course choices.');
  }

  state.discoveredCourses = response.courses;
  if (requestId !== autoSaveRequestId) {
    return;
  }

  helperText.textContent = 'Course choices saved automatically.';
  await refreshStatus();
}

function updateCourseCountFromForm() {
  const rows = courseForm.querySelectorAll('.course-row');
  if (rows.length === 0) {
    courseCount.textContent = '0 selected';
    return;
  }

  courseCount.textContent = `${countEnabledCourses(rows)} selected`;
}

setInterval(() => {
  refreshStatus().catch(() => undefined);
}, 3000);

refreshStatus().catch(() => {
  helperText.textContent = 'The companion could not load its status yet.';
});

saveCoursesButton.hidden = true;
