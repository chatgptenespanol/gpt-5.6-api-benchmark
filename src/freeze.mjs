import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVALUATOR_VERSION, PROTOCOL_VERSION, buildJobs } from "./spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "benchmark", "pre-run-manifest.json");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function walk(relative) {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) output.push(...await walk(child));
    else output.push(child);
  }
  return output;
}

const fixed = ["package.json", "protocol.md", "environment/runtime.json"];
const directories = ["src", "tests", "configs", "benchmark/tasks", "benchmark/schemas", "benchmark/expected", "benchmark/rules"];
const files = [...fixed];
for (const directory of directories) files.push(...await walk(directory));
files.push("benchmark/benchmark-manifest.json", "benchmark/jobs.json");
const uniqueFiles = [...new Set(files)].sort();

const current = {};
for (const relative of uniqueFiles) {
  const bytes = await fs.readFile(path.join(root, relative));
  current[relative] = { sha256: sha256(bytes), bytes: bytes.length };
}

try {
  const existing = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const mismatches = [];
  for (const [relative, expected] of Object.entries(existing.files || {})) {
    if (!current[relative] || current[relative].sha256 !== expected.sha256 || current[relative].bytes !== expected.bytes) mismatches.push(relative);
  }
  if (mismatches.length) throw new Error(`Frozen files changed: ${mismatches.join(", ")}`);
  console.log(JSON.stringify({ frozen: true, verified: true, files: Object.keys(existing.files).length, manifest_sha256: sha256(await fs.readFile(manifestPath)) }, null, 2));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const manifest = {
    benchmark_id: "chatgpt-gratis-gpt56-neutral-es-2026-08-17",
    protocol_version: PROTOCOL_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    frozen_at_utc: new Date().toISOString(),
    canonical_jobs: buildJobs().length,
    rule_decisions_expected: buildJobs().length * 5,
    note: "These files were frozen before the first canonical API response. Changing one requires a new protocol version and a complete rerun.",
    files: current,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ frozen: true, verified: false, files: uniqueFiles.length, manifest_sha256: sha256(await fs.readFile(manifestPath)) }, null, 2));
}

