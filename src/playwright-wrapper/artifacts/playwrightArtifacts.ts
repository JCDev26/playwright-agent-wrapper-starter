import fs from "node:fs";
import path from "node:path";
import type { PlaywrightArtifacts } from "../contract/resultSchema";

const HTML_REPORT_PATH = "artifacts/playwright-report/index.html";
const TEST_RESULTS_JSON_PATH = "artifacts/test-results.json";
const TEST_RESULTS_XML_PATH = "artifacts/test-results.xml";
const TRACE_ROOT = "artifacts/test-results";

function toRepoRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function collectTraceFilesFromDir(dirPath: string): string[] {
  if (!fileExists(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      collected.push(...collectTraceFilesFromDir(fullPath));
      continue;
    }

    const normalized = toRepoRelativePath(fullPath);
    if (normalized.endsWith(".zip")) {
      collected.push(normalized);
    }
  }

  return collected.sort();
}

export function collectPlaywrightArtifacts(): PlaywrightArtifacts {
  return {
    htmlReport: fileExists(HTML_REPORT_PATH) ? HTML_REPORT_PATH : null,
    testResultsJson: fileExists(TEST_RESULTS_JSON_PATH) ? TEST_RESULTS_JSON_PATH : null,
    testResultsXml: fileExists(TEST_RESULTS_XML_PATH) ? TEST_RESULTS_XML_PATH : null,
    traceFiles: collectTraceFilesFromDir(TRACE_ROOT),
  };
}