import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { createPlatformSessionOpener } from './platform-browser.mjs';
import { createPlatformRuntime } from './platform-runtime.mjs';
import { focusAnswerInput } from './question-focus.mjs';
import {
  acknowledgeCurrentAlarm,
  createDefaultState,
  enqueueAlarm,
  getCurrentAlarm,
  markAlarmDetected,
  readState,
  shouldTriggerAlarm,
  updateState,
  writeState,
} from './state.mjs';

const questionLabelPattern = /(Unanswered|Answered|current: question|current: attendance)/gi;

export class TopHatWatcherCore {
  constructor({
    statePath,
    profileDir,
    browserType = chromium,
    onStatusChange = () => {},
    windowsBridge,
    sessionOpener,
    platformRuntime = createPlatformRuntime(),
  }) {
    this.statePath = statePath;
    this.profileDir = profileDir;
    this.browserType = browserType;
    this.onStatusChange = onStatusChange;
    this.platformRuntime = platformRuntime;
    this.sessionOpener = sessionOpener ?? createPlatformSessionOpener({
      browserType: this.browserType,
      windowsBridge,
    });
    this.activeSettings = null;
    this.context = null;
    this.browser = null;
    this.watchPage = null;
    this.loginContext = null;
    this.loginBrowser = null;
    this.watchCourses = [];
    this.currentSessionMode = 'idle';
    this.isPolling = false;
    this.sessionTransition = null;
    this.running = false;
    this.stopRequested = false;
    this.watchLoop = null;
    this.alarmLoop = null;
    this.runtime = {
      running: false,
      lastCheckAt: null,
      lastError: null,
      mode: 'idle',
    };
  }

  getRuntime() {
    return { ...this.runtime };
  }

  async startLogin(settings) {
    if (!this.loginContext) {
      const session = await this.openInteractiveSession(settings, settings.courses.find((course) => course.enabled)?.lectureUrl ?? 'https://app.tophat.com/e/');
      this.loginBrowser = session.browser;
      this.loginContext = session.context;
    }

    const page = this.loginContext.pages()[0] ?? (await this.loginContext.newPage());
    const destination = settings.courses.find((course) => course.enabled)?.lectureUrl ?? 'https://app.tophat.com/e/';
    await page.goto(destination, { waitUntil: 'domcontentloaded' });
    await page.bringToFront().catch(() => undefined);
    this.runtime.mode = 'login';
    this.onStatusChange(this.getRuntime());
    return { launched: true };
  }

  async discoverCourses(settings) {
    const context = await this.ensureInteractiveContext(settings);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://app.tophat.com/e/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const discovered = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => ({
          href: anchor.href,
          text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        }))
        .filter((item) => /app\.tophat\.com\/e\//i.test(item.href));
    });

    return normalizeDiscoveredCourses(discovered);
  }

  async start(settings) {
    if (this.running) {
      return;
    }

    const enabledCourses = settings.courses.filter((course) => course.enabled);
    if (enabledCourses.length === 0) {
      throw new Error('Choose at least one course before starting the watcher.');
    }

    this.stopRequested = false;
    this.activeSettings = settings;
    this.watchCourses = enabledCourses;
    await this.releaseLoginSession();
    const session = settings.watcher.backgroundOnStart
      ? await this.openBackgroundSession(settings)
      : await this.openInteractiveSession(settings, enabledCourses[0].lectureUrl);
    this.browser = session.browser;
    this.context = session.context;
    this.currentSessionMode = settings.watcher.backgroundOnStart ? 'background' : 'interactive';
    this.watchPage = await initializePollingPage(this.context, enabledCourses[0]?.lectureUrl);

    const state = await readState(this.statePath);
    if (!state.version) {
      await writeState(this.statePath, createDefaultState());
    }

    this.running = true;
    this.runtime = {
      ...this.runtime,
      running: true,
      mode: 'watching',
      lastError: null,
    };
    this.onStatusChange(this.getRuntime());

    this.watchLoop = this.runWatchLoop(settings, enabledCourses);
    this.alarmLoop = this.runAlarmLoop(settings);
  }

  async stop() {
    this.stopRequested = true;
    this.running = false;
    if (this.context) {
      const activeContext = this.context;
      const activeBrowser = this.browser;
      await this.closeBrowserHandle(this.browser, this.context);
      this.context = null;
      this.browser = null;
      if (this.loginContext === activeContext) {
        this.loginContext = null;
      }
      if (this.loginBrowser === activeBrowser) {
        this.loginBrowser = null;
      }
    }
    this.watchCourses = [];
    this.watchPage = null;
    this.activeSettings = null;
    this.currentSessionMode = 'idle';
    this.isPolling = false;
    this.sessionTransition = null;
    this.runtime = {
      ...this.runtime,
      running: false,
      mode: 'idle',
    };
    this.onStatusChange(this.getRuntime());
  }

  async acknowledgeActiveAlarm() {
    let currentAlarm = null;
    let nextAlarm = null;
    await updateState(this.statePath, (state) => {
      currentAlarm = getCurrentAlarm(state);
      if (!currentAlarm) {
        return state;
      }

      const next = acknowledgeCurrentAlarm(state, new Date().toISOString());
      nextAlarm = getCurrentAlarm(next);
      return next;
    });

    if (!currentAlarm) {
      return null;
    }

    if (this.running && this.activeSettings?.watcher.backgroundOnStart) {
      if (nextAlarm?.kind === 'question') {
        const nextCourse = this.findWatchedCourse(nextAlarm.courseKey);
        if (nextCourse) {
          await this.ensureInteractiveAlarmPage(this.activeSettings, nextCourse);
        }
      } else if (this.currentSessionMode === 'interactive') {
        await this.restoreBackgroundSession(this.activeSettings);
      }
    }

    return currentAlarm;
  }

  async testAlert() {
    await Promise.allSettled([
      this.platformRuntime.showNotification('Top Hat Companion test alert', 'Your notifications and sound are working.'),
      this.platformRuntime.playAlarmSound(),
    ]);
  }

  async closeLoginContext() {
    await this.releaseLoginSession();
    if (!this.running) {
      this.runtime = {
        ...this.runtime,
        mode: 'idle',
      };
      this.onStatusChange(this.getRuntime());
    }
  }

  async ensureInteractiveContext(settings) {
    if (this.context) {
      return this.context;
    }
    if (this.loginContext) {
      return this.loginContext;
    }
    const session = await this.openInteractiveSession(settings, settings.courses.find((course) => course.enabled)?.lectureUrl ?? 'https://app.tophat.com/e/');
    this.loginBrowser = session.browser;
    this.loginContext = session.context;
    this.runtime = {
      ...this.runtime,
      mode: 'login',
    };
    this.onStatusChange(this.getRuntime());
    return this.loginContext;
  }

  async openInteractiveSession(settings, url) {
    return this.sessionOpener.openInteractiveBrowserSession({
      profileDir: this.profileDir,
      url,
      browserChannel: settings.watcher.browserChannel,
    });
  }

  async releaseLoginSession() {
    if (!this.loginContext) {
      return;
    }

    const activeContext = this.loginContext;
    const activeBrowser = this.loginBrowser;
    await this.closeBrowserHandle(this.loginBrowser, this.loginContext);
    this.loginContext = null;
    this.loginBrowser = null;
    if (this.context === activeContext) {
      this.context = null;
    }
    if (this.browser === activeBrowser) {
      this.browser = null;
    }
  }

  async openBackgroundSession(settings) {
    return this.sessionOpener.openBackgroundBrowserSession({
      profileDir: this.profileDir,
      browserChannel: settings.watcher.browserChannel,
    });
  }

  async closeBrowserHandle(browser, context) {
    if (browser?.close) {
      await browser.close().catch(() => undefined);
      return;
    }
    await context?.close?.().catch(() => undefined);
  }

  async waitForSessionStable() {
    if (this.sessionTransition) {
      await this.sessionTransition;
    }
  }

  async waitForPollingToFinish() {
    while (this.isPolling) {
      await delay(50);
    }
  }

  async promoteBackgroundSession(settings, targetCourse = this.watchCourses[0]) {
    if (this.currentSessionMode !== 'background') {
      await this.waitForSessionStable();
      return;
    }

    if (this.sessionTransition) {
      await this.sessionTransition;
      return;
    }

    this.sessionTransition = (async () => {
      await this.waitForPollingToFinish();

      if (this.currentSessionMode !== 'background') {
        return;
      }

      const activeContext = this.context;
      const activeBrowser = this.browser;
      await this.closeBrowserHandle(activeBrowser, activeContext);
      this.context = null;
      this.browser = null;
      this.watchPage = null;

      const session = await this.openInteractiveSession(settings, targetCourse?.lectureUrl ?? 'https://app.tophat.com/e/');
      this.browser = session.browser;
      this.context = session.context;
      this.currentSessionMode = 'interactive';
      this.watchPage = await initializePollingPage(this.context, targetCourse?.lectureUrl);
    })();

    try {
      await this.sessionTransition;
    } finally {
      this.sessionTransition = null;
    }
  }

  async runWatchLoop(settings, courses) {
    while (!this.stopRequested) {
      await this.waitForSessionStable();
      if (this.currentSessionMode === 'interactive' && settings.watcher.backgroundOnStart) {
        await delay(500);
        continue;
      }

      for (const course of courses) {
        if (this.stopRequested) {
          break;
        }
        await this.waitForSessionStable();
        this.isPolling = true;
        try {
          this.watchPage = await pollCourse({
            page: this.watchPage,
            course,
            settings,
            statePath: this.statePath,
            shouldFocusImmediately: settings.watcher.focusMode === 'aggressive' && !settings.watcher.backgroundOnStart,
            onRuntimeUpdate: (patch) => {
              this.runtime = { ...this.runtime, ...patch };
              this.onStatusChange(this.getRuntime());
            },
          });
        } finally {
          this.isPolling = false;
        }
      }

      this.runtime = {
        ...this.runtime,
        lastCheckAt: new Date().toISOString(),
      };
      this.onStatusChange(this.getRuntime());
      await delay(settings.watcher.pollIntervalSeconds * 1000);
    }
  }

  async runAlarmLoop(settings) {
    while (!this.stopRequested) {
      await this.waitForSessionStable();
      const state = await readState(this.statePath);
      const currentAlarm = getCurrentAlarm(state);
      if (!currentAlarm) {
        await delay(1000);
        continue;
      }

      if (currentAlarm.kind === 'question' && this.currentSessionMode === 'background') {
        const targetCourse = this.findWatchedCourse(currentAlarm.courseKey);
        await this.promoteBackgroundSession(settings, targetCourse);
      } else if (currentAlarm.kind === 'question' && this.currentSessionMode === 'interactive') {
        const targetCourse = this.findWatchedCourse(currentAlarm.courseKey);
        if (targetCourse) {
          await this.ensureInteractiveAlarmPage(settings, targetCourse);
        }
      }

      await dispatchAlarm(this.watchPage, currentAlarm, {
        shouldFocus: settings.watcher.focusMode === 'aggressive',
        platformRuntime: this.platformRuntime,
      });
      await delay(settings.watcher.alarmRepeatSeconds * 1000);
    }
  }

  findWatchedCourse(courseKey) {
    return this.watchCourses.find((course) => course.courseKey === courseKey) ?? null;
  }

  async ensureInteractiveAlarmPage(settings, course) {
    if (this.currentSessionMode === 'background') {
      await this.promoteBackgroundSession(settings, course);
      return this.watchPage;
    }

    if (!this.watchPage) {
      this.watchPage = await initializePollingPage(this.context, course.lectureUrl);
      return this.watchPage;
    }

    this.watchPage = await ensureOnCoursePage(this.watchPage, course.lectureUrl);
    return this.watchPage;
  }

  async restoreBackgroundSession(settings) {
    if (this.currentSessionMode === 'background') {
      return;
    }

    if (this.sessionTransition) {
      await this.sessionTransition;
      return;
    }

    this.sessionTransition = (async () => {
      const activeContext = this.context;
      const activeBrowser = this.browser;
      await this.closeBrowserHandle(activeBrowser, activeContext);
      this.context = null;
      this.browser = null;
      this.watchPage = null;

      const session = await this.openBackgroundSession(settings);
      this.browser = session.browser;
      this.context = session.context;
      this.currentSessionMode = 'background';
      this.watchPage = await initializePollingPage(this.context, this.watchCourses[0]?.lectureUrl);
    })();

    try {
      await this.sessionTransition;
    } finally {
      this.sessionTransition = null;
    }
  }
}

export async function readAlertsSnapshot(statePath) {
  const state = await readState(statePath);
  const activeQueue = state.activeAlarmQueue
    .map((alarmId) => state.alarms[alarmId])
    .filter(Boolean)
    .map((alarm) => ({
      alarmId: alarm.alarmId,
      courseKey: alarm.courseKey,
      courseName: alarm.courseName,
      questionTitle: alarm.questionTitle,
      kind: alarm.kind,
      createdAt: alarm.createdAt,
    }));
  return {
    activeQueue,
    current: activeQueue[0] ?? null,
  };
}

export function normalizeDiscoveredCourses(discovered) {
  const unique = new Map();

  for (const item of discovered) {
    const match = item.href.match(
      /^https:\/\/app\.tophat\.com\/e\/([^/?#]+)(?:\/(?:lecture|content(?:\/course-work|\/my-course)?)?)?(?:[/?#].*)?$/i,
    );
    if (!match) {
      continue;
    }

    const courseKey = match[1];
    if (!unique.has(courseKey)) {
      unique.set(courseKey, {
        courseKey,
        name: item.text || `Top Hat Course ${courseKey}`,
        lectureUrl: `https://app.tophat.com/e/${courseKey}/lecture`,
        enabled: true,
      });
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function initializePollingPage(context, seedUrl) {
  await delay(1000);
  const page = context.pages()[0] ?? (await context.newPage());
  return seedUrl ? navigateWithRetry(page, seedUrl) : page;
}

async function pollCourse({ page, course, settings, statePath, shouldFocusImmediately, onRuntimeUpdate }) {
  let currentPage = page;

  try {
    currentPage = await ensureOnCoursePage(page, course.lectureUrl);

    if (await isLoginRequired(currentPage)) {
      await queueOperationalAlarm(statePath, {
        alarmId: `login:${course.courseKey}`,
        questionId: `login:${course.courseKey}`,
        kind: 'login-required',
        courseKey: course.courseKey,
        courseName: course.name,
        questionTitle: 'Top Hat login required',
        promptText: 'Please reconnect Top Hat so the companion can keep watching this course.',
        lectureUrl: course.lectureUrl,
      });
      onRuntimeUpdate({ lastError: null });
      return currentPage;
    }

    await clearResolvedOperationalAlarms(statePath, [`login:${course.courseKey}`, `selector:${course.courseKey}`]);

    const unansweredButtons = currentPage.locator('button').filter({ hasText: /Unanswered/i });
    const unansweredCount = await unansweredButtons.count();
    if (unansweredCount === 0) {
      onRuntimeUpdate({ lastError: null });
      return currentPage;
    }

    for (let index = 0; index < unansweredCount; index += 1) {
      if (index > 0) {
        currentPage = await navigateWithRetry(currentPage, course.lectureUrl);
      }
      const unansweredButton = unansweredButtons.nth(index);
      const buttonText = normalizeWhitespace(await unansweredButton.innerText());
      const questionTitle = extractQuestionTitle(buttonText);

      await unansweredButton.click();
      await currentPage.waitForLoadState('domcontentloaded');
      await currentPage.waitForTimeout(250);

      const promptText = await extractPromptText(currentPage);
      const questionSourceId = extractQuestionSourceId(currentPage, course.lectureUrl);
      const questionId = createQuestionId(course.courseKey, questionTitle, promptText, questionSourceId);
      let queuedAlarm = false;

      await updateState(statePath, (state) => {
        if (!shouldTriggerAlarm(state, questionId)) {
          const existingAlarmId = findAlarmIdByQuestionId(state, questionId);
          return existingAlarmId ? markAlarmDetected(state, existingAlarmId) : state;
        }

        queuedAlarm = true;
        return enqueueAlarm(state, {
          alarmId: `question:${questionId}`,
          questionId,
          kind: 'question',
          courseKey: course.courseKey,
          courseName: course.name,
          questionTitle,
          promptText,
          lectureUrl: course.lectureUrl,
          createdAt: new Date().toISOString(),
          lastDetectedAt: new Date().toISOString(),
        });
      });

      if (queuedAlarm) {
        if (shouldFocusImmediately) {
          await focusQuestion(currentPage, questionTitle);
        }
        onRuntimeUpdate({ lastError: null });
        return currentPage;
      }
    }

    onRuntimeUpdate({ lastError: null });
    return currentPage;
  } catch (error) {
    await queueOperationalAlarm(statePath, {
      alarmId: `selector:${course.courseKey}`,
      questionId: `selector:${course.courseKey}`,
      kind: 'selector-error',
      courseKey: course.courseKey,
      courseName: course.name,
      questionTitle: 'Companion needs attention',
      promptText: `The companion could not inspect ${course.name}. Reconnect Top Hat or refresh the page.`,
      lectureUrl: course.lectureUrl,
    });
    onRuntimeUpdate({ lastError: error.message });
    return currentPage;
  }
}

async function dispatchAlarm(page, alarm, { shouldFocus = true, platformRuntime } = {}) {
  if (page && shouldFocus) {
    try {
      await page.bringToFront();
      if (alarm.kind === 'question') {
        await focusQuestion(page, alarm.questionTitle);
      }
    } catch {
      // Leave notifications to do the heavy lifting even if focus fails.
    }
  }

  const title = alarm.kind === 'question' ? `Top Hat alert: ${alarm.courseName}` : 'Top Hat needs attention';
  const message = alarm.kind === 'question' ? `${alarm.questionTitle} is waiting for you.` : alarm.promptText;
  await Promise.allSettled([
    platformRuntime.showNotification(title, message),
    platformRuntime.playAlarmSound(),
  ]);
}

async function queueOperationalAlarm(statePath, alarm) {
  return updateState(statePath, (state) => {
    if (shouldTriggerAlarm(state, alarm.questionId)) {
      return enqueueAlarm(state, {
        ...alarm,
        createdAt: new Date().toISOString(),
        lastDetectedAt: new Date().toISOString(),
      });
    }

    const existingAlarmId = findAlarmIdByQuestionId(state, alarm.questionId);
    return existingAlarmId ? markAlarmDetected(state, existingAlarmId, new Date().toISOString()) : state;
  });
}

async function clearResolvedOperationalAlarms(statePath, questionIds) {
  return updateState(statePath, (state) => clearResolvedOperationalAlarmsFromState(state, questionIds));
}

function clearResolvedOperationalAlarmsFromState(state, questionIds) {
  let next = state;

  for (const questionId of questionIds) {
    const alarmId = findAlarmIdByQuestionId(next, questionId);
    if (!alarmId) {
      continue;
    }

    next = {
      ...next,
      activeAlarmQueue: next.activeAlarmQueue.filter((queuedAlarmId) => queuedAlarmId !== alarmId),
      alarms: { ...next.alarms },
      acknowledgedQuestionIds: { ...next.acknowledgedQuestionIds },
    };
    delete next.alarms[alarmId];
    delete next.acknowledgedQuestionIds[questionId];
  }

  return next;
}

async function ensureOnCoursePage(page, lectureUrl) {
  if (!page.url().startsWith(lectureUrl)) {
    return navigateWithRetry(page, lectureUrl);
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' });
    return page;
  }
}

async function navigateWithRetry(page, url, maxAttempts = 3) {
  let currentPage = page;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await currentPage.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined);
      await currentPage.goto(url, { waitUntil: 'domcontentloaded' });
      return currentPage;
    } catch (error) {
      const retryable = /ERR_ABORTED|frame was detached|Target closed/i.test(error.message);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      await delay(750);
      if (currentPage.isClosed()) {
        currentPage = await currentPage.context().newPage();
      }
    }
  }

  return currentPage;
}

async function isLoginRequired(page) {
  const url = page.url();
  if (/\/login|\/signin/i.test(url)) {
    return true;
  }

  const bodyText = normalizeWhitespace(await page.locator('body').innerText().catch(() => ''));
  return /sign in|log in/.test(bodyText) && !/Questions & Attendance/i.test(bodyText);
}

async function extractPromptText(page) {
  const promptCandidate = page.locator('form').first();
  const formCount = await promptCandidate.count();
  if (formCount === 0) {
    throw new Error('Could not find the Top Hat question form.');
  }

  const rawText = normalizeWhitespace(await promptCandidate.innerText());
  if (!rawText) {
    throw new Error('Question form was empty.');
  }

  return rawText.slice(0, 500);
}

async function focusQuestion(page, questionTitle) {
  await page.bringToFront();
  const questionButton = page.locator('button').filter({ hasText: questionTitle }).first();
  if ((await questionButton.count()) > 0) {
    await questionButton.click().catch(() => undefined);
  }

  await page.waitForTimeout(150).catch(() => undefined);
  await focusAnswerInput(page);
}

function extractQuestionTitle(buttonText) {
  const cleaned = buttonText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .map((line) => line.replace(questionLabelPattern, '').trim())
    .filter(Boolean);

  return cleaned[0] ?? 'Top Hat question';
}

function createQuestionId(courseKey, questionTitle, promptText, sourceId = '') {
  const parts = [courseKey, questionTitle, promptText];
  if (sourceId) {
    parts.push(sourceId);
  }
  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}

function extractQuestionSourceId(page, lectureUrl) {
  const url = page.url();
  return url && url !== lectureUrl ? url : '';
}

function findAlarmIdByQuestionId(state, questionId) {
  return Object.values(state.alarms).find((alarm) => alarm.questionId === questionId)?.alarmId ?? null;
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
