import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboardPath = '/mnt/c/Users/chimn/OneDrive/Desktop/tophat/public/index.html';

test('dashboard explains the lightweight background watcher flow', async () => {
  const html = await readFile(dashboardPath, 'utf8');

  assert.match(html, /single lightweight background watcher/i);
  assert.match(html, /checks your courses one at a time until something new appears\./i);
  assert.match(html, /When a question is detected/i);
  assert.match(html, /A repeating alert sound and desktop notification get your attention\./i);
  assert.match(html, /Top Hat opens only when needed and jumps to the course with the live question\./i);
  assert.match(html, /Nothing is typed or submitted automatically\./i);
});
