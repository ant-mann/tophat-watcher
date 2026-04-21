import { readFile } from 'node:fs/promises';

const TOPHAT_LECTURE_URL = /^https:\/\/app\.tophat\.com\/e\/([^/]+)\/lecture(?:[/?#].*)?$/i;

export async function loadConfig(configPath) {
  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Config must be a JSON object.');
  }

  if (!Array.isArray(parsed.courses) || parsed.courses.length === 0) {
    throw new Error('Config must include a non-empty courses array.');
  }

  const courses = parsed.courses.map((course, index) => normalizeCourse(course, index));

  return {
    courses,
    pollIntervalSeconds: normalizePositiveInteger(parsed.pollIntervalSeconds, 10, 'pollIntervalSeconds'),
    alarmRepeatSeconds: normalizePositiveInteger(parsed.alarmRepeatSeconds, 5, 'alarmRepeatSeconds'),
    browserChannel: normalizeBrowserChannel(parsed.browserChannel),
    focusMode: normalizeFocusMode(parsed.focusMode),
  };
}

function normalizeCourse(course, index) {
  if (!course || typeof course !== 'object') {
    throw new Error(`courses[${index}] must be an object.`);
  }

  const name = String(course.name ?? '').trim();
  const lectureUrl = String(course.lectureUrl ?? '').trim();
  const match = lectureUrl.match(TOPHAT_LECTURE_URL);

  if (!name) {
    throw new Error(`courses[${index}].name must be a non-empty string.`);
  }

  if (!match) {
    throw new Error(`courses[${index}].lectureUrl must be a Top Hat lecture URL.`);
  }

  return {
    name,
    lectureUrl,
    courseKey: match[1],
  };
}

function normalizePositiveInteger(value, fallback, fieldName) {
  if (value == null) {
    return fallback;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return normalized;
}

function normalizeBrowserChannel(value) {
  if (value == null) {
    return 'chrome';
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error('browserChannel must be a non-empty string.');
  }

  return normalized;
}

function normalizeFocusMode(value) {
  if (value == null) {
    return 'aggressive';
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error('focusMode must be a non-empty string.');
  }

  return normalized;
}
