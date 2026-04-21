import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadOrCreateSettings, updateSettings } from '../src/app-settings.mjs';

test('loadOrCreateSettings imports legacy config on first run', async () => {
  const root = await mkdtemp(path.join('/tmp', 'tophat-app-settings-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, '.data'), { recursive: true });
  await writeFile(
    path.join(root, 'config', 'tophat.json'),
    JSON.stringify({
      courses: [
        { name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture' },
        { name: 'Course B', lectureUrl: 'https://app.tophat.com/e/456/lecture' }
      ],
      backgroundOnStart: true,
      pollIntervalSeconds: 12,
      alarmRepeatSeconds: 6,
      browserChannel: 'chrome',
      focusMode: 'aggressive'
    }, null, 2)
  );

  const settings = await loadOrCreateSettings({
    settingsPath: path.join(root, '.data', 'app-settings.json'),
    legacyConfigPath: path.join(root, 'config', 'tophat.json'),
  });

  assert.equal(settings.courses.length, 2);
  assert.equal(settings.courses[0].enabled, true);
  assert.equal(settings.watcher.backgroundOnStart, true);
  assert.equal(settings.watcher.pollIntervalSeconds, 12);
  assert.equal(settings.auth.profileReady, false);
  assert.equal(settings.meta.importedLegacyConfig, true);
});

test('updateSettings persists nested settings changes', async () => {
  const root = await mkdtemp(path.join('/tmp', 'tophat-app-settings-'));
  const settingsPath = path.join(root, 'app-settings.json');
  const initial = {
    version: 1,
    meta: { importedLegacyConfig: false },
    auth: { profileReady: false, lastLoginCheckAt: null },
    watcher: {
      running: false,
      backgroundOnStart: true,
      pollIntervalSeconds: 10,
      alarmRepeatSeconds: 5,
      focusMode: 'aggressive',
      browserChannel: 'chrome',
      lastCheckAt: null,
      lastError: null,
    },
    alerts: { activeQueue: [], lastAcknowledgedAt: null },
    courses: [],
  };
  await writeFile(settingsPath, JSON.stringify(initial, null, 2));

  const next = await updateSettings(settingsPath, (current) => ({
    ...current,
    auth: { ...current.auth, profileReady: true },
    watcher: { ...current.watcher, running: true },
    alerts: { ...current.alerts, lastAcknowledgedAt: '2026-04-17T00:00:00.000Z' },
  }));

  assert.equal(next.auth.profileReady, true);
  assert.equal(next.watcher.backgroundOnStart, true);
  assert.equal(next.watcher.running, true);
  const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(saved.alerts.lastAcknowledgedAt, '2026-04-17T00:00:00.000Z');
});
