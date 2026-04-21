import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer } from '../src/dashboard-server.mjs';

test('GET /api/status returns app status payload', async () => {
  const controller = createFakeController();
  const server = createDashboardServer({ controller, port: 0 });
  await server.start();

  try {
    const response = await fetch(`${server.origin}/api/status`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status.watcher.running, false);
    assert.equal(body.status.courses[0].name, 'Course A');
  } finally {
    await server.stop();
  }
});

test('POST /api/courses/save stores selected courses', async () => {
  const controller = createFakeController();
  const server = createDashboardServer({ controller, port: 0 });
  await server.start();

  try {
    const response = await fetch(`${server.origin}/api/courses/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        courses: [
          { courseKey: '123', name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture', enabled: true }
        ]
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(controller.savedCourses.length, 1);
    assert.equal(controller.savedCourses[0].enabled, true);
  } finally {
    await server.stop();
  }
});

function createFakeController() {
  return {
    savedCourses: [],
    async getStatus() {
      return {
        auth: { profileReady: false, lastLoginCheckAt: null },
        watcher: {
          running: false,
          pollIntervalSeconds: 10,
          alarmRepeatSeconds: 5,
          focusMode: 'aggressive',
          browserChannel: 'chrome',
          lastCheckAt: null,
          lastError: null,
        },
        alerts: { activeQueue: [], lastAcknowledgedAt: null },
        courses: [
          { courseKey: '123', name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture', enabled: true, health: 'idle' }
        ],
      };
    },
    async startLogin() { return { launched: true }; },
    async discoverCourses() { return []; },
    async saveCourses(courses) { this.savedCourses = courses; return { courses }; },
    async startWatcher() { return { started: true }; },
    async stopWatcher() { return { stopped: true }; },
    async acknowledgeAlert() { return { acknowledged: true }; },
    async testAlert() { return { tested: true }; },
  };
}
