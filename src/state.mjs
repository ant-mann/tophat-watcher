import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ACKNOWLEDGED_SILENCE_WINDOW_MS = 5 * 60 * 1000;
const stateUpdateQueues = new Map();

export function createDefaultState() {
  return {
    version: 1,
    activeAlarmQueue: [],
    alarms: {},
    acknowledgedQuestionIds: {},
  };
}

export function getCurrentAlarm(state) {
  const currentAlarmId = state.activeAlarmQueue[0];
  return currentAlarmId ? state.alarms[currentAlarmId] ?? null : null;
}

export function shouldTriggerAlarm(state, questionId, now = new Date().toISOString()) {
  const acknowledgedAt = state.acknowledgedQuestionIds[questionId];
  if (acknowledgedAt && !hasAcknowledgementExpired(acknowledgedAt, now)) {
    return false;
  }

  return !state.activeAlarmQueue.some((alarmId) => state.alarms[alarmId]?.questionId === questionId);
}

export function enqueueAlarm(state, alarm) {
  const next = cloneState(state);
  next.alarms[alarm.alarmId] = {
    ...alarm,
    createdAt: alarm.createdAt ?? new Date().toISOString(),
    lastDetectedAt: alarm.lastDetectedAt ?? new Date().toISOString(),
  };

  if (!next.activeAlarmQueue.includes(alarm.alarmId)) {
    next.activeAlarmQueue.push(alarm.alarmId);
  }

  return next;
}

export function markAlarmDetected(state, alarmId, detectedAt = new Date().toISOString()) {
  const next = cloneState(state);
  if (next.alarms[alarmId]) {
    next.alarms[alarmId] = {
      ...next.alarms[alarmId],
      lastDetectedAt: detectedAt,
    };
  }
  return next;
}

export function acknowledgeCurrentAlarm(state, acknowledgedAt = new Date().toISOString()) {
  const next = cloneState(state);
  const currentAlarm = getCurrentAlarm(next);
  if (!currentAlarm) {
    return next;
  }

  next.activeAlarmQueue = next.activeAlarmQueue.slice(1);
  delete next.alarms[currentAlarm.alarmId];

  if (currentAlarm.questionId) {
    next.acknowledgedQuestionIds[currentAlarm.questionId] = acknowledgedAt;
  }

  return next;
}

export async function readState(statePath) {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    const normalizedAcknowledged = normalizeAcknowledgedQuestionIds(
      parsed.acknowledgedQuestionIds && typeof parsed.acknowledgedQuestionIds === 'object'
        ? parsed.acknowledgedQuestionIds
        : {},
    );
    return {
      ...createDefaultState(),
      ...parsed,
      activeAlarmQueue: Array.isArray(parsed.activeAlarmQueue) ? parsed.activeAlarmQueue : [],
      alarms: parsed.alarms && typeof parsed.alarms === 'object' ? parsed.alarms : {},
      acknowledgedQuestionIds: normalizedAcknowledged,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createDefaultState();
    }
    throw error;
  }
}

export async function writeState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

export function updateState(statePath, updater) {
  const previousUpdate = stateUpdateQueues.get(statePath) ?? Promise.resolve();
  const update = previousUpdate
    .catch(() => undefined)
    .then(async () => {
      const current = await readState(statePath);
      const next = await updater(current);
      await writeState(statePath, next);
      return next;
    });
  const trackedUpdate = update.catch(() => undefined);
  stateUpdateQueues.set(statePath, trackedUpdate);
  trackedUpdate.finally(() => {
    if (stateUpdateQueues.get(statePath) === trackedUpdate) {
      stateUpdateQueues.delete(statePath);
    }
  });
  return update;
}

function cloneState(state) {
  return {
    ...state,
    activeAlarmQueue: [...state.activeAlarmQueue],
    alarms: { ...state.alarms },
    acknowledgedQuestionIds: { ...state.acknowledgedQuestionIds },
  };
}

function normalizeAcknowledgedQuestionIds(acknowledgedQuestionIds, now = new Date().toISOString()) {
  return Object.fromEntries(
    Object.entries(acknowledgedQuestionIds).filter(([, acknowledgedAt]) => !hasAcknowledgementExpired(acknowledgedAt, now)),
  );
}

function hasAcknowledgementExpired(acknowledgedAt, now) {
  const acknowledgedTime = Date.parse(acknowledgedAt);
  const nowTime = Date.parse(now);
  if (Number.isNaN(acknowledgedTime) || Number.isNaN(nowTime)) {
    return false;
  }

  return nowTime - acknowledgedTime >= ACKNOWLEDGED_SILENCE_WINDOW_MS;
}
