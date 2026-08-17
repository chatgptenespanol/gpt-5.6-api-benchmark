import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = path.join(root, "benchmark", "pre-run-manifest.json");
const publicationPath = path.join(root, "publication", "publication-manifest.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const manifestBytes = await readFile(manifestPath);
const preRun = JSON.parse(manifestBytes);
const publication = JSON.parse(await readFile(publicationPath, "utf8"));

if (sha256(manifestBytes) !== publication.pre_run_manifest_sha256) {
  throw new Error("pre-run manifest hash mismatch");
}

const exceptions = new Map(
  publication.post_run_sanitizations.map((entry) => [entry.path, entry]),
);

let verified = 0;
for (const [relativePath, frozen] of Object.entries(preRun.files)) {
  const bytes = await readFile(path.join(root, relativePath));
  const actual = sha256(bytes);
  const exception = exceptions.get(relativePath);
  const expected = exception?.published_sha256 ?? frozen.sha256;
  if (actual !== expected) {
    throw new Error(`${relativePath}: expected ${expected}, got ${actual}`);
  }
  if (exception) {
    if (frozen.sha256 !== exception.original_pre_run_sha256) {
      throw new Error(`${relativePath}: original frozen hash was not preserved`);
    }
    if (bytes.length !== exception.published_bytes) {
      throw new Error(`${relativePath}: published byte count mismatch`);
    }
  }
  verified += 1;
}

for (const relativePath of exceptions.keys()) {
  if (!(relativePath in preRun.files)) {
    throw new Error(`${relativePath}: sanitization target is not in the pre-run manifest`);
  }
}

const checksumLines = (await readFile(path.join(root, "checksums.sha256"), "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
let checksumFiles = 0;
for (const line of checksumLines) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) throw new Error(`invalid checksum line: ${line}`);
  const [, expected, relativePath] = match;
  const actual = sha256(await readFile(path.join(root, relativePath)));
  if (actual !== expected) throw new Error(`${relativePath}: package checksum mismatch`);
  checksumFiles += 1;
}

console.log(`Publication verification passed: ${verified}/${verified} frozen paths, ${exceptions.size} declared test-only sanitization, ${checksumFiles}/${checksumFiles} package checksums.`);
