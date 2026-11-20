import { test, expect } from "../support/board";

test("add and complete a review task @smoke", async ({ page }, info) => {
  await page.goto("/");
  await test.step("reject an empty task", async () => {
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter a task before adding it.");
    await expect(page.getByRole("listitem")).toHaveCount(0);
  });
  await test.step("add the task and update the count", async () => {
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("Review current-run evidence");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("alert")).toBeEmpty();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveText("1 open task");
  });
  await test.step("complete and reopen without duplicating the task", async () => {
    const task = page.getByRole("checkbox", { name: "Review current-run evidence" });
    await task.check();
    await expect(page.getByRole("status")).toHaveText("0 open tasks");
    await task.uncheck();
    await expect(page.getByRole("status")).toHaveText("1 open task");
    await task.check();
    await expect(task).toBeChecked();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveText("0 open tasks");
  });
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Review current-run evidence" })).toBeChecked();
  await info.attach("completed-task-board", { body: await page.screenshot(), contentType: "image/png" });
});
