import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: { taskJourneys: {
    executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: '15s',
    preAllocatedVUs: 5, maxVUs: 10,
  } },
  thresholds: {
    checks: ['rate==1'], http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250'], dropped_iterations: ['count==0'],
  },
};

const url = __ENV.TASK_BOARD_URL + '/api/tasks';
export default function () {
  const title = 'Task ' + __VU + '-' + __ITER;
  const created = http.post(url, JSON.stringify({ title }), { headers: { 'Content-Type': 'application/json' } });
  if (!check(created, { 'created a task': r => r.status === 201 && r.json('title') === title })) return;
  const id = created.json('id');
  try {
    check(http.get(url), { 'list contains this task': r => r.status === 200 && r.json().some(task => task.id === id) });
  } finally {
    check(http.del(url + '/' + id, null, { tags: { name: 'DELETE /api/tasks/:id' } }), {
      'deleted own task': r => r.status === 204,
    });
  }
}
