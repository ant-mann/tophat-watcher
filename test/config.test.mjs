import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';

test('loadConfig validates course array and defaults', async () => {
  const dir = await mkdtemp(path.join('/tmp', 'tophat-config-'));
  const file = path.join(dir, 'tophat.json');
  await writeFile(
    file,
    JSON.stringify({
      courses: [
        { name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture' },
        { name: 'Course B', lectureUrl: 'https://app.tophat.com/e/456/lecture' }
      ]
    }, null, 2),
    'utf8'
  );

  const config = await loadConfig(file);

  assert.equal(config.pollIntervalSeconds, 10);
  assert.equal(config.alarmRepeatSeconds, 5);
  assert.equal(config.focusMode, 'aggressive');
  assert.equal(config.courses[1].courseKey, '456');
});

test('loadConfig rejects invalid lecture urls', async () => {
  const dir = await mkdtemp(path.join('/tmp', 'tophat-config-'));
  const file = path.join(dir, 'tophat.json');
  await writeFile(
    file,
    JSON.stringify({
      courses: [{ name: 'Broken', lectureUrl: 'https://example.com/nope' }]
    }, null, 2),
    'utf8'
  );

  await assert.rejects(() => loadConfig(file), /lectureUrl/);
});
