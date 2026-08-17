import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMON_INSTRUCTIONS, EVALUATOR_VERSION, MODELS, PROTOCOL_VERSION, REQUEST_CONFIG, ROTATION, TASKS, buildJobs } from "./spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
await fs.mkdir(path.join(root, "benchmark", "tasks"), { recursive: true });
await fs.mkdir(path.join(root, "benchmark", "schemas"), { recursive: true });
await fs.mkdir(path.join(root, "benchmark", "expected"), { recursive: true });
await fs.mkdir(path.join(root, "benchmark", "rules"), { recursive: true });
await fs.mkdir(path.join(root, "configs"), { recursive: true });

for (const task of TASKS) {
  await fs.writeFile(path.join(root, "benchmark", "tasks", `${task.id}.txt`), `${COMMON_INSTRUCTIONS}\n\n${task.prompt}\n`, "utf8");
  await fs.writeFile(path.join(root, "benchmark", "schemas", `${task.id}.schema.json`), JSON.stringify(task.schema, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(root, "benchmark", "expected", `${task.id}.json`), JSON.stringify(task.expected, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(root, "benchmark", "rules", `${task.id}.json`), JSON.stringify({ task_id: task.id, rules: task.rules, critical_failure: task.critical }, null, 2) + "\n", "utf8");
}

for (const model of MODELS) {
  await fs.writeFile(path.join(root, "configs", `${model}.json`), JSON.stringify({ model, ...REQUEST_CONFIG, instructions: COMMON_INSTRUCTIONS, response_format: "task-specific strict JSON Schema" }, null, 2) + "\n", "utf8");
}

const manifest = {
  benchmark_id: "chatgpt-gratis-gpt56-neutral-es-2026-08-17",
  protocol_version: PROTOCOL_VERSION,
  evaluator_version: EVALUATOR_VERSION,
  models: MODELS,
  repetitions_per_task_model: 3,
  tasks: TASKS.length,
  canonical_outputs_expected: TASKS.length * MODELS.length * 3,
  common_instructions: COMMON_INSTRUCTIONS,
  request_config: REQUEST_CONFIG,
  rotation: ROTATION,
  jobs: buildJobs(),
  task_summary: TASKS.map((task) => ({ id: task.id, title: task.title, domain: task.domain, rules: task.rules, critical: task.critical })),
};
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
await fs.writeFile(path.join(root, "benchmark", "benchmark-manifest.json"), manifestText, "utf8");
await fs.writeFile(path.join(root, "benchmark", "jobs.json"), JSON.stringify(buildJobs(), null, 2) + "\n", "utf8");
console.log(JSON.stringify({ tasks: TASKS.length, jobs: buildJobs().length, manifest_sha256: sha256(manifestText) }, null, 2));

