import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import {
  createDefaultState,
  enqueueAlarm,
  acknowledgeCurrentAlarm,
  getCurrentAlarm,
  shouldTriggerAlarm,
  markAlarmDetected,
  updateState,
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

test('shouldTriggerAlarm skips active questions and recently acknowledged duplicates', () => {
  let state = createDefaultState();
  state = enqueueAlarm(state, { alarmId: 'a1', questionId: 'q1', kind: 'question', courseKey: 'course-1' });
  state = markAlarmDetected(state, 'a1', '2026-04-16T00:00:00.000Z');

  assert.equal(shouldTriggerAlarm(state, 'q1', '2026-04-16T00:00:00.500Z'), false);

  state = acknowledgeCurrentAlarm(state, '2026-04-16T00:00:01.000Z');
  assert.equal(shouldTriggerAlarm(state, 'q1', '2026-04-16T00:02:00.000Z'), false);
  assert.equal(shouldTriggerAlarm(state, 'q2', '2026-04-16T00:02:00.000Z'), true);
});

test('shouldTriggerAlarm allows a repeated question after the acknowledgement silence window expires', () => {
  let state = createDefaultState();
  state = enqueueAlarm(state, { alarmId: 'a1', questionId: 'q1', kind: 'question', courseKey: 'course-1' });
  state = acknowledgeCurrentAlarm(state, '2026-04-16T00:00:00.000Z');

  assert.equal(shouldTriggerAlarm(state, 'q1', '2026-04-16T00:10:00.000Z'), true);
});

test('updateState serializes concurrent state changes', async () => {
  const root = await mkdtemp(path.join('/tmp', 'tophat-state-'));
  const statePath = path.join(root, 'state.json');
  let releaseFirstUpdate;

  const firstUpdate = updateState(statePath, async (state) => {
    await new Promise((resolve) => {
      releaseFirstUpdate = resolve;
    });
    return enqueueAlarm(state, { alarmId: 'a1', questionId: 'q1', kind: 'question', courseKey: 'course-1' });
  });

  const secondUpdate = updateState(statePath, (state) =>
    enqueueAlarm(state, { alarmId: 'a2', questionId: 'q2', kind: 'question', courseKey: 'course-2' }),
  );

  await waitFor(() => releaseFirstUpdate);
  releaseFirstUpdate();
  const [, next] = await Promise.all([firstUpdate, secondUpdate]);

  assert.deepEqual(next.activeAlarmQueue, ['a1', 'a2']);
});

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}
