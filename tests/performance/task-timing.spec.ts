import { test, expect } from "../support/board";
import { performanceContext } from "../support/performanceContext";
import policy from "../../agents/performance/policy.json";

test("measure task submission through the counter DOM update", { tag: "@task-submit-benchmark" }, async ({ page, browser, request }, info) => {
  for (let i = 0; i < policy.initialTasks; i++) {
    const created = await request.post("/api/tasks", { data: { title: "Existing task " + i } });
    await expect(created).toBeOK();
  }
  await page.goto("/");
  await expect(page.getByRole("listitem")).toHaveCount(policy.initialTasks);
  const samplesMs: number[] = [];
  for (let i = 0; i <= policy.sampleCount; i++) {
    await page.getByRole("textbox", { name: "Task" }).fill("Timing sample " + i);
    await page.getByRole("button", { name: "Add task" }).click();
    const open = policy.initialTasks + i + 1;
    await expect(page.getByRole("status")).toHaveText(open === 1 ? "1 open task" : open + " open tasks");
    const duration = await page.evaluate(() => performance.getEntriesByName("task-submit-to-dom", "measure").at(-1)?.duration);
    expect(duration).toBeDefined();
    if (i > 0) samplesMs.push(duration!);
  }
  const sorted = samplesMs.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const observation = {
    ...performanceContext(browser.browserType().name()),
    initialTasks: policy.initialTasks,
    metric: "task-submit-to-dom", unit: "ms", samplesMs, medianMs,
    browser: browser.version(), platform: process.platform, project: info.project.name,
    conditions: "Loopback API, one warm-up, same page and context, no tracing.",
  };
  await info.attach("task-timing.json", { body: JSON.stringify(observation, null, 2), contentType: "application/json" });
  if (process.env.TASK_MEDIAN_BUDGET_MS !== undefined) {
    const budget = Number(process.env.TASK_MEDIAN_BUDGET_MS);
    expect(Number.isFinite(budget) && budget > 0, "Set a positive finite median budget in milliseconds").toBe(true);
    expect(medianMs, "Median submit-to-DOM duration in ms").toBeLessThanOrEqual(budget);
  }
});
