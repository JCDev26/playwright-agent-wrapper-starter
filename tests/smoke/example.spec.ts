import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("add and complete a review task @smoke", async ({ page }, info) => {
  // Serve only the local fixture, with every other network request aborted.
  await page.route("**/*", route => route.request().url() === "https://demo.invalid/"
    ? route.fulfill({ contentType: "text/html", body: fs.readFileSync(path.join(__dirname, "../fixtures/task-board.html"), "utf8") })
    : route.abort("blockedbyclient"));
  await page.goto("https://demo.invalid/");
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
  await info.attach("completed-task-board", { body: await page.screenshot(), contentType: "image/png" });
});
