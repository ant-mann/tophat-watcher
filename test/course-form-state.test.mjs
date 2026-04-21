import test from 'node:test';
import assert from 'node:assert/strict';
import { countEnabledCourses, serializeCourseRows } from '../public/course-form-state.js';

test('serializeCourseRows builds the save payload from rendered course rows', () => {
  const rows = [
    createRow({ courseKey: '123', name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture', enabled: true }),
    createRow({ courseKey: '456', name: 'Course B', lectureUrl: 'https://app.tophat.com/e/456/lecture', enabled: false }),
  ];

  assert.deepEqual(serializeCourseRows(rows), [
    { courseKey: '123', name: 'Course A', lectureUrl: 'https://app.tophat.com/e/123/lecture', enabled: true },
    { courseKey: '456', name: 'Course B', lectureUrl: 'https://app.tophat.com/e/456/lecture', enabled: false },
  ]);
});

test('countEnabledCourses returns the number of enabled course rows', () => {
  const rows = [
    createRow({ enabled: true }),
    createRow({ enabled: false }),
    createRow({ enabled: true }),
  ];

  assert.equal(countEnabledCourses(rows), 2);
});

function createRow({ courseKey = '123', name = 'Course', lectureUrl = 'https://app.tophat.com/e/123/lecture', enabled = true } = {}) {
  return {
    dataset: { courseKey, name, lectureUrl },
    querySelector(selector) {
      if (selector !== 'input') {
        throw new Error(`unexpected selector ${selector}`);
      }
      return { checked: enabled };
    },
  };
}
