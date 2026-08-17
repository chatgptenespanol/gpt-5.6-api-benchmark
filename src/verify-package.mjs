import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const frozen = JSON.parse(await fs.readFile(path.join(root, "benchmark", "pre-run-manifest.json"), "utf8"));
const mismatches = [];
for (const [relative, expected] of Object.entries(frozen.files)) {
  try {
    const bytes = await fs.readFile(path.join(root, relative));
    if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes) mismatches.push({ file: relative, reason: "hash_or_size" });
  } catch (error) {
    mismatches.push({ file: relative, reason: error.code || String(error) });
  }
}
if (mismatches.length) {
  console.error(JSON.stringify({ ok: false, frozen_mismatches: mismatches }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, frozen_files_verified: Object.keys(frozen.files).length }, null, 2));
}

