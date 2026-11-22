import fs from "node:fs/promises";
import path from "node:path";
import type { PlaywrightArtifacts } from "../contract/resultSchema";

export const emptyArtifacts = (): PlaywrightArtifacts => ({
  htmlReport: null, testResultsJson: null, testResultsXml: null, traceFiles: [],
});
export const reportPath = (value: string): string => value.split(path.sep).join("/");

export async function collectPlaywrightArtifacts(root: string | null): Promise<PlaywrightArtifacts> {
  if (!root) return emptyArtifacts();
  const present = async (name: string) => {
    const file = path.join(root, name);
    try { return (await fs.stat(file)).isFile() ? reportPath(file) : null; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const traces: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".zip")) traces.push(reportPath(file));
    }
  };
  const [htmlReport, testResultsJson, testResultsXml] = await Promise.all([
    present(path.join("html", "index.html")), present("results.json"), present("junit.xml"),
    visit(path.join(root, "test-results")),
  ]);
  return { htmlReport, testResultsJson, testResultsXml, traceFiles: traces.sort() };
}
