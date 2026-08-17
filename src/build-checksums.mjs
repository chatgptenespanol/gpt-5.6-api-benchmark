import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "node_modules"]);
const excludedFiles = new Set(["checksums.sha256"]);

async function walk(directory, relative = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const childRelative = path.posix.join(relative, entry.name);
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child, childRelative));
    else if (!excludedFiles.has(childRelative)) files.push(childRelative);
  }
  return files;
}

const lines = [];
for (const relative of await walk(root)) {
  const bytes = await fs.readFile(path.join(root, relative));
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  lines.push(`${hash}  ${relative}`);
}
const output = `${lines.join("\n")}\n`;
const target = path.join(root, "checksums.sha256");
try {
  const current = await fs.readFile(target, "utf8");
  if (current !== output) throw new Error("checksums.sha256 already exists and differs");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await fs.writeFile(target, output, { encoding: "utf8", flag: "wx" });
}
console.log(JSON.stringify({ ok: true, files: lines.length }, null, 2));
