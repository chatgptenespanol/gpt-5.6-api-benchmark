import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestRelative = "benchmark/pre-run-manifest.json";
const manifest = JSON.parse(await fs.readFile(path.join(root, manifestRelative), "utf8"));
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gpt56-publication-runner-test-"));

try {
  for (const relative of [...Object.keys(manifest.files), manifestRelative]) {
    const source = path.join(root, relative);
    const destination = path.join(temporaryRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (relative === "tests/runner.test.mjs") {
      const sanitized = await fs.readFile(source, "utf8");
      const historicalSyntheticLiteral = ["real.person", "gmail.com"].join("@");
      const restored = sanitized.replaceAll("unexpected@example.invalid", historicalSyntheticLiteral);
      await fs.writeFile(destination, restored, "utf8");
    } else {
      await fs.copyFile(source, destination);
    }
  }
  await import(`${pathToFileURL(path.join(temporaryRoot, "tests", "runner.test.mjs")).href}?publication-check=1`);
  console.log("Sanitized publication runner test passed against the exact pre-run frozen tree.");
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
