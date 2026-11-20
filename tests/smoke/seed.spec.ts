import { test, expect } from "../support/board";

test("start with an empty task board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("0 open tasks");
  await expect(page.getByRole("button", { name: "Add task" })).toBeEnabled();
});
