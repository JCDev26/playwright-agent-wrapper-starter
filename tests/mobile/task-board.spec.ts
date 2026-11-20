import { test, expect } from "../support/board";

test("a phone user can reach and complete a long task by touch", async ({ page }) => {
  const title = "Review" + "x".repeat(94);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Task" }).fill(title);
  await page.getByRole("button", { name: "Add task" }).tap();
  const checkbox = page.getByRole("checkbox", { name: title });
  await expect(checkbox).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await checkbox.tap();
  await expect(page.getByRole("status")).toHaveText("0 open tasks");
  await expect(checkbox).toBeChecked();
});
