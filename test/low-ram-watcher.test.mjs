import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { TopHatWatcherCore } from '../src/tophat-watcher-core.mjs';

const settings = {
  watcher: {
    backgroundOnStart: true,
    browserChannel: 'chrome',
    focusMode: 'aggressive',
    pollIntervalSeconds: 10,
    alarmRepeatSeconds: 5,
  },
  courses: [
    { enabled: true, courseKey: '123', name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture' },
    { enabled: true, courseKey: '456', name: 'Course B', lectureUrl: 'https://app.tophat.com/e/456/lecture' },
  ],
};

test('start reuses a single polling page across multiple enabled courses in background mode', async () => {
  const backgroundContext = createFakeContext();
  const root = await mkdtemp(path.join('/tmp', 'tophat-low-ram-'));
  const core = new TopHatWatcherCore({
    statePath: path.join(root, 'state.json'),
    profileDir: path.join(root, 'profile'),
    sessionOpener: {
      async openBackgroundBrowserSession() {
        return { browser: null, context: backgroundContext };
      },
      async openInteractiveBrowserSession() {
        throw new Error('should not open an interactive session');
      },
    },
  });

  await core.start(settings);

  assert.equal(backgroundContext.newPageCalls, 0);
  await core.stop();
});

test('promoteBackgroundSession opens the alerted course when switching to interactive mode', async () => {
  const backgroundContext = createFakeContext();
  const interactiveContext = createFakeContext();
  const interactiveUrls = [];
  const root = await mkdtemp(path.join('/tmp', 'tophat-low-ram-'));
  const core = new TopHatWatcherCore({
    statePath: path.join(root, 'state.json'),
    profileDir: path.join(root, 'profile'),
    sessionOpener: {
      async openBackgroundBrowserSession() {
        return { browser: null, context: backgroundContext };
      },
      async openInteractiveBrowserSession(options) {
        interactiveUrls.push(options.url);
        return { browser: null, context: interactiveContext };
      },
    },
  });

  await core.start(settings);
  await core.promoteBackgroundSession(settings, settings.courses[1]);

  assert.deepEqual(interactiveUrls, ['https://app.tophat.com/e/456/lecture']);
  await core.stop();
});

function createFakeContext() {
  let currentUrl = 'about:blank';
  const context = {
    closed: false,
    newPageCalls: 0,
    pages() { return [page]; },
    async newPage() {
      this.newPageCalls += 1;
      return page;
    },
    async close() { this.closed = true; },
  };

  const page = {
    gotoCalls: [],
    async waitForLoadState() {},
    async goto(url) { currentUrl = url; this.gotoCalls.push(url); },
    async reload() {},
    url() { return currentUrl; },
    isClosed() { return false; },
    context() { return context; },
  };

  return context;
}
