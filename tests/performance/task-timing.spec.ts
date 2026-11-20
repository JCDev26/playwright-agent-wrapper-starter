import { test, expect } from "../support/board";

test("measure task submission through the counter DOM update", async ({ page, browser }, info) => {
  await page.goto("/");
  const samplesMs: number[] = [];
  for (let i = 0; i <= 10; i++) {
    await page.getByRole("textbox", { name: "Task" }).fill("Timing sample " + i);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("status")).toHaveText(i === 0 ? "1 open task" : (i + 1) + " open tasks");
    const duration = await page.evaluate(() => performance.getEntriesByName("task-submit-to-dom", "measure").at(-1)?.duration);
    expect(duration).toBeDefined();
    if (i > 0) samplesMs.push(duration!);
  }
  const sorted = samplesMs.slice().sort((a, b) => a - b);
  const medianMs = (sorted[4] + sorted[5]) / 2;
  const observation = {
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
