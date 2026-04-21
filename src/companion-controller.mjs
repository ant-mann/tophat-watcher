import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrCreateSettings, updateSettings } from './app-settings.mjs';
import { createPlatformRuntime } from './platform-runtime.mjs';
import { resolveCompanionPaths } from './runtime-paths.mjs';
import { readAlertsSnapshot, TopHatWatcherCore } from './tophat-watcher-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const defaultPlatformRuntime = createPlatformRuntime();

export function createCompanionController(paths = {}) {
  const defaults = resolveCompanionPaths({ rootDir });
  const controller = new CompanionController({
    settingsPath: paths.settingsPath ?? defaults.settingsPath,
    legacyConfigPath: paths.legacyConfigPath ?? defaults.legacyConfigPath,
    statePath: paths.statePath ?? defaults.statePath,
    profileDir: paths.profileDir ?? defaults.profileDir,
    platformRuntime: paths.platformRuntime ?? defaultPlatformRuntime,
  });
  return controller;
}

class CompanionController {
  constructor(paths) {
    this.paths = paths;
    this.runtime = {
      running: false,
      lastCheckAt: null,
      lastError: null,
      mode: 'idle',
    };
    this.core = new TopHatWatcherCore({
      statePath: paths.statePath,
      profileDir: paths.profileDir,
      platformRuntime: paths.platformRuntime,
      onStatusChange: (runtime) => {
        this.runtime = runtime;
      },
    });
  }

  async init() {
    const settings = await loadOrCreateSettings({
      settingsPath: this.paths.settingsPath,
      legacyConfigPath: this.paths.legacyConfigPath,
    });

    const profileReady = await this.hasProfileData();
    await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      auth: {
        ...current.auth,
        profileReady,
      },
      meta: {
        ...current.meta,
        lastOpenedAt: new Date().toISOString(),
      },
    }));

    if (settings.watcher.running) {
      await this.startWatcher().catch((error) => {
        this.runtime = { ...this.runtime, lastError: error.message };
      });
    }
  }

  async getStatus() {
    const settings = await loadOrCreateSettings({
      settingsPath: this.paths.settingsPath,
      legacyConfigPath: this.paths.legacyConfigPath,
    });
    const alerts = await readAlertsSnapshot(this.paths.statePath);
    return {
      ...settings,
      auth: {
        ...settings.auth,
        profileReady: settings.auth.profileReady || (await this.hasProfileData()),
      },
      watcher: {
        ...settings.watcher,
        running: this.runtime.running || settings.watcher.running,
        lastCheckAt: this.runtime.lastCheckAt ?? settings.watcher.lastCheckAt,
        lastError: this.runtime.lastError ?? settings.watcher.lastError,
        mode: this.runtime.mode,
      },
      alerts: {
        ...settings.alerts,
        activeQueue: alerts.activeQueue,
      },
      banner: buildBanner({ runtime: this.runtime, alerts }),
      setupComplete: settings.auth.profileReady && settings.courses.some((course) => course.enabled),
    };
  }

  async startLogin() {
    const settings = await loadOrCreateSettings({
      settingsPath: this.paths.settingsPath,
      legacyConfigPath: this.paths.legacyConfigPath,
    });
    const result = await this.core.startLogin(settings);
    await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      auth: {
        ...current.auth,
        lastLoginCheckAt: new Date().toISOString(),
      },
    }));
    return result;
  }

  async discoverCourses() {
    const settings = await loadOrCreateSettings({
      settingsPath: this.paths.settingsPath,
      legacyConfigPath: this.paths.legacyConfigPath,
    });
    const discovered = await this.core.discoverCourses(settings);
    const profileReady = discovered.length > 0 || (await this.hasProfileData());
    await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      auth: {
        ...current.auth,
        profileReady,
        lastLoginCheckAt: new Date().toISOString(),
      },
    }));
    return discovered;
  }

  async saveCourses(courses) {
    const normalized = Array.isArray(courses)
      ? courses
          .map((course) => ({
            courseKey: String(course.courseKey ?? '').trim(),
            name: String(course.name ?? '').trim(),
            lectureUrl: String(course.lectureUrl ?? '').trim(),
            enabled: course.enabled !== false,
          }))
          .filter((course) => course.courseKey && course.name && course.lectureUrl)
      : [];

    const next = await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      courses: normalized,
    }));
    return next.courses;
  }

  async startWatcher() {
    const settings = await loadOrCreateSettings({
      settingsPath: this.paths.settingsPath,
      legacyConfigPath: this.paths.legacyConfigPath,
    });
    const next = await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      watcher: {
        ...current.watcher,
        running: true,
        lastError: null,
      },
    }));
    await this.core.start(next);
    return { started: true };
  }

  async stopWatcher() {
    await this.core.stop();
    await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      watcher: {
        ...current.watcher,
        running: false,
      },
    }));
    return { stopped: true };
  }

  async acknowledgeAlert() {
    const alarm = await this.core.acknowledgeActiveAlarm();
    await updateSettings(this.paths.settingsPath, (current) => ({
      ...current,
      alerts: {
        ...current.alerts,
        lastAcknowledgedAt: new Date().toISOString(),
      },
    }));
    return { acknowledged: Boolean(alarm) };
  }

  async testAlert() {
    await this.core.testAlert();
    return { tested: true };
  }

  async shutdown() {
    await this.core.stop();
    await this.core.closeLoginContext();
  }

  async hasProfileData() {
    try {
      await access(this.paths.profileDir);
      return true;
    } catch {
      return false;
    }
  }
}

export async function openExternal(url) {
  return defaultPlatformRuntime.openExternalUrl(url);
}

function buildBanner({ runtime, alerts }) {
  if (alerts.current?.kind === 'login-required') {
    return {
      tone: 'warning',
      title: 'Top Hat needs to reconnect',
      message: 'Your sign-in looks stale. Use Reconnect Top Hat, then refresh courses if needed.',
    };
  }

  if (alerts.current?.kind === 'selector-error' || runtime.lastError) {
    return {
      tone: 'warning',
      title: 'The companion needs attention',
      message: 'Something changed on Top Hat. Refresh courses or reconnect Top Hat to get back on track.',
    };
  }

  if (alerts.current?.kind === 'question') {
    return {
      tone: 'urgent',
      title: 'A question is waiting',
      message: `${alerts.current.questionTitle} is active right now.`,
    };
  }

  return null;
}
