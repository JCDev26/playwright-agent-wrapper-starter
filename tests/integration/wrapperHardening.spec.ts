import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { wrapperFixture } from "../support/wrapperFixture";

test("two overlapping requests in one checkout retain their own judgments and artifacts", async ({}, info) => {
  const fixture = wrapperFixture(info);
  for (const name of ["pass", "fail"]) {
    const other = name === "pass" ? "fail" : "pass";
    fixture.spec(name + ".spec.ts", `test("${name}", async () => {
      const fs = require("node:fs");
      fs.writeFileSync("${name}.ready", "");
      await expect.poll(() => fs.existsSync("${other}.ready"), { timeout: 15000 }).toBe(true);
      expect("${name}").toBe("pass");
    });`);
  }
  const outcomes = await Promise.all(["pass", "fail"].map(name => fixture.concurrentRequest("tests/smoke/" + name + ".spec.ts")));
  expect(outcomes.map(run => [run.exit, run.result.status])).toEqual([[0, "passed"], [1, "failed"]]);
  const roots = outcomes.map(({ result }) => path.posix.dirname(result.artifacts.testResultsJson!));
  expect(roots[0]).not.toBe(roots[1]);
  for (const [index, { result }] of outcomes.entries()) {
    const report = fixture.report(result);
    expect(report.stats.unexpected).toBe(index);
    expect(JSON.stringify(report.suites)).toContain(index ? "fail.spec.ts" : "pass.spec.ts");
    expect(result.artifacts.traceFiles.length).toBeGreaterThan(0);
    for (const file of [result.artifacts.testResultsXml!, result.artifacts.htmlReport!, ...result.artifacts.traceFiles]) {
      expect(file.startsWith(roots[index] + "/")).toBe(true);
      expect(fs.statSync(path.join(fixture.cwd, file)).isFile()).toBe(true);
    }
  }
});

test("real assertion failure has failing evidence, child 1 and CLI 1", ({}, info) => {
  const fixture = wrapperFixture(info);
  fixture.spec("fails.spec.ts", 'test("real failure", () => { expect(1).toBe(2); });');
  const { child, result } = fixture.request("tests/smoke/fails.spec.ts");
  expect(child.status).toBe(1);
  expect(result).toMatchObject({ ok: true, status: "failed", exitCode: 1 });
  expect(fixture.report(result).stats.unexpected).toBe(1);
});

test("no tests cannot reuse earlier passing or failing reports", ({}, info) => {
  const fixture = wrapperFixture(info);
  const passed = fixture.request("tests/smoke/example.spec.ts").result;
  expect(passed.status).toBe("passed");
  fixture.spec("fails.spec.ts", 'test("fails", () => { expect(1).toBe(2); });');
  const failed = fixture.request("tests/smoke/fails.spec.ts").result;
  expect(failed.status).toBe("failed");
  const oldBytes = fs.readFileSync(path.join(fixture.cwd, failed.artifacts.testResultsJson!));
  fs.writeFileSync(path.join(fixture.cwd, "artifacts", "test-results.json"), oldBytes);
  const { child, result } = fixture.request("tests/smoke/missing.spec.ts");
  expect(child.status).toBe(2);
  expect(result).toMatchObject({ ok: false, status: "execution_error", exitCode: 1,
    error: { code: "TEST_JUDGMENT_UNAVAILABLE" } });
  expect(result.summary.message).not.toContain("failing tests");
  expect(result.artifacts.testResultsJson).not.toBe(passed.artifacts.testResultsJson);
  expect(result.artifacts.testResultsJson).not.toBe(failed.artifacts.testResultsJson);
  expect(fixture.report(result).stats.unexpected).toBe(0);
  expect(fixture.report(result).errors.length).toBeGreaterThan(0);
  expect(fs.readFileSync(path.join(fixture.cwd, "artifacts", "test-results.json"))).toEqual(oldBytes);
});

test("literal metacharacter filename executes without selecting its regex lookalike", ({}, info) => {
  const fixture = wrapperFixture(info);
  fixture.spec("literal[1].spec.ts", 'test("literal passes", () => { expect(true).toBe(true); });');
  fixture.spec("literal1.spec.ts", 'test("wrong target fails", () => { expect(true).toBe(false); });');
  const { child, result } = fixture.request("tests/smoke/literal[1].spec.ts");
  expect(child.status).toBe(0);
  expect(result.status).toBe("passed");
  expect(fixture.report(result).stats.expected).toBe(1);
  expect(fixture.report(result).stats.unexpected).toBe(0);
});

test("literal selection does not inherit case-insensitive regex matching", ({}, info) => {
  test.skip(process.platform === "win32", "Windows filenames are case-insensitive.");
  const fixture = wrapperFixture(info);
  fixture.spec("EXAMPLE.spec.ts", 'test("wrong case fails", () => { expect(true).toBe(false); });');
  const { result } = fixture.request("tests/smoke/example.spec.ts");
  expect(result.status).toBe("passed");
  expect(fixture.report(result).stats.expected).toBe(1);
});

for (const spec of [
  "tests/smoke/not-present.spec.ts|example.spec.ts",
  "tests/smoke/.*.spec.ts",
  "tests/smoke/(example).spec.ts",
  "tests/smoke/example.spec.ts.spec.ts",
]) {
  test(`literal filter cannot broaden ${spec}`, ({}, info) => {
    const { child, result } = wrapperFixture(info).request(spec);
    expect(child.status).toBe(2);
    expect(result).toMatchObject({ status: "execution_error", exitCode: 1 });
  });
}

for (const mode of ["grep", "discovery", "configuration", "skipped"] as const) {
  test(`${mode} failure is not a failed test judgment`, ({}, info) => {
    const fixture = wrapperFixture(info);
    if (mode === "discovery") fixture.spec("example.spec.ts", 'throw new Error("cannot load tests");');
    if (mode === "configuration") fs.writeFileSync(path.join(fixture.cwd, "playwright.config.ts"), 'throw new Error("bad config");');
    if (mode === "skipped") fixture.spec("example.spec.ts", 'test.skip("never runs", () => {});');
    const { child, result } = fixture.request("tests/smoke/example.spec.ts", mode === "grep" ? ["--grep", "["] : []);
    expect(child.status).toBe(2);
    expect(result).toMatchObject({ ok: false, status: "execution_error",
      error: { code: "TEST_JUDGMENT_UNAVAILABLE" } });
    expect(result.exitCode).toBe(mode === "skipped" ? 0 : 1);
  });
}

test("real artifact ENOTDIR cannot erase validation rejection", ({}, info) => {
  const fixture = wrapperFixture(info);
  fs.mkdirSync(path.join(fixture.cwd, "artifacts"));
  fs.writeFileSync(path.join(fixture.cwd, "artifacts", "test-results"), "not a directory");
  const child = fixture.run(["--project", "ui"]);
  expect(child.status).toBe(2);
  expect(JSON.parse(child.stdout)).toMatchObject({ status: "validation_error",
    error: { code: "INVALID_PROJECT" }, artifacts: { traceFiles: [] } });
});

for (const args of [[], ["--project"], ["--project", "smoke", "--unknown"]]) {
  test(`CLI parser errors stay outside JSON contract: ${JSON.stringify(args)}`, ({}, info) => {
    const child = wrapperFixture(info).run(args);
    expect(child.status).toBe(2);
    expect(child.stdout).toBe("");
    expect(child.stderr.trim().length).toBeGreaterThan(0);
  });
}

test("native HTML, JUnit, trace and screenshot evidence stays isolated across browser runs", ({}, info) => {
  const fixture = wrapperFixture(info);
  fixture.spec("browser.spec.ts", `test('browser evidence', async ({ page }, info) => {
    await page.setContent('<h1>Local evidence fixture</h1>');
    await expect(page.getByRole('heading')).toHaveText('Local evidence fixture');
    await info.attach('page', { body: await page.screenshot(), contentType: 'image/png' });
  });`);
  const first = fixture.request("tests/smoke/browser.spec.ts").result;
  expect(first.status).toBe("passed");
  const old = [first.artifacts.htmlReport!, first.artifacts.testResultsXml!, ...first.artifacts.traceFiles]
    .map(file => ({ file, bytes: fs.readFileSync(path.join(fixture.cwd, file)) }));
  const second = fixture.request("tests/smoke/browser.spec.ts").result;
  expect(second.status).toBe("passed");
  expect(first.artifacts.htmlReport).not.toBe(second.artifacts.htmlReport);
  expect(first.artifacts.testResultsXml).not.toBe(second.artifacts.testResultsXml);
  for (const result of [first, second]) {
    const root = path.dirname(result.artifacts.testResultsJson!);
    expect(result.artifacts.traceFiles.length).toBeGreaterThan(0);
    const files = [result.artifacts.htmlReport!, result.artifacts.testResultsXml!, ...result.artifacts.traceFiles];
    for (const file of files) {
      expect(file.startsWith(root + "/")).toBe(true);
      expect(fs.statSync(path.join(fixture.cwd, file)).isFile()).toBe(true);
    }
    const report = fixture.report(result);
    const attachments: any[] = [];
    function visit(suite: any) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const attempt of test.results ?? []) attachments.push(...(attempt.attachments ?? []));
      for (const child of suite.suites ?? []) visit(child);
    }
    for (const suite of report.suites) visit(suite);
    expect(attachments.some(attachment => attachment.contentType === "image/png")).toBe(true);
  }
  for (const { file, bytes } of old) expect(fs.readFileSync(path.join(fixture.cwd, file))).toEqual(bytes);
});
