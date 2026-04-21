import process from 'node:process';
import { createWindowsBrowserBridge } from './windows-browser.mjs';

export function createPlatformSessionOpener({
  browserType,
  platform = process.platform,
  windowsBridge = createWindowsBrowserBridge(),
} = {}) {
  return {
    async openInteractiveBrowserSession({ profileDir, url, browserChannel }) {
      if (windowsBridge?.isSupported?.()) {
        return windowsBridge.openSession({
          browserType,
          profileDir,
          browserChannel,
          url,
        });
      }

      return openDirectSession({ browserType, platform, profileDir, url, browserChannel, headless: false });
    },

    async openBackgroundBrowserSession({ profileDir, browserChannel }) {
      return openDirectSession({
        browserType,
        platform,
        profileDir,
        url: 'about:blank',
        browserChannel,
        headless: true,
      });
    },
  };
}

async function openDirectSession({ browserType, platform, profileDir, browserChannel, headless }) {
  try {
    return {
      browser: null,
      context: await browserType.launchPersistentContext(profileDir, {
        headless,
        channel: browserChannel,
      }),
    };
  } catch (error) {
    throw normalizeLaunchError(error, { platform, browserChannel });
  }
}

function normalizeLaunchError(error, { platform, browserChannel }) {
  if (
    platform === 'darwin'
    && browserChannel === 'chrome'
    && /failed to launch|executable doesn't exist|channel/i.test(error.message)
  ) {
    return new Error('Top Hat Companion needs Google Chrome installed on macOS to open Top Hat.', {
      cause: error,
    });
  }

  return error;
}
