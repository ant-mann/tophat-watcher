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
  ],
};

test('start launches the watcher session headless in background mode', async () => {
  const launchCalls = [];
  const browserType = {
    async launchPersistentContext(profileDir, options) {
      launchCalls.push({ profileDir, options });
      return createFakeContext();
    },
  };

  const root = await mkdtemp(path.join('/tmp', 'tophat-background-'));
  const core = new TopHatWatcherCore({
    statePath: path.join(root, 'state.json'),
    profileDir: path.join(root, 'profile'),
    browserType,
    windowsBridge: { isSupported() { return false; } },
  });

  await core.start(settings);

  assert.equal(launchCalls.length, 1);
  assert.equal(launchCalls[0].options.headless, true);
  assert.equal(core.currentSessionMode, 'background');
  await core.stop();
});

test('promoteBackgroundSession relaunches the watcher visibly for question alarms', async () => {
  const launchCalls = [];
  const contexts = [createFakeContext(), createFakeContext()];
  const browserType = {
    async launchPersistentContext(profileDir, options) {
      launchCalls.push({ profileDir, options });
      const context = contexts.shift();
      if (!context) {
        throw new Error('no more fake contexts');
      }
      return context;
    },
  };

  const root = await mkdtemp(path.join('/tmp', 'tophat-background-'));
  const core = new TopHatWatcherCore({
    statePath: path.join(root, 'state.json'),
    profileDir: path.join(root, 'profile'),
    browserType,
    windowsBridge: { isSupported() { return false; } },
  });

  await core.start(settings);
  await core.promoteBackgroundSession(settings);

  assert.equal(launchCalls.length, 2);
  assert.equal(launchCalls[0].options.headless, true);
  assert.equal(launchCalls[1].options.headless, false);
  assert.equal(core.currentSessionMode, 'interactive');
  await core.stop();
});

function createFakeContext() {
  let currentUrl = 'about:blank';
  const context = {
    closed: false,
    pages() { return [page]; },
    async newPage() { return page; },
    async close() { this.closed = true; },
  };

  const page = {
    async waitForLoadState() {},
    async goto(url) { currentUrl = url; },
    async reload() {},
    url() { return currentUrl; },
    isClosed() { return false; },
    context() { return context; },
  };

  return context;
}
