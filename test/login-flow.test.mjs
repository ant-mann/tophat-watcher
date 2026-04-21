import test from 'node:test';
import assert from 'node:assert/strict';
import { TopHatWatcherCore } from '../src/tophat-watcher-core.mjs';

test('startLogin reuses an existing login context by navigating its first page', async () => {
  const page = createFakePage();
  const loginContext = {
    pages() { return [page]; },
    async newPage() { throw new Error('should not create a new page'); },
  };

  const core = new TopHatWatcherCore({
    statePath: '/tmp/tophat-state.json',
    profileDir: '/tmp/tophat-profile',
    browserType: { launchPersistentContext() { throw new Error('should not relaunch browser'); } },
  });
  core.loginContext = loginContext;

  const result = await core.startLogin({
    watcher: { browserChannel: 'chrome' },
    courses: [{ enabled: true, lectureUrl: 'https://app.tophat.com/e/123/lecture' }],
  });

  assert.equal(result.launched, true);
  assert.equal(page.gotoCalls[0], 'https://app.tophat.com/e/123/lecture');
  assert.equal(page.bringToFrontCalls, 1);
});

test('startLogin uses the Windows browser bridge when available', async () => {
  const page = createFakePage();
  let bridgeCalls = 0;
  const core = new TopHatWatcherCore({
    statePath: '/tmp/tophat-state.json',
    profileDir: '/mnt/c/Users/chimn/AppData/Local/tophat-companion/profile',
    browserType: {
      launchPersistentContext() {
        throw new Error('should not launch Linux persistent context');
      },
    },
    windowsBridge: {
      isSupported() {
        return true;
      },
      async openSession() {
        bridgeCalls += 1;
        return {
          browser: { close: async () => undefined },
          context: {
            pages() { return [page]; },
            async newPage() { throw new Error('should not create a new page'); },
          },
        };
      },
    },
  });

  await core.startLogin({
    watcher: { browserChannel: 'chrome' },
    courses: [{ enabled: true, lectureUrl: 'https://app.tophat.com/e/456/lecture' }],
  });

  assert.equal(bridgeCalls, 1);
  assert.equal(page.gotoCalls[0], 'https://app.tophat.com/e/456/lecture');
  assert.equal(page.bringToFrontCalls, 1);
});

function createFakePage() {
  return {
    gotoCalls: [],
    bringToFrontCalls: 0,
    async goto(url) { this.gotoCalls.push(url); },
    async bringToFront() { this.bringToFrontCalls += 1; },
  };
}
