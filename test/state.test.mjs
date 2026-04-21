import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultState,
  enqueueAlarm,
  acknowledgeCurrentAlarm,
  getCurrentAlarm,
  shouldTriggerAlarm,
  markAlarmDetected,
} from '../src/state.mjs';

test('enqueueAlarm adds first alarm as current alarm', () => {
  const state = createDefaultState();
  const next = enqueueAlarm(state, {
    alarmId: 'a1',
    questionId: 'q1',
    kind: 'question',
    courseKey: 'course-1',
  });

  assert.deepEqual(next.activeAlarmQueue, ['a1']);
  assert.equal(getCurrentAlarm(next).alarmId, 'a1');
});

test('enqueueAlarm keeps queue order for multiple alarms', () => {
  let state = createDefaultState();
  state = enqueueAlarm(state, { alarmId: 'a1', questionId: 'q1', kind: 'question', courseKey: 'course-1' });
  state = enqueueAlarm(state, { alarmId: 'a2', questionId: 'q2', kind: 'question', courseKey: 'course-2' });

  assert.deepEqual(state.activeAlarmQueue, ['a1', 'a2']);
  assert.equal(getCurrentAlarm(state).alarmId, 'a1');
});

test('acknowledgeCurrentAlarm removes current alarm and marks question acknowledged', () => {
  let state = createDefaultState();
  state = enqueueAlarm(state, { alarmId: 'a1', questionId: 'q1', kind: 'question', courseKey: 'course-1' });
  state = enqueueAlarm(state, { alarmId: 'a2', questionId: 'q2', kind: 'question', courseKey: 'course-2' });

  const next = acknowledgeCurrentAlarm(state, '2026-04-16T00:00:00.000Z');

  assert.deepEqual(next.activeAlarmQueue, ['a2']);
  assert.equal(next.acknowledgedQuestionIds.q1, '2026-04-16T00:00:00.000Z');
  assert.equal(getCurrentAlarm(next).alarmId, 'a2');
});

test('shouldTriggerAlarm skips active and acknowledged questions', () => {
  let state = createDefaultState();
  state = enqueueAlarm(state, { alarmId: 'a1', questionId: 'q1', kind: 'question', courseKey: 'course-1' });
  state = markAlarmDetected(state, 'a1', '2026-04-16T00:00:00.000Z');

  assert.equal(shouldTriggerAlarm(state, 'q1'), false);

  state = acknowledgeCurrentAlarm(state, '2026-04-16T00:00:01.000Z');
  assert.equal(shouldTriggerAlarm(state, 'q1'), false);
  assert.equal(shouldTriggerAlarm(state, 'q2'), true);
});
