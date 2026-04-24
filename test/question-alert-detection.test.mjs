import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { TopHatWatcherCore } from '../src/tophat-watcher-core.mjs';
import { createDefaultState } from '../src/state.mjs';

const course = {
  enabled: true,
  courseKey: '123',
  name: 'Course A',
  lectureUrl: 'https://app.tophat.com/e/123/lecture',
};

function createSettings(overrides = {}) {
  return {
    watcher: {
      backgroundOnStart: true,
      browserChannel: 'chrome',
      focusMode: 'soft',
      pollIntervalSeconds: 1,
      alarmRepeatSeconds: 1,
      ...overrides.watcher,
    },
    courses: [course],
  };
}

test('watcher keeps scanning unanswered questions after a recently acknowledged match', async () => {
  const root = await mkdtemp(path.join('/tmp', 'tophat-alert-scan-'));
  const statePath = path.join(root, 'state.json');
  const firstQuestionUrl = `${course.lectureUrl}/items/one`;
  const firstQuestionId = createQuestionId(course.courseKey, 'Question 1', 'Prompt one', firstQuestionUrl);
  await writeFile(
    statePath,
    JSON.stringify({
      ...createDefaultState(),
      acknowledgedQuestionIds: {
        [firstQuestionId]: new Date().toISOString(),
      },
    }),
    'utf8',
  );

  const page = createPollingPage([
    { buttonText: 'Unanswered\nQuestion 1', promptText: 'Prompt one', url: firstQuestionUrl },
    { buttonText: 'Unanswered\nQuestion 2', promptText: 'Prompt two', url: `${course.lectureUrl}/items/two` },
  ]);
  const core = createCore({ statePath, profileDir: path.join(root, 'profile'), page });

  await core.start(createSettings());
  await waitFor(() => page.formReads > 0);
  await core.stop();

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const queuedAlarms = state.activeAlarmQueue.map((alarmId) => state.alarms[alarmId]);
  assert.equal(queuedAlarms.length, 1);
  assert.equal(queuedAlarms[0].questionTitle, 'Question 2');
});

test('watcher polls when started in interactive mode', async () => {
  const root = await mkdtemp(path.join('/tmp', 'tophat-interactive-poll-'));
  const statePath = path.join(root, 'state.json');
  const page = createPollingPage([
    { buttonText: 'Unanswered\nQuestion 1', promptText: 'Prompt one', url: `${course.lectureUrl}/items/one` },
  ]);
  const core = createCore({ statePath, profileDir: path.join(root, 'profile'), page });

  await core.start(createSettings({ watcher: { backgroundOnStart: false } }));
  await waitFor(() => page.formReads > 0);
  await core.stop();

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const queuedAlarms = state.activeAlarmQueue.map((alarmId) => state.alarms[alarmId]);
  assert.equal(queuedAlarms.length, 1);
  assert.equal(queuedAlarms[0].questionTitle, 'Question 1');
});

test('watcher distinguishes repeated prompts when Top Hat exposes a different question URL', async () => {
  const root = await mkdtemp(path.join('/tmp', 'tophat-duplicate-prompt-'));
  const statePath = path.join(root, 'state.json');
  const oldQuestionUrl = `${course.lectureUrl}/items/old`;
  const newQuestionUrl = `${course.lectureUrl}/items/new`;
  const oldQuestionId = createQuestionId(course.courseKey, 'Warmup', 'Same prompt', oldQuestionUrl);
  await writeFile(
    statePath,
    JSON.stringify({
      ...createDefaultState(),
      acknowledgedQuestionIds: {
        [oldQuestionId]: new Date().toISOString(),
      },
    }),
    'utf8',
  );

  const page = createPollingPage([
    { buttonText: 'Unanswered\nWarmup', promptText: 'Same prompt', url: newQuestionUrl },
  ]);
  const core = createCore({ statePath, profileDir: path.join(root, 'profile'), page });

  await core.start(createSettings());
  await waitFor(() => page.formReads > 0);
  await core.stop();

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const queuedAlarms = state.activeAlarmQueue.map((alarmId) => state.alarms[alarmId]);
  assert.equal(queuedAlarms.length, 1);
  assert.equal(queuedAlarms[0].questionTitle, 'Warmup');
});

function createCore({ statePath, profileDir, page }) {
  const context = {
    pages() { return [page]; },
    async newPage() { return page; },
    async close() {},
  };

  return new TopHatWatcherCore({
    statePath,
    profileDir,
    sessionOpener: {
      async openBackgroundBrowserSession() {
        return { browser: null, context };
      },
      async openInteractiveBrowserSession() {
        return { browser: null, context };
      },
    },
    platformRuntime: {
      async showNotification() {},
      async playAlarmSound() {},
      async openExternalUrl() {},
    },
  });
}

function createPollingPage(questions) {
  let currentUrl = 'about:blank';
  let activeQuestion = null;
  const page = {
    formReads: 0,
    async waitForLoadState() {},
    async waitForTimeout() {},
    async goto(url) { currentUrl = url; },
    async reload() {},
    async bringToFront() {},
    url() { return currentUrl; },
    isClosed() { return false; },
    context() {
      return {
        async newPage() { return page; },
      };
    },
    locator(selector) {
      if (selector === 'body') {
        return createTextLocator('Questions & Attendance');
      }
      if (selector === 'form') {
        return createFormLocator(() => {
          page.formReads += 1;
          return activeQuestion?.promptText ?? '';
        });
      }
      if (selector === 'button') {
        return createButtonsLocator(questions, (question) => {
          activeQuestion = question;
          currentUrl = question.url ?? currentUrl;
        });
      }
      return createTextLocator('');
    },
  };

  return page;
}

function createButtonsLocator(questions, activate) {
  return {
    filter({ hasText }) {
      const matches = questions.filter((question) => hasText.test(question.buttonText));
      return createQuestionLocator(matches, activate);
    },
  };
}

function createQuestionLocator(questions, activate) {
  return {
    first() {
      return createQuestionLocator(questions.slice(0, 1), activate);
    },
    nth(index) {
      return createQuestionLocator(questions.slice(index, index + 1), activate);
    },
    async count() {
      return questions.length;
    },
    async innerText() {
      return questions[0]?.buttonText ?? '';
    },
    async click() {
      if (questions[0]) {
        activate(questions[0]);
      }
    },
  };
}

function createFormLocator(readText) {
  return {
    first() {
      return this;
    },
    async count() {
      return 1;
    },
    async innerText() {
      return readText();
    },
  };
}

function createTextLocator(text) {
  return {
    first() {
      return this;
    },
    async count() {
      return text ? 1 : 0;
    },
    async innerText() {
      return text;
    },
  };
}

function createQuestionId(courseKey, questionTitle, promptText, sourceId = '') {
  const parts = [courseKey, questionTitle, promptText];
  if (sourceId) {
    parts.push(sourceId);
  }
  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}
