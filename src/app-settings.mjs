import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.mjs';

export function createDefaultSettings() {
  return {
    version: 1,
    meta: {
      importedLegacyConfig: false,
      firstLaunchedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    },
    auth: {
      profileReady: false,
      lastLoginCheckAt: null,
    },
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
    alerts: {
      activeQueue: [],
      lastAcknowledgedAt: null,
    },
    courses: [],
  };
}

export async function loadOrCreateSettings({ settingsPath, legacyConfigPath }) {
  const existing = await readJson(settingsPath);
  if (existing) {
    const normalized = normalizeSettings(existing);
    await persistSettings(settingsPath, normalized);
    return normalized;
  }

  const defaults = createDefaultSettings();
  const imported = await importLegacyConfig(legacyConfigPath);
  const settings = imported ? normalizeSettings({ ...defaults, ...imported }) : defaults;
  await persistSettings(settingsPath, settings);
  return settings;
}

export async function updateSettings(settingsPath, updater) {
  const current = normalizeSettings((await readJson(settingsPath)) ?? createDefaultSettings());
  const next = normalizeSettings(await updater(current));
  await persistSettings(settingsPath, next);
  return next;
}

export function normalizeSettings(settings) {
  const defaults = createDefaultSettings();
  const watcher = { ...defaults.watcher, ...(settings?.watcher ?? {}) };
  const auth = { ...defaults.auth, ...(settings?.auth ?? {}) };
  const meta = { ...defaults.meta, ...(settings?.meta ?? {}) };
  const alerts = {
    ...defaults.alerts,
    ...(settings?.alerts ?? {}),
    activeQueue: Array.isArray(settings?.alerts?.activeQueue) ? settings.alerts.activeQueue : [],
  };

  const courses = Array.isArray(settings?.courses)
    ? settings.courses
        .filter((course) => course && typeof course === 'object')
        .map((course) => ({
          courseKey: String(course.courseKey ?? '').trim(),
          name: String(course.name ?? '').trim(),
          lectureUrl: String(course.lectureUrl ?? '').trim(),
          enabled: course.enabled !== false,
        }))
        .filter((course) => course.courseKey && course.name && course.lectureUrl)
    : [];

  return {
    version: 1,
    meta,
    auth,
    watcher: {
      running: Boolean(watcher.running),
      backgroundOnStart: watcher.backgroundOnStart !== false,
      pollIntervalSeconds: positiveInteger(watcher.pollIntervalSeconds, defaults.watcher.pollIntervalSeconds),
      alarmRepeatSeconds: positiveInteger(watcher.alarmRepeatSeconds, defaults.watcher.alarmRepeatSeconds),
      focusMode: watcher.focusMode || defaults.watcher.focusMode,
      browserChannel: watcher.browserChannel || defaults.watcher.browserChannel,
      lastCheckAt: watcher.lastCheckAt ?? null,
      lastError: watcher.lastError ?? null,
    },
    alerts: {
      activeQueue: alerts.activeQueue,
      lastAcknowledgedAt: alerts.lastAcknowledgedAt ?? null,
    },
    courses,
  };
}

async function importLegacyConfig(legacyConfigPath) {
  try {
    await access(legacyConfigPath);
  } catch {
    return null;
  }

  const legacy = await loadConfig(legacyConfigPath);
  return {
    meta: {
      importedLegacyConfig: true,
      firstLaunchedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    },
    watcher: {
      running: false,
      backgroundOnStart: true,
      pollIntervalSeconds: legacy.pollIntervalSeconds,
      alarmRepeatSeconds: legacy.alarmRepeatSeconds,
      focusMode: legacy.focusMode,
      browserChannel: legacy.browserChannel,
      lastCheckAt: null,
      lastError: null,
    },
    courses: legacy.courses.map((course) => ({
      courseKey: course.courseKey,
      name: course.name,
      lectureUrl: course.lectureUrl,
      enabled: true,
    })),
  };
}

async function persistSettings(settingsPath, settings) {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function positiveInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}
