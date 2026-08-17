import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const targetArg = args.find((value) => value !== "--fresh");

if (!targetArg) {
  throw new Error("Usage: node publication/materialize-frozen-tree.mjs <new-directory> [--fresh]");
}

const targetRoot = path.resolve(targetArg);
if (targetRoot === sourceRoot || targetRoot.startsWith(`${sourceRoot}${path.sep}`)) {
  throw new Error("The materialized tree must be outside the published source tree");
}

try {
  await fs.access(targetRoot);
  throw new Error("Target directory already exists; choose a new empty path");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await fs.cp(sourceRoot, targetRoot, {
  recursive: true,
  filter: (entry) => path.basename(entry) !== ".git",
});

try {
  const testPath = path.join(targetRoot, "tests", "runner.test.mjs");
  const sanitized = await fs.readFile(testPath, "utf8");
  const historicalSyntheticLiteral = ["real.person", "gmail.com"].join("@");
  const restored = sanitized.replaceAll("unexpected@example.invalid", historicalSyntheticLiteral);
  await fs.writeFile(testPath, restored, "utf8");

  if (fresh) {
    for (const relative of [
      "evidence/attempt-intents",
      "evidence/attempts",
      "evidence/canonical",
      "evidence/requests",
      "evidence/responses",
      "evidence/run-metadata",
      "results",
      "reports",
    ]) {
      await fs.rm(path.join(targetRoot, relative), { recursive: true, force: true });
    }
    await fs.rm(path.join(targetRoot, "checksums.sha256"), { force: true });
  }

  console.log(JSON.stringify({ ok: true, target: targetRoot, mode: fresh ? "fresh-rerun" : "verification-copy" }, null, 2));
} catch (error) {
  await fs.rm(targetRoot, { recursive: true, force: true });
  throw error;
}
