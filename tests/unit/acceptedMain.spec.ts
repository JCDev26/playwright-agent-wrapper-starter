import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { eventCutoff, NoAcceptedMain, selectAcceptedMain, stackedMainCutoff } from "../../src/playwright-wrapper/performance/acceptedMain";
import policy from "../../agents/performance/policy.json";

const repository = { full_name: policy.reference.repository };
const current = "1".repeat(40);
const previous = "2".repeat(40);
const accepted = "3".repeat(40);
const successful = { id: 123, head_sha: accepted, repository, head_branch: "main",
  event: "push", status: "completed", conclusion: "success" };

test("main pushes exclude themselves and PRs freeze the main base at the event", () => {
  expect(eventCutoff("push", { ref: "refs/heads/main", before: previous, repository })).toBe(previous);
  expect(eventCutoff("pull_request", { repository, pull_request: { base: { ref: "main", sha: current, repo: repository } } })).toBe(current);
  expect(() => eventCutoff("push", { ref: "refs/heads/feature", before: previous, repository })).toThrow();
  expect(() => eventCutoff("push", { ref: "refs/heads/main", before: "0".repeat(40), repository })).toThrow(NoAcceptedMain);
});

test("selects the nearest accepted first-parent push, skipping failed or pending commits", async () => {
  const history = [current, previous, accepted, "4".repeat(40)];
  const visited: string[] = [];
  const result = await selectAcceptedMain(history, async sha => {
    visited.push(sha);
    if (sha === current) return { ...successful, head_sha: sha, status: "in_progress", conclusion: null };
    if (sha === previous) return { ...successful, head_sha: sha, conclusion: "failure" };
    return successful;
  });
  expect(result).toEqual({ revision: accepted, runId: "123" });
  expect(visited).toEqual(history.slice(0, 3));
});

test("a stacked PR can inherit main through either parent but cannot nominate a feature commit", ({}, info) => {
  const cwd = info.outputPath("history");
  mkdirSync(cwd, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
    ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  const tree = git("write-tree");
  const commit = (message: string, ...parents: string[]) => git("commit-tree", tree, "-m", message,
    ...parents.flatMap(parent => ["-p", parent]));
  const initial = commit("initial");
  const mainChange = commit("main", initial);
  const feature = commit("feature", initial);
  const mainMerge = commit("merge feature on main", mainChange, feature);
  const stack = commit("update stacked base", feature, mainChange);
  git("update-ref", "refs/remotes/origin/main", mainMerge);
  const cutoff = (sha: string) => eventCutoff("pull_request", { repository,
    pull_request: { base: { ref: "feature-base", sha, repo: repository } } }, base => stackedMainCutoff(base, cwd));
  expect(cutoff(feature)).toBe(initial);
  expect(cutoff(stack)).toBe(mainChange);
  expect(cutoff(commit("after main", mainMerge))).toBe(mainMerge);
  expect(() => cutoff(commit("unrelated root"))).toThrow();
});

test("PRs, other branches, repositories, and lookup errors cannot authorize a baseline", async () => {
  for (const run of [undefined, { ...successful, event: "pull_request" }, { ...successful, head_branch: "fork" },
    { ...successful, repository: { full_name: "other/repository" } }, { ...successful, head_sha: previous }]) {
    await expect(selectAcceptedMain([accepted], async () => run)).rejects.toThrow(NoAcceptedMain);
  }
  await expect(selectAcceptedMain([accepted], async () => { throw new Error("network unavailable"); })).rejects.toThrow("network unavailable");
});
