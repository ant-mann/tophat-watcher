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

test('start closes an existing login session before launching the watcher session', async () => {
  const launches = [];
  const browserType = {
    async launchPersistentContext(profileDir, options) {
      launches.push({ profileDir, options });
      return createFakeContext();
    },
  };

  const loginBrowser = {
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
    },
  };

  const loginContext = createFakeContext();
  let loginContextCloseCalls = 0;
  loginContext.close = async () => {
    loginContextCloseCalls += 1;
    loginContext.closed = true;
  };

  const root = await mkdtemp(path.join('/tmp', 'tophat-session-'));
  const core = new TopHatWatcherCore({
    statePath: path.join(root, 'state.json'),
    profileDir: path.join(root, 'profile'),
    browserType,
    windowsBridge: { isSupported() { return false; } },
  });

  core.loginBrowser = loginBrowser;
  core.loginContext = loginContext;

  await core.start(settings);

  assert.equal(loginBrowser.closeCalls, 1);
  assert.equal(loginContextCloseCalls, 0);
  assert.equal(core.loginContext, null);
  assert.equal(core.loginBrowser, null);
  assert.equal(launches.length, 1);

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
