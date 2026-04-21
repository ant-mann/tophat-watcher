import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformSessionOpener } from '../src/platform-browser.mjs';

test('interactive sessions use the Windows bridge when available', async () => {
  let bridgeCalls = 0;
  const opener = createPlatformSessionOpener({
    browserType: { async launchPersistentContext() { throw new Error('should not launch directly'); } },
    windowsBridge: {
      isSupported() { return true; },
      async openSession(options) {
        bridgeCalls += 1;
        return { browser: { close: async () => undefined }, context: { pages() { return []; }, newPage: async () => ({}) }, options };
      },
    },
  });

  await opener.openInteractiveBrowserSession({
    profileDir: '/tmp/profile',
    url: 'https://app.tophat.com/e/',
    browserChannel: 'chrome',
  });

  assert.equal(bridgeCalls, 1);
});

test('macOS launch errors explain that Chrome is required', async () => {
  const opener = createPlatformSessionOpener({
    platform: 'darwin',
    browserType: {
      async launchPersistentContext() {
        throw new Error('browserType.launchPersistentContext: Failed to launch, channel "chrome" not found');
      },
    },
    windowsBridge: { isSupported() { return false; } },
  });

  await assert.rejects(
    () => opener.openInteractiveBrowserSession({ profileDir: '/tmp/profile', url: 'https://app.tophat.com/e/', browserChannel: 'chrome' }),
    /needs Google Chrome installed on macOS/,
  );
});

test('background sessions launch headless without the Windows bridge', async () => {
  const launches = [];
  const opener = createPlatformSessionOpener({
    platform: 'linux',
    browserType: {
      async launchPersistentContext(profileDir, options) {
        launches.push({ profileDir, options });
        return { pages() { return []; }, newPage: async () => ({}) };
      },
    },
    windowsBridge: { isSupported() { return false; } },
  });

  await opener.openBackgroundBrowserSession({ profileDir: '/tmp/profile', browserChannel: 'chrome' });
  assert.equal(launches[0].options.headless, true);
});
