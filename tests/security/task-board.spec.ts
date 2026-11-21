import type { TestInfo } from "@playwright/test";
import { expect, test } from "../support/board";

// Record when the test reached the contract, so a setup or teardown error can be distinguished.
async function checkContract(info: TestInfo, id: string, observed: unknown, expected: unknown) {
  const record = (outcome: "passed" | "failed") =>
    info.attach("security-contract-v1", { body: id + ":" + outcome, contentType: "text/plain" });
  try { expect(observed, id).toStrictEqual(expected); }
  catch (error) {
    await record("failed");
    throw error;
  }
  await record("passed");
}

test("renders a markup-like title as literal text", async ({ page }, info) => {
  const title = "<em>Review notes</em>";
  await page.goto("/");
  await page.getByRole("textbox", { name: "Task", exact: true }).fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status")).toHaveText("1 open task");

  const item = page.getByRole("listitem");
  await checkContract(info, "literal-task-title", {
    text: await item.textContent(),
    emphasisElements: await item.locator("em").count(),
  }, { text: title, emphasisElements: 0 });
});

test("rejects an invalid completion value and preserves the task", async ({ request }, info) => {
  const title = "Review the checklist";
  const created = await request.post("/api/tasks", { data: { title }, maxRedirects: 0 });
  expect(created.status()).toBe(201);
  const original = await created.json();
  expect(original).toEqual({ id: expect.any(String), title, completed: false });

  const update = await request.patch("/api/tasks/" + encodeURIComponent(original.id), {
    data: { completed: "yes" }, maxRedirects: 0,
  });
  const list = await request.get("/api/tasks", { maxRedirects: 0 });
  await expect(list).toBeOK();
  await checkContract(info, "invalid-update-preserves-task", {
    responseStatus: update.status(), persisted: await list.json(),
  }, { responseStatus: 400, persisted: [original] });
});

test("instructs caches to avoid storing task list responses", async ({ request }, info) => {
  const response = await request.get("/api/tasks", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const directives = (response.headers()["cache-control"] ?? "").toLowerCase().split(",").map(value => value.trim());
  await checkContract(info, "task-api-no-store", directives.includes("no-store"), true);
});
