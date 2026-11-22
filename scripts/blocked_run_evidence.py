"""Bind a failed CI attempt to the small set of facts an advisory model may see."""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile


LANES = {"suite", "security", "performance"}
LANE_STATUSES = {"passed", "failed", "inconclusive", "missing", "invalid", "not_scheduled"}
CHALLENGES = {
    "discovery_mismatch", "flaky_tests", "unapproved_skips", "expected_failure_annotations",
    "upstream_incomplete", "producer_platform_unverified", "manifest_unverified", "summary_disagrees_with_evidence",
    "summary_unverified", "suite_verdict_incomplete", "suite_project_missing", "suite_inventory_unverified",
    "native_job_unbound", "native_job_mismatch", "security_native_unverified", "security_checks_incomplete",
    "security_receipt_mismatch", "performance_baseline_unverified", "performance_comparison_incomplete",
    "performance_enrollment_unverified", "performance_measurements_incomparable", "performance_mode_mismatch",
    "performance_mode_unrecognized", "performance_native_unverified", "performance_receipt_mismatch",
    "reported_failure_unconfirmed", "upstream_failure_unexplained", "green_with_confirmed_failure", "evidence_incomplete",
}
MAX_JSON = 65536
MAX_BUNDLE = 80 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive(value):
    require(re.fullmatch(r"[1-9][0-9]{0,18}", str(value)), "Invalid run, attempt or artifact ID.")
    return int(value)


def checked_list(items, allowed):
    require(isinstance(items, list) and len(items) <= len(allowed)
            and all(isinstance(item, str) and item in allowed for item in items)
            and len(set(items)) == len(items), "Unrecognized evidence classification.")
    return items


def unique_json(bytes_value):
    def unique_object(pairs):
        obj = {}
        for key, value in pairs:
            require(key not in obj, "Ambiguous JSON object.")
            obj[key] = value
        return obj
    return json.loads(bytes_value.decode("utf-8"), object_pairs_hook=unique_object)


def github(path, limit):
    # gh owns authentication and follows GitHub's signed artifact download redirects.
    with subprocess.Popen(["gh", "api", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        data = process.stdout.read(limit + 1)
        if len(data) > limit:
            process.kill()
            raise ValueError("The GitHub response exceeds the evidence limit.")
        require(process.wait() == 0, "GitHub could not supply the requested run evidence.")
        return data


def archive_member(data, name, digest):
    require("sha256:" + hashlib.sha256(data).hexdigest() == digest, "The artifact archive digest changed.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        # Open only one literal member in memory. Other bundle entries never reach the model or filesystem.
        entries = [entry for entry in archive.infolist() if entry.filename == name]
        require(len(entries) == 1 and 0 < entries[0].file_size <= MAX_JSON and not entries[0].flag_bits & 1,
                "Missing, ambiguous or oversized evidence member.")
        with archive.open(entries[0]) as member:
            raw = member.read(MAX_JSON + 1)
        require(len(raw) == entries[0].file_size, "Incomplete evidence member.")
        return raw


def project(receipt, summary_bytes, collect_result):
    summary = unique_json(summary_bytes)
    require(isinstance(receipt, dict) and isinstance(summary, dict) and
            all(type(obj.get(key)) is int and obj[key] == 1 for obj in (receipt, summary)
                for key in ("schemaVersion", "policyVersion")),
            "Unrecognized evidence version.")
    require(receipt.get("advance") is False and receipt.get("status") in {"failure_confirmed", "needs_review"}
            and receipt.get("upstreamResult") == collect_result, "The receipt does not establish a blocked gate.")
    require(isinstance(receipt.get("jobId"), str) and re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", receipt["jobId"])
            and receipt["jobId"] == summary.get("jobId"), "The job binding differs.")
    require(isinstance(receipt.get("revision"), str) and re.fullmatch(r"[0-9a-f]{40}", receipt["revision"])
            and receipt["revision"] == summary.get("revision"), "The tested revision differs.")
    require(receipt.get("summarySha256") == hashlib.sha256(summary_bytes).hexdigest()
            and isinstance(receipt.get("manifestSha256"), str) and re.fullmatch(r"[0-9a-f]{64}", receipt["manifestSha256"])
            and receipt["manifestSha256"] == summary.get("manifestSha256"), "The summary or manifest digest differs.")
    challenges = checked_list(receipt.get("challenges"), CHALLENGES)
    require(not ({"summary_disagrees_with_evidence", "summary_unverified", "manifest_unverified"} & set(challenges)),
            "The gate could not validate the submitted Reporting summary.")
    failures = checked_list(receipt.get("confirmedFailures"), LANES)
    require((receipt["status"] == "failure_confirmed") == bool(failures), "Inconsistent confirmed failures.")
    require(receipt.get("reportedStatus") == summary.get("status") and summary.get("status") in {"passed", "failed", "inconclusive"}
            and summary.get("coverage") in {"complete", "partial"}, "Unknown Reporting outcome.")
    statuses = {name: summary[name]["status"] for name in sorted(LANES)}
    require(all(isinstance(status, str) and status in LANE_STATUSES for status in statuses.values()),
            "Unknown source status.")
    facts = {"jobId": receipt["jobId"], "revision": receipt["revision"], "gate": receipt["status"],
             "confirmedFailures": failures, "challenges": challenges, "reported": summary["status"],
             "coverage": summary["coverage"], "sourceStatus": statuses,
             "incompleteSources": checked_list(summary.get("incompleteSources"), LANES)}
    counts = summary["suite"].get("counts")
    if counts is not None:
        keys = ["expected", "unexpected", "flaky", "skipped"]
        require(all(type(counts.get(key)) is int and 0 <= counts[key] <= 100000000 for key in keys),
                "Invalid suite counts.")
        facts["suiteCounts"] = {key: counts[key] for key in keys}
    return facts


def collect(repo, run_id, attempt, fetch=github):
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo), "Invalid repository.")
    run_id, attempt = positive(run_id), positive(attempt)
    prefix = f"repos/{repo}/actions"
    run_path = f"{prefix}/runs/{run_id}"
    attempt_path = f"{run_path}/attempts/{attempt}"

    def api(endpoint):
        return unique_json(fetch(endpoint, 2 * 1024 * 1024))

    run = api(attempt_path)
    require(run["id"] == run_id and run["run_attempt"] == attempt and run["status"] == "completed"
            and run["conclusion"] == "failure" and run["path"] == ".github/workflows/ci.yml"
            and run["workflow_id"] == api(f"{prefix}/workflows/ci.yml")["id"]
            and run["repository"]["full_name"].lower() == repo.lower() and run["event"] in {"push", "pull_request"},
            "Select a completed, failed attempt of this repository's ci.yml.")
    jobs = api(f"{attempt_path}/jobs?per_page=100")["jobs"]

    def completed(name, results):
        selected = [job for job in jobs if job["name"] == name]
        require(len(selected) == 1 and selected[0]["status"] == "completed" and selected[0]["conclusion"] in results,
                "CI did not produce the required completed jobs.")
        return selected[0]["conclusion"]

    completed("verify", {"failure"})
    upstream = completed("collect", {"success", "failure"})

    def artifact(name):
        response = api(f"{run_path}/artifacts?name={name}&per_page=2")
        require(response["total_count"] == 1 and len(response["artifacts"]) == 1, "Missing or ambiguous CI artifact.")
        item = response["artifacts"][0]
        origin = item["workflow_run"]
        require(item["name"] == name and item["expired"] is False and origin["id"] == run_id
                and origin["repository_id"] == run["repository"]["id"] and origin["head_sha"] == run["head_sha"],
                "Artifact belongs to a different run or revision.")
        return item

    def member(prefix_name, filename, cap):
        item = artifact(f"{prefix_name}-{run_id}-{attempt}")
        require(type(item["size_in_bytes"]) is int and 0 < item["size_in_bytes"] <= cap, "Artifact exceeds evidence limit.")
        payload = fetch(f"{prefix}/artifacts/{positive(item['id'])}/zip", item["size_in_bytes"])
        require(len(payload) == item["size_in_bytes"], "Incomplete artifact transfer.")
        return archive_member(payload, filename, item["digest"])

    receipt = unique_json(member("contrarian", "contrarian.json", MAX_JSON * 2))
    summary_raw = member("review-inputs", "summary.json", MAX_BUNDLE)
    facts = project(receipt, summary_raw, upstream)
    if run["event"] == "push":
        require(facts["revision"] == run["head_sha"], "Receipt differs from the tested push.")
    else:
        # PR workflow metadata names the author's head, while CI checks out the test merge.
        # CI records github.sha independently in this same attempt's retained artifact name.
        artifact(f"playwright-{facts['revision']}-{attempt}")
    return {"run": run_id, "attempt": attempt, **facts}


if __name__ == "__main__":
    try:
        facts = collect(os.environ["GITHUB_REPOSITORY"], os.environ["SOURCE_RUN"], os.environ["SOURCE_ATTEMPT"])
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            print("facts=" + json.dumps(facts, separators=(",", ":")), file=output)
    except (KeyError, TypeError, ValueError, OSError, zipfile.BadZipFile, RuntimeError):
        sys.exit("Blocked-run evidence is unavailable or inconsistent. See the original CI receipt.")
