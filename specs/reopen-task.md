# Reopen a completed task

Start with the empty board from `tests/smoke/seed.spec.ts`. Use the local board fixture. Each test owns its HTTP server and task data.

| Step | Expected user-visible result |
|---|---|
| Add “Review current-run evidence”. | One task appears and the counter reads “1 open task”. |
| Complete the task. | The checkbox is checked and the counter reads “0 open tasks”. |
| Reopen the task. | The checkbox is unchecked, the counter returns to “1 open task”, and the list still has one item. |
| Complete the task again and reload the page. | The same task remains checked. |

The reference implementation is `tests/smoke/example.spec.ts`. To extend the plan, add a second task and verify that changing the first leaves the second open. Use the same specification on both mobile projects.
