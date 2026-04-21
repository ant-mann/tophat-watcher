import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export function shouldTriggerAlarm(state, questionId) {
  if (state.acknowledgedQuestionIds[questionId]) {
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
    return {
      ...createDefaultState(),
      ...parsed,
      activeAlarmQueue: Array.isArray(parsed.activeAlarmQueue) ? parsed.activeAlarmQueue : [],
      alarms: parsed.alarms && typeof parsed.alarms === 'object' ? parsed.alarms : {},
      acknowledgedQuestionIds:
        parsed.acknowledgedQuestionIds && typeof parsed.acknowledgedQuestionIds === 'object'
          ? parsed.acknowledgedQuestionIds
          : {},
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

function cloneState(state) {
  return {
    ...state,
    activeAlarmQueue: [...state.activeAlarmQueue],
    alarms: { ...state.alarms },
    acknowledgedQuestionIds: { ...state.acknowledgedQuestionIds },
  };
}
