import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveCompanionPaths } from '../src/runtime-paths.mjs';

test('resolveCompanionPaths keeps repo-local data outside WSL', () => {
  const rootDir = '/workspace/tophat';
  const paths = resolveCompanionPaths({
    rootDir,
    env: { HOME: '/home/chimn' },
    forceWsl: false,
  });

  assert.equal(paths.settingsPath, path.join(rootDir, '.data', 'app-settings.json'));
  assert.equal(paths.profileDir, path.join(rootDir, '.profiles', 'tophat'));
});

test('resolveCompanionPaths keeps state in Linux home and browser profile on Windows under WSL', () => {
  const rootDir = '/mnt/c/Users/chimn/OneDrive/Desktop/tophat';
  const paths = resolveCompanionPaths({
    rootDir,
    env: {
      HOME: '/home/chimn',
      XDG_STATE_HOME: '/home/chimn/.local/state',
      XDG_CONFIG_HOME: '/home/chimn/.config',
    },
    forceWsl: true,
  });

  assert.equal(paths.settingsPath, '/home/chimn/.local/state/tophat-companion/app-settings.json');
  assert.equal(paths.statePath, '/home/chimn/.local/state/tophat-companion/tophat-state.json');
  assert.equal(paths.profileDir, '/mnt/c/Users/chimn/AppData/Local/tophat-companion/profile');
  assert.equal(paths.legacyConfigPath, path.join(rootDir, 'config', 'tophat.json'));
});
