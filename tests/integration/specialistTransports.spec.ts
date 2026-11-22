import { expect, test, type TestInfo } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const specialists = [
  { lane: "security", action: "assess-security" },
  { lane: "reporting", action: "summarize-evidence" },
  { lane: "contrarian", action: "review-verdict" },
] as const;
type Lane = (typeof specialists)[number]["lane"];

function checkout(info: TestInfo) {
  const root = info.outputPath("checkout");
  fs.mkdirSync(root, { recursive: true });
  for (const entry of ["agents", "src", "scripts", ".gitignore", "package.json"]) {
    fs.cpSync(path.resolve(entry), path.join(root, entry), { recursive: true });
  }
  fs.symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "junction");
  return root;
}

test.afterEach(({}, info) => {
  // Keep test artifacts portable. The fixture borrows the installation only while it runs.
  const modules = info.outputPath("checkout", "node_modules");
  if (fs.lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(modules);
});

function argv(root: string, lane: Lane) {
  return ["--import", "tsx", path.join(root, "src", "playwright-wrapper", lane, "cli.ts")];
}

function invoke(root: string, lane: Lane, input: string, flags: string[] = [], env = getDefaultEnvironment()) {
  const child = spawnSync(process.execPath, [...argv(root, lane), ...flags], {
    cwd: root, input, env, encoding: "utf8", timeout: 45_000,
  });
  if (child.error) throw child.error;
  expect(child.stdout.trim(), child.stderr).not.toBe("");
  return { status: child.status, finding: JSON.parse(child.stdout), stdout: child.stdout };
}

async function withClient(root: string, lane: Lane, env: Record<string, string>, run: (client: Client) => Promise<void>) {
  const client = new Client({ name: "independent-client", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [...argv(root, lane), "--mcp"], cwd: root, env }));
    await run(client);
  } finally {
    await client.close();
  }
}

async function callFinding(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content;
  if (!Array.isArray(blocks) || blocks.length !== 1 || blocks[0].type !== "text")
    throw new Error("Expected one machine-readable finding from MCP.");
  return { isError: result.isError, finding: JSON.parse(blocks[0].text) };
}

function evidenceSnapshot(root: string) {
  const directory = path.join(root, "artifacts");
  return fs.readdirSync(directory, { recursive: true, encoding: "utf8" }).sort().map(relative => {
    const file = path.join(directory, relative);
    const digest = fs.statSync(file).isFile() ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
    return { path: relative, digest };
  });
}

for (const { lane, action } of specialists) {
  test(`${lane} enforces its single action through JSON stdio and MCP`, async ({}, info) => {
    const root = checkout(info);
    const valid = JSON.stringify({ name: action, arguments: {} });
    const ungranted = invoke(root, lane, valid);
    expect(ungranted).toMatchObject({ status: 2, finding: { status: "denied", reason: expect.any(String) } });

    const badRequests = [
      { input: JSON.stringify({ name: action, arguments: {}, jobId: randomUUID() }) },
      { input: JSON.stringify({ name: action, arguments: null }) },
      { input: valid.slice(0, -1) },
      { input: " ".repeat(1024) + valid },
      { input: valid, flags: ["--project=smoke"] },
    ];
    for (const { input, flags } of badRequests) {
      const result = invoke(root, lane, input, flags);
      expect(result).toMatchObject({ status: 2, finding: { status: "denied" } });
      expect(result.finding.reason).not.toBe(ungranted.finding.reason);
    }

    await withClient(root, lane, getDefaultEnvironment(), async client => {
      const tools = (await client.listTools()).tools;
      expect(tools.map(tool => tool.name)).toEqual([action]);
      expect(tools[0].inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tools[0].inputSchema.properties).toEqual({});
      for (const call of [
        ...specialists.filter(role => role.action !== action).map(role => ({ name: role.action, arguments: {} })),
        { name: "assess-performance", arguments: {} },
        { name: "publish-report", arguments: {} },
        { name: action, arguments: { project: "smoke" } },
        { name: action, arguments: { rerun: true } },
        { name: action, arguments: { advance: true } },
        { name: action, arguments: { env: { PW_AGENT_JOB_ID: randomUUID() } } },
        { name: action, arguments: {} },
      ]) {
        const { finding, isError } = await callFinding(client, call.name, call.arguments);
        expect(isError).toBe(true);
        expect(finding).toMatchObject({ status: "denied", reason: expect.any(String) });
        if (call.name === action && Object.keys(call.arguments).length === 0)
          expect(finding).toEqual(ungranted.finding);
        else expect(finding.reason).not.toBe(ungranted.finding.reason);
      }
    });
    expect(fs.existsSync(path.join(root, "artifacts"))).toBe(false);
  });
}

test("a clean job runs security once and gates the reported verdict against independent evidence", async ({}, info) => {
  test.setTimeout(120_000);
  const root = checkout(info);
  for (const entry of ["package-lock.json", "playwright.config.ts", "tests/security", "tests/performance",
    "tests/support/board.ts", "tests/support/performanceContext.ts", "examples/task-board"]) {
    fs.cpSync(path.resolve(entry), path.join(root, entry), { recursive: true });
  }
  for (const project of ["unit", "integration", "smoke"]) {
    const dir = path.join(root, "tests", project);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "example.spec.ts"), [
      'import { test, expect } from "@playwright/test";',
      'test("sample check", () => {',
      '  test.fail(process.env.SAMPLE_RESULT === "unexpected-pass", "Fixture annotation");',
      '  expect(process.env.SAMPLE_RESULT).not.toBe("planned-failure");',
      '});',
      'if (process.env.SAMPLE_RESULT === "unplanned-failure")',
      '  test("only registered during execution", () => expect(1).toBe(2));',
    ].join("\n"));
  }
  const baseEnv = getDefaultEnvironment();
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) baseEnv.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const options = { cwd: root, encoding: "utf8" as const, env: baseEnv };
  execFileSync("git", ["init", "--quiet", "--template="], options);
  execFileSync("git", ["config", "core.autocrlf", "false"], options);
  execFileSync("git", ["add", "--all"], options);
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false",
    "-c", "core.hooksPath=.git/hooks", "commit", "--quiet", "-m", "Isolated transport fixture"], options);

  function runHost(args: string[], env = baseEnv) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/agent-job.ts", ...args], {
      ...options, env, timeout: 15_000,
    });
    if (child.error) throw child.error;
    return child;
  }
  function host(args: string[], env = baseEnv): Record<string, string> {
    const child = runHost(args, env);
    expect(child.status, child.stderr).toBe(0);
    return JSON.parse(child.stdout);
  }
  function planJob(): Record<string, string> {
    const grant = { ...baseEnv, ...host(["init"]) };
    const plan = execFileSync(process.execPath, ["--import", "tsx", "scripts/review-plan.ts"], {
      ...options, env: grant, timeout: 30_000,
    });
    return { ...grant, ...JSON.parse(plan), PW_AGENT_PRODUCER_PLATFORM: process.platform };
  }
  type SuiteMode = "pass" | "planned-failure" | "unplanned-failure" | "unexpected-pass";
  function captureSuite(folder: string, grant: Record<string, string>, mode: SuiteMode) {
    const projects = mode === "pass" ? ["unit", "integration", "smoke", "mobile-android", "mobile-ios"] : ["unit"];
    const cli = path.join(root, "node_modules", "playwright", "cli.js");
    const suite = spawnSync(process.execPath, [cli, "test", "--reporter=json", "--workers=1", ...projects.map(p => "--project=" + p)], {
      ...options, env: { ...baseEnv, SAMPLE_RESULT: mode, PW_EVIDENCE_JOB_ID: grant.PW_AGENT_JOB_ID,
        PW_EVIDENCE_REVISION: grant.PW_AGENT_REVISION, PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(folder, "suite.json") },
      timeout: 40_000,
    });
    if (suite.error) throw suite.error;
    expect(suite.status, suite.stderr).toBe(mode === "pass" ? 0 : 1);
  }

  const artifacts = path.join(root, "artifacts");
  const elsewhere = info.outputPath("outside-checkout");
  fs.mkdirSync(artifacts);
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(artifacts, "reporting"), "junction");
  expect(runHost(["init"]).status).toBe(2);
  expect(fs.readdirSync(elsewhere)).toEqual([]);
  fs.unlinkSync(path.join(artifacts, "reporting"));

  const grant = planJob();
  const folder = path.join(root, "artifacts", "reporting", grant.PW_AGENT_JOB_ID);
  const securityRequest = '{"name":"assess-security","arguments":{}}';
  const reportRequest = '{"name":"summarize-evidence","arguments":{}}';
  const reviewRequest = '{"name":"review-verdict","arguments":{}}';
  const checked = invoke(root, "security", securityRequest, [], grant);
  expect(checked).toMatchObject({ status: 0, finding: { status: "checks_passed", nativeStatus: "passed" } });
  const nativeFile = path.join(root, checked.finding.report.path);
  expect(createHash("sha256").update(fs.readFileSync(nativeFile)).digest("hex")).toBe(checked.finding.report.sha256);
  fs.writeFileSync(path.join(folder, "security.json"), checked.stdout);
  const afterCheck = evidenceSnapshot(root);
  await withClient(root, "security", grant, async client => {
    expect(await callFinding(client, "assess-security", {})).toMatchObject({ isError: true, finding: { status: "denied" } });
  });
  expect(evidenceSnapshot(root)).toEqual(afterCheck);

  captureSuite(folder, grant, "pass");
  const enrollment = execFileSync(process.execPath, ["scripts/wrapper.cjs", "--project", "performance", "--spec",
    "tests/performance/task-timing.spec.ts", "--workers", "1"], {
    ...options, env: grant, timeout: 45_000, stdio: ["ignore", "pipe", "pipe"],
  });
  fs.writeFileSync(path.join(folder, "enrollment-receipt.json"), enrollment);
  const sealed = { ...grant, ...host(["seal", "not-scheduled", "0"], grant) };
  const beforeReport = evidenceSnapshot(root);
  expect(runHost(["seal", "required", "1"], grant).status).toBe(2);
  const report = invoke(root, "reporting", reportRequest, [], sealed);
  expect(report, JSON.stringify(report.finding)).toMatchObject({ status: 0, finding: { status: "passed" } });
  await withClient(root, "reporting", sealed, async client => {
    expect(await callFinding(client, "summarize-evidence", {})).toEqual({ isError: false, finding: report.finding });
  });
  expect(evidenceSnapshot(root)).toEqual(beforeReport);

  fs.writeFileSync(path.join(folder, "summary.json"), report.stdout);
  const reviewer = { ...sealed, ...host(["review-inputs", "initial-enrollment"], sealed), PW_AGENT_UPSTREAM_RESULT: "success" };
  const beforeReview = evidenceSnapshot(root);
  function qualityReview(env: Record<string, string>, expectedCode: number) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "src/playwright-wrapper/swarm/cli.ts", "review"],
      { ...options, env, timeout: 15_000 });
    expect(child.status, child.stderr).toBe(expectedCode);
    return JSON.parse(child.stdout);
  }
  const approval = invoke(root, "contrarian", reviewRequest, [], reviewer);
  expect(qualityReview(reviewer, 0).verdict).toEqual(approval.finding);
  const session = spawnSync(process.execPath, ["--import", "tsx", "src/playwright-wrapper/swarm/cli.ts", "session"],
    { ...options, env: reviewer, input: "save reporting\nresume reporting\nquit\n", timeout: 15_000 });
  expect(session.status, session.stderr).toBe(0);
  expect(session.stderr).toBe("");
  expect(session.stdout).toContain('"evidenceChanged": false');
  expect(approval, JSON.stringify(approval.finding)).toMatchObject({
    status: 0, finding: { status: "approved", advance: true, reportedStatus: "passed", confirmedFailures: [] },
  });
  await withClient(root, "contrarian", reviewer, async client => {
    expect(await callFinding(client, "review-verdict", {})).toEqual({ isError: false, finding: approval.finding });
  });
  const redPipeline = { ...reviewer, PW_AGENT_UPSTREAM_RESULT: "failure" };
  const unexplained = invoke(root, "contrarian", reviewRequest, [], redPipeline);
  expect(qualityReview(redPipeline, 2).verdict).toEqual(unexplained.finding);
  expect(unexplained).toMatchObject({
    status: 2, finding: { status: "needs_review", advance: false, reportedStatus: "passed", confirmedFailures: [] },
  });
  expect(unexplained.finding.challenges.length).toBeGreaterThan(0);
  for (const binding of ["PW_AGENT_REVIEW_PLAN_SHA256", "PW_AGENT_PRODUCER_PLATFORM"]) {
    const incomplete: Record<string, string> = { ...reviewer };
    delete incomplete[binding];
    expect(invoke(root, "contrarian", reviewRequest, [], incomplete), binding)
      .toMatchObject({ status: 2, finding: { status: "needs_review", advance: false, confirmedFailures: [] } });
  }
  expect(evidenceSnapshot(root)).toEqual(beforeReview);

  // A host can pin the exact bytes of a mistaken report. The native evidence still governs.
  const mistaken = JSON.stringify({ ...report.finding, status: "failed" }) + "\n";
  fs.writeFileSync(path.join(folder, "summary.json"), mistaken);
  const submitted = { ...reviewer, PW_AGENT_REVIEW_SUMMARY_SHA256: createHash("sha256").update(mistaken).digest("hex") };
  expect(invoke(root, "contrarian", reviewRequest, [], submitted)).toMatchObject({
    status: 2, finding: { status: "needs_review", advance: false, reportedStatus: "failed", confirmedFailures: [],
      challenges: expect.arrayContaining(["summary_disagrees_with_evidence", "reported_failure_unconfirmed"]) },
  });
  fs.writeFileSync(path.join(folder, "summary.json"), report.stdout);

  fs.appendFileSync(path.join(folder, "suite.json"), " ");
  expect(invoke(root, "reporting", reportRequest, [], sealed))
    .toMatchObject({ status: 2, finding: { status: "inconclusive", suite: { status: "invalid" } } });
  expect(invoke(root, "contrarian", reviewRequest, [], reviewer))
    .toMatchObject({ status: 2, finding: { status: "needs_review", advance: false, confirmedFailures: [] } });

  function failedJob(mode: Exclude<SuiteMode, "pass">): Record<string, string> {
    const job = planJob();
    const folder = path.join(artifacts, "reporting", job.PW_AGENT_JOB_ID);
    captureSuite(folder, job, mode);
    const sealed = { ...job, ...host(["seal", "required", "1"], job) };
    const report = invoke(root, "reporting", reportRequest, [], sealed);
    expect(report).toMatchObject({ status: 1, finding: { status: "failed", security: { status: "missing" } } });
    fs.writeFileSync(path.join(folder, "summary.json"), report.stdout);
    return { ...sealed, ...host(["review-inputs", "required"], sealed), PW_AGENT_UPSTREAM_RESULT: "failure" };
  }
  const partial = failedJob("planned-failure");
  const beforeConfirmation = evidenceSnapshot(root);
  const confirmation = invoke(root, "contrarian", reviewRequest, [], partial);
  const routed = qualityReview(partial, 1);
  expect(routed.verdict).toEqual(confirmation.finding);
  expect(routed.handoffs).toContainEqual(expect.objectContaining({ role: "reporting", confirmedFailures: ["suite"] }));
  expect(confirmation, JSON.stringify(confirmation.finding)).toMatchObject({
    status: 1, finding: { status: "failure_confirmed", advance: false, reportedStatus: "failed", confirmedFailures: ["suite"] },
  });
  expect(evidenceSnapshot(root)).toEqual(beforeConfirmation);

  const partialSummary = path.join(artifacts, "reporting", partial.PW_AGENT_JOB_ID, "summary.json");
  const falseGreen = JSON.stringify({ ...JSON.parse(fs.readFileSync(partialSummary, "utf8")), status: "passed", knownFailures: [] });
  fs.writeFileSync(partialSummary, falseGreen);
  const greenClaim = { ...partial, PW_AGENT_UPSTREAM_RESULT: "success",
    PW_AGENT_REVIEW_SUMMARY_SHA256: createHash("sha256").update(falseGreen).digest("hex") };
  expect(invoke(root, "contrarian", reviewRequest, [], greenClaim)).toMatchObject({
    status: 1, finding: { status: "failure_confirmed", advance: false, reportedStatus: "passed", confirmedFailures: ["suite"],
      challenges: expect.arrayContaining(["summary_disagrees_with_evidence", "green_with_confirmed_failure"]) },
  });

  for (const [mode, challenge] of [
    ["unplanned-failure", "discovery_mismatch"], ["unexpected-pass", "expected_failure_annotations"],
  ] as const) {
    const decision = invoke(root, "contrarian", reviewRequest, [], failedJob(mode));
    expect(decision, JSON.stringify(decision.finding)).toMatchObject({
      status: 2, finding: { status: "needs_review", advance: false, reportedStatus: "failed",
        confirmedFailures: [], challenges: expect.arrayContaining([challenge]) },
    });
  }

  fs.appendFileSync(path.join(root, "tests", "unit", "example.spec.ts"), "\n");
  expect(invoke(root, "reporting", reportRequest, [], partial)).toMatchObject({ status: 2, finding: { status: "denied" } });
  expect(invoke(root, "contrarian", reviewRequest, [], partial))
    .toMatchObject({ status: 2, finding: { status: "denied", advance: false } });
});
