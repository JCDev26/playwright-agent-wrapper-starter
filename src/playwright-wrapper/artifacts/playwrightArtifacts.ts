import fs from "node:fs";
import path from "node:path";
import type { PlaywrightArtifacts } from "../contract/resultSchema";


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
    if (entry.isFile() && normalized.endsWith(".zip")) {
      collected.push(normalized);
    }
  }

  return collected.sort();
}

export function collectPlaywrightArtifacts(root: string | null): PlaywrightArtifacts {
  if (!root) return { htmlReport: null, testResultsJson: null, testResultsXml: null, traceFiles: [] };
  const HTML_REPORT_PATH = path.join(root, "html", "index.html");
  const TEST_RESULTS_JSON_PATH = path.join(root, "results.json");
  const TEST_RESULTS_XML_PATH = path.join(root, "junit.xml");
  const TRACE_ROOT = path.join(root, "test-results");
  return {
    htmlReport: fileExists(HTML_REPORT_PATH) ? toRepoRelativePath(HTML_REPORT_PATH) : null,
    testResultsJson: fileExists(TEST_RESULTS_JSON_PATH) ? toRepoRelativePath(TEST_RESULTS_JSON_PATH) : null,
    testResultsXml: fileExists(TEST_RESULTS_XML_PATH) ? toRepoRelativePath(TEST_RESULTS_XML_PATH) : null,
    traceFiles: collectTraceFilesFromDir(TRACE_ROOT),
  };
}
