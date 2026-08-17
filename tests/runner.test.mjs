import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildJobs } from "../src/spec.mjs";
import { runJobs } from "../src/run-benchmark.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gpt56-runner-test-"));
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

  let fetchCalls = 0;
  let responseMode = "ok";
  globalThis.fetch = async (_url, options) => {
    fetchCalls += 1;
    const request = JSON.parse(options.body);
    const response = {
      id: "resp_synthetic_runner_test",
      object: "response",
      created_at: 1786924800,
      status: "completed",
      model: responseMode === "wrong_model" ? "gpt-5.6-unexpected" : request.model,
      output: [{
        id: "msg_synthetic_runner_test",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: responseMode === "unexpected_email" ? '{"contact":"unexpected@example.invalid"}' : "{}", annotations: [] }],
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
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_synthetic_runner_test" },
    });
  };

  const job = buildJobs()[0];
  const key = `sk-test-${"x".repeat(100)}`;
  await assert.rejects(
    runJobs({ apiKey: key, rootDir: temporaryRoot, jobIds: [job.run_id], hardCostUsd: Number.NaN }),
    /positive finite/,
  );
  assert.equal(fetchCalls, 0, "invalid cap must fail before a call");

  const first = await runJobs({ apiKey: key, rootDir: temporaryRoot, jobIds: [job.run_id], hardCostUsd: 3 });
  assert.equal(first.completed, 1);
  assert.equal(first.skipped, 0);
  assert.equal(fetchCalls, 1);
  await fs.access(path.join(temporaryRoot, "evidence", "attempt-intents", `${job.run_id}__a1.json`));
  await fs.access(path.join(temporaryRoot, "evidence", "canonical", `${job.run_id}.json`));

  const second = await runJobs({ apiKey: key, rootDir: temporaryRoot, jobIds: [job.run_id], hardCostUsd: 3 });
  assert.equal(second.completed, 0);
  assert.equal(second.skipped, 1);
  assert.equal(fetchCalls, 1, "canonical reuse must not call the API again");

  const firstIntent = JSON.parse(await fs.readFile(path.join(temporaryRoot, "evidence", "attempt-intents", `${job.run_id}__a1.json`), "utf8"));
  const concurrentCap = firstIntent.reserved_max_cost_usd * 2 + 1e-9;
  const concurrentJobs = [buildJobs()[5], buildJobs()[7]];
  const concurrent = await Promise.allSettled(concurrentJobs.map((candidate) => runJobs({
    apiKey: key,
    rootDir: temporaryRoot,
    jobIds: [candidate.run_id],
    hardCostUsd: concurrentCap,
  })));
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "only one concurrent reservation may pass");
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1, "one concurrent reservation must fail closed");
  assert.equal(fetchCalls, 2, "global budget lock must prevent the second concurrent call");

  const wrongModelJob = buildJobs()[1];
  responseMode = "wrong_model";
  await assert.rejects(
    runJobs({ apiKey: key, rootDir: temporaryRoot, jobIds: [wrongModelJob.run_id], hardCostUsd: 3 }),
    /Returned model differs/,
  );
  await assert.rejects(fs.access(path.join(temporaryRoot, "evidence", "canonical", `${wrongModelJob.run_id}.json`)));
  assert.equal(fetchCalls, 3, "wrong model must stop after one call");

  const sensitiveJob = buildJobs()[2];
  responseMode = "unexpected_email";
  await assert.rejects(
    runJobs({ apiKey: key, rootDir: temporaryRoot, jobIds: [sensitiveJob.run_id], hardCostUsd: 3 }),
    /Unexpected sensitive pattern/,
  );
  const quarantinedAttempt = await fs.readFile(path.join(temporaryRoot, "evidence", "attempts", `${sensitiveJob.run_id}__a1.json`), "utf8");
  assert.equal(quarantinedAttempt.includes("unexpected@example.invalid"), false, "unexpected email must not reach evidence");
  assert.equal(quarantinedAttempt.includes("security_redaction"), true, "quarantine marker must be public");
  await assert.rejects(fs.access(path.join(temporaryRoot, "evidence", "canonical", `${sensitiveJob.run_id}.json`)));
  assert.equal(fetchCalls, 4, "sensitive output must stop after one call");

  const requestFile = path.join(temporaryRoot, "evidence", "requests", `${job.run_id}.json`);
  await fs.appendFile(requestFile, " ", "utf8");
  await assert.rejects(
    runJobs({ apiKey: key, rootDir: temporaryRoot, jobIds: [job.run_id], hardCostUsd: 3 }),
    /Frozen request changed/,
  );
  assert.equal(fetchCalls, 4, "tampered evidence must fail before a call");

  console.log(JSON.stringify({ ok: true, simulated_calls: fetchCalls, canonical_reuse: true, concurrent_budget_enforced: true, wrong_model_blocked: true, sensitive_output_quarantined: true, tamper_blocked: true }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
