export function serializeCourseRows(rows) {
  return Array.from(rows).map((row) => ({
    courseKey: row.dataset.courseKey,
    name: row.dataset.name,
    lectureUrl: row.dataset.lectureUrl,
    enabled: row.querySelector('input').checked,
  }));
}

export function countEnabledCourses(rows) {
  return serializeCourseRows(rows).filter((course) => course.enabled).length;
}
