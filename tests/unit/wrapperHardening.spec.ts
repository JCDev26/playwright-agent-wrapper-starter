import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { wrapperFixture } from "../support/wrapperFixture";

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
