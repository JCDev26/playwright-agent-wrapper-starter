# Build and diagnose a test with Playwright Agents

Run the desktop smoke test once and open its trace. The [seed](../tests/smoke/seed.spec.ts) gives the agent a ready board with isolated data. The [reopen plan](../specs/reopen-task.md) defines the behavior a reviewer expects.

1. In your own checkout, initialize the definitions for your client. For Codex, run `npx playwright init-agents --loop=codex --project=smoke`. For VS Code, change the loop to `vscode`. Review the generated client files. Refresh them when upgrading Playwright.
2. Give the planner the seed and the requirement “Reopening one task leaves a second open task unchanged.” Ask for steps, expected counts and persistence after reload. Compare its assumptions with the plan.
3. Ask the generator to implement the approved scenario under `tests/smoke/`, import `test` and `expect` from `../support/board`, and use accessible names. Review its test diff, then invoke `node scripts/wrapper.cjs --project smoke --spec tests/smoke/<new-file>.spec.ts` with the actual filename.
4. Read the result’s `status`. For a failure, follow that invocation’s `artifacts.htmlReport` and trace. Playwright's ordinary CLI can open a trace with `npx playwright show-trace <trace.zip>`. The wrapper accepts reviewed target names and literal spec paths. CI executes the checked-in test deterministically.

## Rehearse a product regression

In a disposable checkout, edit the PATCH handler in `examples/task-board/server.ts`. Change `task.completed = completed;` to `task.completed = true;`. Run:

```sh
node scripts/wrapper.cjs --project smoke --spec tests/smoke/example.spec.ts --workers 1
```

Expect exit 1 and JSON containing `"ok": true` and `"status": "failed"`. Give the healer the plan and the failing trace. Ask which request first disagrees with the requirement, its response, and the smallest product correction. The reopen request sends `completed: false`. The faulty API returns `completed: true`, leaving the open count at zero. A longer timeout or changing the expected count would hide the defect. Restore the assignment and rerun the identical request. Compare the two invocation-specific reports.

[Official Playwright Test Agents guide](https://playwright.dev/docs/test-agents)
