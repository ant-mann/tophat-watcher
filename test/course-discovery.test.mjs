import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiscoveredCourses } from '../src/tophat-watcher-core.mjs';

test('normalizeDiscoveredCourses accepts bare Top Hat course lobby links', () => {
  const courses = normalizeDiscoveredCourses([
    { href: 'https://app.tophat.com/e/891719', text: 'Gary\'s Machine organization and Programming - Spring 2026' },
    { href: 'https://app.tophat.com/e/936525', text: 'Data Science Programming II' },
  ]);

  assert.deepEqual(courses, [
    {
      courseKey: '936525',
      name: 'Data Science Programming II',
      lectureUrl: 'https://app.tophat.com/e/936525/lecture',
      enabled: true,
    },
    {
      courseKey: '891719',
      name: "Gary's Machine organization and Programming - Spring 2026",
      lectureUrl: 'https://app.tophat.com/e/891719/lecture',
      enabled: true,
    },
  ]);
});

test('normalizeDiscoveredCourses deduplicates lecture and content URLs for the same course', () => {
  const courses = normalizeDiscoveredCourses([
    { href: 'https://app.tophat.com/e/891719/lecture', text: 'Machine Org' },
    { href: 'https://app.tophat.com/e/891719/content/course-work', text: 'Machine Org' },
    { href: 'https://app.tophat.com/e/891719', text: 'Machine Org' },
    { href: 'https://app.tophat.com/e/', text: 'Lobby' },
  ]);

  assert.equal(courses.length, 1);
  assert.equal(courses[0].courseKey, '891719');
  assert.equal(courses[0].lectureUrl, 'https://app.tophat.com/e/891719/lecture');
});
