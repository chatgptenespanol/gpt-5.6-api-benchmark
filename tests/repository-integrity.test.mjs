import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRepository } from "../src/evaluate.mjs";
import { buildJobs } from "../src/spec.mjs";
import { runJobs } from "../src/run-benchmark.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gpt56-repository-test-"));
const originalFetch = globalThis.fetch;

try {
  const manifestRelative = "benchmark/pre-run-manifest.json";
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, manifestRelative), "utf8"));
  for (const relative of [...Object.keys(manifest.files), manifestRelative]) {
    const source = path.join(sourceRoot, relative);
    const destination = path.join(temporaryRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }

  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const response = {
      id: `resp_synthetic_${calls}`,
      object: "response",
      created_at: 1786924800 + calls,
      status: "completed",
      model: request.model,
      output: [{
        id: `msg_synthetic_${calls}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "{}", annotations: [] }],
      }],
      store: false,
      tools: [],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 10,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 110,
      },
    };
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  };

  const run = await runJobs({ apiKey: `sk-test-${"x".repeat(100)}`, rootDir: temporaryRoot, hardCostUsd: 3 });
  assert.equal(run.completed, 108);
  assert.equal(calls, 108);
  const evaluation = await evaluateRepository(temporaryRoot);
  assert.equal(evaluation.scores.length, 108);

  const first = buildJobs()[0];
  const attemptFile = path.join(temporaryRoot, "evidence", "attempts", `${first.run_id}__a1.json`);
  const attempt = JSON.parse(await fs.readFile(attemptFile, "utf8"));
  attempt.run_id = "tampered-run-id";
  await fs.writeFile(attemptFile, JSON.stringify(attempt, null, 2) + "\n", "utf8");
  await assert.rejects(evaluateRepository(temporaryRoot), /Attempt identity mismatch/);

  console.log(JSON.stringify({ ok: true, simulated_calls: calls, exact_jobs: evaluation.scores.length, tampered_attempt_blocked: true }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
