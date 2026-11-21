import hashlib
import io
import json
import re
import subprocess
import sys
import unittest
import warnings
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from blocked_run_evidence import MAX_JSON, archive_member, collect


def serialized(obj):
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")


def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as container:
        for name, payload in entries:
            container.writestr(name, payload)
    return data.getvalue()


class EvidenceFixture:
    def __init__(self, event="pull_request"):
        self.repo = "example/board"
        self.base = "repos/example/board/actions"
        self.run_path = self.base + "/runs/81"
        self.attempt = self.run_path + "/attempts/2"
        self.job = "a1b2c3d4-1234-5678-abcd-123456789abc"
        self.sha = "a" * 40
        self.head = self.sha if event == "push" else "b" * 40
        self.run = {"id": 81, "run_attempt": 2, "event": event, "head_sha": self.head, "conclusion": "failure",
                    "path": ".github/workflows/ci.yml", "workflow_id": 12, "status": "completed",
                    "repository": {"id": 33, "full_name": self.repo}}
        self.jobs = [{"name": name, "status": "completed", "conclusion": "failure"} for name in ("collect", "verify")]
        self.summary = {"schemaVersion": 1, "policyVersion": 1, "jobId": self.job, "revision": self.sha,
                        "manifestSha256": "d" * 64, "status": "failed", "coverage": "partial", "incompleteSources": ["performance"],
                        "suite": {"status": "passed", "counts": {"expected": 30, "unexpected": 0, "flaky": 0, "skipped": 0}},
                        "security": {"status": "failed"}, "performance": {"status": "missing"},
                        "reason": "<script>untrusted text</script>"}
        self.receipt = {"schemaVersion": 1, "policyVersion": 1, "jobId": self.job, "revision": self.sha,
                        "manifestSha256": "d" * 64, "status": "failure_confirmed", "advance": False, "upstreamResult": "failure",
                        "reportedStatus": "failed", "confirmedFailures": ["security"], "challenges": ["performance_baseline_unverified"],
                        "reason": "instruction supplied by a report"}
        self.routes = {self.attempt: self.run, self.base + "/workflows/ci.yml": {"id": 12},
                       self.attempt + "/jobs?per_page=100": {"jobs": self.jobs}}
        self.calls = []

    def enroll(self):
        raw = serialized(self.summary)
        self.receipt["summarySha256"] = hashlib.sha256(raw).hexdigest()
        self.add_artifact(17, "contrarian-81-2", [("contrarian.json", serialized(self.receipt))])
        self.add_artifact(18, "review-inputs-81-2", [("summary.json", raw), ("suite.json", b"private source log")])
        self.add_artifact(19, f"playwright-{self.sha}-2", [("extra.txt", b"private console output")])

    def add_artifact(self, identifier, name, entries):
        content = archive(entries)
        item = {"id": identifier, "name": name, "size_in_bytes": len(content), "expired": False,
                "digest": "sha256:" + hashlib.sha256(content).hexdigest(),
                "workflow_run": {"id": 81, "head_sha": self.head, "repository_id": 33}}
        self.routes[self.run_path + "/artifacts?name=" + name + "&per_page=2"] = {"total_count": 1, "artifacts": [item]}
        self.routes[f"{self.base}/artifacts/{identifier}/zip"] = content

    def api(self, route, cap):
        self.calls.append(route)
        content = self.routes[route]
        raw = content if isinstance(content, bytes) else serialized(content)
        if len(raw) > cap:
            raise ValueError("Response too large.")
        return raw

    def call(self):
        return collect(self.repo, "81", "2", self.api)


class BlockedRunTests(unittest.TestCase):
    def test_bound_push_and_pr_merge_keep_only_governed_facts(self):
        for event in ("push", "pull_request"):
            f = EvidenceFixture(event)
            f.enroll()
            result = f.call()
            self.assertEqual(result["confirmedFailures"], ["security"])
            self.assertEqual(result["incompleteSources"], ["performance"])
            self.assertEqual(result["revision"], f.sha)
            self.assertNotIn("untrusted", str(result))
            self.assertNotIn("instruction supplied", str(result))
            self.assertNotIn(f.base + "/artifacts/19/zip", f.calls)

    def test_green_attempt_wrong_workflow_or_failed_job_without_a_blocked_gate_rejects_before_download(self):
        for changes in ({"conclusion": "success"}, {"event": "workflow_dispatch"}, {"run_attempt": 9},
                        {"path": ".github/workflows/other.yml"}, {"workflow_id": 99}, {"status": "in_progress"}):
            f = EvidenceFixture()
            f.run.update(changes)
            with self.assertRaises(ValueError):
                f.call()
            self.assertFalse(any(path.endswith("/zip") for path in f.calls))
        f = EvidenceFixture()
        f.jobs[1]["conclusion"] = "success"
        with self.assertRaises(ValueError):
            f.call()

    def test_evidence_gap_explanation_keeps_confirmed_failures_empty(self):
        f = EvidenceFixture()
        f.receipt.update(status="needs_review", reportedStatus="inconclusive", confirmedFailures=[],
                         challenges=["performance_baseline_unverified", "upstream_failure_unexplained"])
        f.summary["status"] = "inconclusive"
        f.summary["security"]["status"] = "passed"
        f.enroll()
        result = f.call()
        self.assertEqual(result["gate"], "needs_review")
        self.assertEqual(result["confirmedFailures"], [])
        self.assertIn("performance_baseline_unverified", result["challenges"])

    def test_requires_blocked_receipt_matching_job_and_validated_summary(self):
        for changes in ({"advance": True}, {"status": "approved"}, {"jobId": "b" * 36}, {"revision": "f" * 40},
                        {"manifestSha256": "e" * 64}, {"reportedStatus": "passed"}, {"upstreamResult": "success"},
                        {"challenges": ["summary_disagrees_with_evidence"]}, {"challenges": ["summary_unverified"]},
                        {"challenges": ["untrusted free text"]}, {"confirmedFailures": ["suite", "suite"]}):
            f = EvidenceFixture()
            f.receipt.update(changes)
            f.enroll()
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                f.call()
        f = EvidenceFixture()
        f.enroll()
        f.add_artifact(18, "review-inputs-81-2", [("summary.json", serialized(f.summary) + b" ")])
        with self.assertRaises(ValueError):
            f.call()

    def test_stale_artifacts_duplicates_and_mixed_attempts_cannot_supply_evidence(self):
        for changes in ({"expired": True}, {"digest": "sha256:" + "0" * 64},
                        {"workflow_run": {"id": 82, "repository_id": 33, "head_sha": "b" * 40}},
                        {"name": "contrarian-81-1"}):
            f = EvidenceFixture()
            f.enroll()
            f.routes[f.run_path + "/artifacts?name=contrarian-81-2&per_page=2"]["artifacts"][0].update(changes)
            with self.assertRaises(ValueError):
                f.call()
        f = EvidenceFixture()
        f.enroll()
        f.routes[f.run_path + f"/artifacts?name=playwright-{f.sha}-2&per_page=2"] = {"total_count": 0, "artifacts": []}
        with self.assertRaises(ValueError):
            f.call()

    def test_untrusted_zip_entries_remain_in_memory(self):
        for entries in ([("../summary.json", b"x")], [("summary.json", b"a"), ("summary.json", b"b")],
                        [("summary.json", b"x" * (MAX_JSON + 1))]):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                data = archive(entries)
            with self.assertRaises(ValueError):
                archive_member(data, "summary.json", "sha256:" + hashlib.sha256(data).hexdigest())

    def test_compiled_output_renders_stub_model_text_and_has_no_repository_writes(self):
        workflow = (ROOT / ".github/workflows/blocked-run-explainer.lock.yml").read_text(encoding="utf-8")
        self.assertNotRegex(workflow, r"(?m)^\s+[\w-]+: write\b")
        self.assertNotRegex(workflow, r"--allow-tool (?:github|shell|bash|edit)\b")
        self.assertIn("--allow-tool safeoutputs", workflow)
        self.assertIn("needs.evidence.outputs.facts != ''", workflow)
        # Exercise the actual compiled handler with a stub reply and an in-memory Actions summary.
        handler = re.search(r"(?s)(async function main\(config = \{\}\).*?module\.exports = \{ main \};)", workflow)
        self.assertIsNotNone(handler)
        stub = """
        const core = { summary: {
          addHeading() { return this }, addRaw(value) { this.note = value; return this },
          async write() { process.stdout.write(this.note) }
        }};
        """ + handler.group(1) + """
        (async () => { const deliver = await main(); await deliver({text: '<b>check suite & timing</b>'}) })();
        """
        result = subprocess.run(["node", "-e", stub], capture_output=True, text=True, timeout=10, check=True)
        self.assertEqual(result.stdout, "<pre>&lt;b&gt;check suite &amp; timing&lt;/b&gt;</pre>")
