import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformRuntime, xmlEscape } from '../src/platform-runtime.mjs';

test('openExternalUrl uses open on macOS', async () => {
  const calls = [];
  const runtime = createPlatformRuntime({
    platform: 'darwin',
    execFileImpl: async (command, args) => { calls.push([command, args]); },
  });

  await runtime.openExternalUrl('http://127.0.0.1:3000');
  assert.deepEqual(calls, [['open', ['http://127.0.0.1:3000']]]);
});

test('openExternalUrl uses xdg-open on Linux', async () => {
  const calls = [];
  const runtime = createPlatformRuntime({
    platform: 'linux',
    execFileImpl: async (command, args) => { calls.push([command, args]); },
  });

  await runtime.openExternalUrl('http://127.0.0.1:3000');
  assert.deepEqual(calls, [['xdg-open', ['http://127.0.0.1:3000']]]);
});

test('showNotification uses osascript on macOS', async () => {
  const calls = [];
  const runtime = createPlatformRuntime({
    platform: 'darwin',
    execFileImpl: async (command, args) => { calls.push([command, args]); },
  });

  await runtime.showNotification('Top Hat', 'Question ready');
  assert.equal(calls[0][0], 'osascript');
  assert.match(calls[0][1][1], /display notification/);
});

test('playAlarmSound falls back to bell on Linux when sound tools fail', async () => {
  let bellCount = 0;
  const runtime = createPlatformRuntime({
    platform: 'linux',
    execFileImpl: async () => { throw new Error('missing'); },
    stdout: { write(value) { if (value === '\u0007') bellCount += 1; } },
  });

  await runtime.playAlarmSound();
  assert.equal(bellCount, 1);
});

test('xmlEscape escapes toast XML characters', () => {
  assert.equal(xmlEscape(`<&>\"'`), '&lt;&amp;&gt;&quot;&apos;');
});
