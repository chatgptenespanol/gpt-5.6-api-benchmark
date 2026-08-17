import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import { COMMON_INSTRUCTIONS, REQUEST_CONFIG, TASKS, buildJobs } from "./spec.mjs";

const taskById = new Map(TASKS.map((task) => [task.id, task]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function selectedHeaders(headers) {
  const allow = ["x-request-id", "openai-processing-ms", "openai-version", "retry-after", "content-type"];
  return Object.fromEntries(allow.map((name) => [name, headers.get(name)]).filter(([, value]) => value !== null));
}

function outputText(response) {
  const texts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  return texts.join("");
}

const pricing = {
  "gpt-5.6-sol": { input: 5, cached: 0.5, cacheWrite: 6.25, output: 30 },
  "gpt-5.6-terra": { input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
};

export function estimateCostUsd(response, model) {
  const usage = response?.usage || {};
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens || 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const p = pricing[model];
  const uncached = Math.max(0, input - cached - cacheWrite);
  return ((uncached * p.input) + (cached * p.cached) + (cacheWrite * p.cacheWrite) + (output * p.output)) / 1_000_000;
}

export function maximumRequestCostUsd(body) {
  const p = pricing[body.model];
  // A token cannot consume fewer than one encoded byte. Charging every input
  // byte at the higher cache-write rate is intentionally conservative.
  const estimatedInputTokensUpperBound = Buffer.byteLength(JSON.stringify(body), "utf8");
  return ((estimatedInputTokensUpperBound * p.cacheWrite) + (body.max_output_tokens * p.output)) / 1_000_000;
}

function redactProviderString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED_API_KEY]")
    .replace(/\borg-[A-Za-z0-9_-]+\b/gu, "[REDACTED_ORG]")
    .replace(/\bproj[_-][A-Za-z0-9_-]+\b/gu, "[REDACTED_PROJECT]");
}

function sanitizeErrorPayload(value) {
  if (!value || typeof value !== "object") return { message: redactProviderString(value) };
  const error = value.error && typeof value.error === "object" ? value.error : value;
  return {
    error: {
      message: redactProviderString(error.message || "Provider error"),
      type: error.type == null ? null : redactProviderString(error.type),
      param: error.param == null ? null : redactProviderString(error.param),
      code: error.code == null ? null : redactProviderString(error.code),
    },
  };
}

function publicResponseProjection(value) {
  const allowed = ["id", "object", "created_at", "status", "incomplete_details", "max_output_tokens", "model", "output", "reasoning", "service_tier", "store", "text", "tools", "usage"];
  return Object.fromEntries(allowed.filter((key) => key in (value || {})).map((key) => [key, value[key]]));
}

function unexpectedSensitiveFindings(value, apiKey) {
  const text = JSON.stringify(value || {});
  const findings = [];
  if (text.includes(apiKey)) findings.push("active_api_key");
  if (/Bearer\s+[A-Za-z0-9._-]+/gu.test(text)) findings.push("authorization_header");
  if (/\bsk-(?!test-)[A-Za-z0-9_-]{20,}\b/gu.test(text)) findings.push("secret_like_token");
  if (/\b(?:org-|proj[_-]|acct_)[A-Za-z0-9_-]+\b/gu.test(text)) findings.push("account_like_identifier");
  for (const match of text.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu)) {
    if (!match[0].toLowerCase().endsWith("@example.test")) findings.push("unexpected_email");
  }
  for (const match of text.matchAll(/\+\d[\d\s().-]{7,}\d/gu)) {
    if (match[0].replace(/\D/gu, "") !== "34600111222") findings.push("unexpected_phone");
  }
  return [...new Set(findings)];
}

export function requestBodyFor(job) {
  const task = taskById.get(job.task_id);
  return {
    model: job.model,
    input: [
      { role: "system", content: COMMON_INSTRUCTIONS },
      { role: "user", content: task.prompt },
    ],
    reasoning: REQUEST_CONFIG.reasoning,
    max_output_tokens: REQUEST_CONFIG.max_output_tokens,
    store: REQUEST_CONFIG.store,
    stream: REQUEST_CONFIG.stream,
    tools: REQUEST_CONFIG.tools,
    text: {
      format: {
        type: "json_schema",
        name: `${task.id.toLowerCase()}_response`,
        strict: true,
        schema: task.schema,
      },
    },
  };
}

async function ensureDirs(rootDir) {
  for (const relative of ["evidence/requests", "evidence/attempt-intents", "evidence/attempts", "evidence/canonical", "evidence/responses", "evidence/run-metadata", "evidence/locks"]) {
    await fs.mkdir(path.join(rootDir, relative), { recursive: true });
  }
}

async function pathExists(file) {
  try { await fs.access(file); return true; }
  catch { return false; }
}

async function writeAtomicExclusive(file, text) {
  if (await pathExists(file)) throw new Error(`Append-only target already exists: ${file}`);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try { await fs.link(temporary, file); }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
  await fs.unlink(temporary);
}

async function ensureDerivedFile(file, value) {
  const expected = JSON.stringify(value, null, 2) + "\n";
  if (await pathExists(file)) {
    const current = await fs.readFile(file, "utf8");
    if (current !== expected) throw new Error(`Derived file disagrees with canonical envelope: ${file}`);
    return;
  }
  await writeAtomicExclusive(file, expected);
}

async function materializeCanonical(rootDir, envelope, job) {
  if (envelope.metadata?.run_id !== job.run_id) throw new Error(`Canonical run_id mismatch for ${job.run_id}`);
  await ensureDerivedFile(path.join(rootDir, "evidence", "responses", `${job.run_id}.json`), envelope.response);
  await ensureDerivedFile(path.join(rootDir, "evidence", "run-metadata", `${job.run_id}.json`), envelope.metadata);
}

async function currentCost(rootDir) {
  const dir = path.join(rootDir, "evidence", "canonical");
  let names = [];
  try { names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json")); }
  catch { return 0; }
  let total = 0;
  for (const name of names) {
    const envelope = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
    const response = envelope.response;
    const model = name.split("__")[1];
    if (pricing[model]) total += estimateCostUsd(response, model);
  }
  return total;
}

async function currentReservedExposure(rootDir) {
  const dir = path.join(rootDir, "evidence", "attempt-intents");
  let names = [];
  try { names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json")); }
  catch { return 0; }
  let total = 0;
  for (const name of names) {
    const intent = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
    const reserved = Number(intent.reserved_max_cost_usd);
    if (!Number.isFinite(reserved) || reserved < 0) throw new Error(`Invalid persistent cost reservation: ${name}`);
    total += reserved;
  }
  return total;
}

async function reserveAttemptBudget({ rootDir, intentFile, intent, hardLimitUsd }) {
  const budgetLock = path.join(rootDir, "evidence", "locks", "__budget__");
  try { await fs.mkdir(budgetLock); }
  catch (error) { throw new Error(`Exclusive budget lock unavailable: ${error.code || error}`); }
  try {
    const persistentExposure = await currentReservedExposure(rootDir);
    if (persistentExposure + intent.reserved_max_cost_usd > hardLimitUsd) {
      throw new Error(`Pre-call cost guard would be exceeded before ${intent.run_id}`);
    }
    await writeAtomicExclusive(intentFile, JSON.stringify(intent, null, 2) + "\n");
    return persistentExposure + intent.reserved_max_cost_usd;
  } finally {
    await fs.rmdir(budgetLock).catch(() => {});
  }
}

async function verifyFrozenInputs(rootDir) {
  const manifestPath = path.join(rootDir, "benchmark", "pre-run-manifest.json");
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const files = manifest?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("Frozen manifest has no file inventory");
  const required = [
    "package.json", "protocol.md", "environment/runtime.json",
    "src/spec.mjs", "src/run-benchmark.mjs", "src/evaluate.mjs",
    "src/build-spec.mjs", "src/freeze.mjs", "src/verify-package.mjs",
    "src/run-cli.mjs", "tests/evaluator.test.mjs",
    "benchmark/benchmark-manifest.json", "benchmark/jobs.json",
    ...Object.keys(pricing).map((model) => `configs/${model}.json`),
    ...TASKS.flatMap((task) => [
      `benchmark/tasks/${task.id}.txt`,
      `benchmark/schemas/${task.id}.schema.json`,
      `benchmark/expected/${task.id}.json`,
      `benchmark/rules/${task.id}.json`,
    ]),
  ];
  const missing = required.filter((relative) => !(relative in files));
  if (missing.length) throw new Error(`Frozen manifest is incomplete: ${missing.join(",")}`);
  if (manifest.canonical_jobs !== buildJobs().length) throw new Error("Frozen manifest job count mismatch");
  const changed = [];
  for (const [relative, expected] of Object.entries(files)) {
    try {
      const bytes = await fs.readFile(path.join(rootDir, relative));
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) changed.push(relative);
    } catch { changed.push(relative); }
  }
  if (changed.length) throw new Error(`Frozen inputs changed: ${changed.join(",")}`);
  return { manifest, hash: sha256(manifestBytes) };
}

function retryable429(body) {
  const text = JSON.stringify(body || {}).toLowerCase();
  return !/(insufficient_quota|billing|spend limit|usage limit|credit balance)/u.test(text);
}

function retryDelayMs(response, attempt) {
  const headerSeconds = Number(response?.headers?.get("retry-after"));
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return Math.ceil(headerSeconds * 1000);
  const base = attempt === 1 ? 1000 : 2000;
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(base * jitter);
}

function validateCanonicalEnvelope(envelope, job, requestHash, frozenManifestHash) {
  const metadata = envelope?.metadata || {};
  const expected = {
    run_id: job.run_id,
    sequence: job.sequence,
    task_id: job.task_id,
    model_requested: job.model,
    repetition: job.repetition,
  };
  for (const [key, value] of Object.entries(expected)) if (metadata[key] !== value) throw new Error(`Canonical ${key} mismatch for ${job.run_id}`);
  if (envelope.request_sha256 !== requestHash) throw new Error(`Canonical request hash mismatch for ${job.run_id}`);
  if (envelope.frozen_manifest_sha256 !== frozenManifestHash) throw new Error(`Canonical protocol hash mismatch for ${job.run_id}`);
  if (envelope.response?.model !== job.model) throw new Error(`Returned model mismatch for ${job.run_id}: ${envelope.response?.model}`);
}

async function runOneUnlocked({ apiKey, rootDir, job, requestTimeoutMs, costGuard }) {
  const canonicalFile = path.join(rootDir, "evidence", "canonical", `${job.run_id}.json`);
  const responseFile = path.join(rootDir, "evidence", "responses", `${job.run_id}.json`);
  const metadataFile = path.join(rootDir, "evidence", "run-metadata", `${job.run_id}.json`);
  const requestFile = path.join(rootDir, "evidence", "requests", `${job.run_id}.json`);
  const body = requestBodyFor(job);
  const requestText = JSON.stringify({ run_id: job.run_id, sequence: job.sequence, request: body }, null, 2) + "\n";
  const requestHash = sha256(requestText);
  const frozenManifestBytes = await fs.readFile(path.join(rootDir, "benchmark", "pre-run-manifest.json"));
  const frozenManifestHash = sha256(frozenManifestBytes);
  if (await pathExists(canonicalFile)) {
    const envelope = JSON.parse(await fs.readFile(canonicalFile, "utf8"));
    if (!(await pathExists(requestFile))) throw new Error(`Canonical output has no request file: ${job.run_id}`);
    const existingRequest = await fs.readFile(requestFile, "utf8");
    if (existingRequest !== requestText) throw new Error(`Frozen request changed for ${job.run_id}`);
    validateCanonicalEnvelope(envelope, job, requestHash, frozenManifestHash);
    await materializeCanonical(rootDir, envelope, job);
    return { run_id: job.run_id, skipped: true, reason: "canonical output already exists" };
  }
  if (await pathExists(responseFile) || await pathExists(metadataFile)) throw new Error(`Partial derived state without canonical envelope: ${job.run_id}`);

  if (await pathExists(requestFile)) {
    const existing = await fs.readFile(requestFile, "utf8");
    if (existing !== requestText) throw new Error(`Frozen request changed for ${job.run_id}`);
    const attemptNames = (await fs.readdir(path.join(rootDir, "evidence", "attempts"))).filter((name) => name.startsWith(`${job.run_id}__a`));
    const intentNames = (await fs.readdir(path.join(rootDir, "evidence", "attempt-intents"))).filter((name) => name.startsWith(`${job.run_id}__a`));
    if (attemptNames.length || intentNames.length) throw new Error(`Partial attempt history requires manual audit before resume: ${job.run_id}`);
  } else {
    await writeAtomicExclusive(requestFile, requestText);
  }
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const reservedMaxCostUsd = maximumRequestCostUsd(body);
    const startedAt = new Date().toISOString();
    const attemptIntent = {
      schema_version: "1.0.0",
      run_id: job.run_id,
      attempt,
      started_at_utc: startedAt,
      request_sha256: requestHash,
      frozen_manifest_sha256: frozenManifestHash,
      reserved_max_cost_usd: reservedMaxCostUsd,
    };
    costGuard.exposure_usd = await reserveAttemptBudget({
      rootDir,
      intentFile: path.join(rootDir, "evidence", "attempt-intents", `${job.run_id}__a${attempt}.json`),
      intent: attemptIntent,
      hardLimitUsd: costGuard.hard_limit_usd,
    });
    const monotonicStart = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response = null;
    let parsed = null;
    let parsedPublic = null;
    let jsonOk = false;
    let networkError = null;
    let securityFindings = [];
    try {
      response = await fetch(REQUEST_CONFIG.endpoint, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        parsed = JSON.parse(text);
        jsonOk = parsed && typeof parsed === "object";
        if (response.ok) {
          const projection = publicResponseProjection(parsed);
          securityFindings = unexpectedSensitiveFindings(projection, apiKey);
          parsedPublic = securityFindings.length
            ? { security_redaction: true, findings: securityFindings, body_sha256: sha256(text), body_bytes: Buffer.byteLength(text, "utf8") }
            : projection;
        } else parsedPublic = sanitizeErrorPayload(parsed);
      } catch {
        parsedPublic = { transport_parse_error: true, body_sha256: sha256(text), body_bytes: Buffer.byteLength(text, "utf8") };
      }
    } catch (error) {
      networkError = { name: error?.name || "Error", message: String(error?.message || error).slice(0, 500) };
      parsedPublic = { network_error: { name: networkError.name, message: redactProviderString(networkError.message) } };
    } finally {
      clearTimeout(timeout);
    }
    const endedAt = new Date().toISOString();
    const latencyMs = Math.round(performance.now() - monotonicStart);
    const httpStatus = response?.status ?? null;
    const headers = response ? selectedHeaders(response.headers) : {};
    const attemptRecord = {
      run_id: job.run_id, attempt, started_at_utc: startedAt, ended_at_utc: endedAt,
      latency_ms: latencyMs, http_status: httpStatus, response_headers: headers,
      network_error: networkError ? { name: networkError.name, message: redactProviderString(networkError.message) } : null,
      response: parsedPublic,
    };
    attempts.push({ attempt, http_status: httpStatus, latency_ms: latencyMs, network_error: networkError, response_headers: headers });
    await writeAtomicExclusive(path.join(rootDir, "evidence", "attempts", `${job.run_id}__a${attempt}.json`), JSON.stringify(attemptRecord, null, 2) + "\n");

    if (securityFindings.length) {
      const error = new Error(`Unexpected sensitive pattern detected and quarantined for ${job.run_id}`);
      error.run = { job, attempts, final: parsedPublic };
      throw error;
    }
    const usableApiResponse = response?.ok && jsonOk && typeof parsed?.model === "string" && Array.isArray(parsed?.output);
    if (usableApiResponse && parsed.model !== job.model) {
      const error = new Error(`Returned model differs from requested ID for ${job.run_id}: ${parsed.model}`);
      error.run = { job, attempts, final: parsedPublic };
      throw error;
    }
    if (usableApiResponse) {
      const canonicalResponse = publicResponseProjection(parsed);
      const metadata = {
        run_id: job.run_id, sequence: job.sequence, task_id: job.task_id,
        model_requested: job.model, repetition: job.repetition,
        started_at_utc: startedAt, ended_at_utc: endedAt, latency_ms: latencyMs,
        http_status: httpStatus, attempts: attempt, response_headers: headers,
        response_status: canonicalResponse?.status || null,
        output_text_chars: outputText(canonicalResponse).length,
        estimated_cost_usd: estimateCostUsd(canonicalResponse, job.model),
        reserved_max_cost_usd: reservedMaxCostUsd,
        request_sha256: requestHash,
        frozen_manifest_sha256: frozenManifestHash,
      };
      const envelope = {
        schema_version: "1.0.0",
        request_sha256: requestHash,
        frozen_manifest_sha256: frozenManifestHash,
        metadata,
        response: canonicalResponse,
      };
      await writeAtomicExclusive(canonicalFile, JSON.stringify(envelope, null, 2) + "\n");
      await materializeCanonical(rootDir, envelope, job);
      return { run_id: job.run_id, skipped: false, http_status: httpStatus, response_status: canonicalResponse?.status || null, attempts: attempt, latency_ms: latencyMs, estimated_cost_usd: metadata.estimated_cost_usd };
    }

    const retryable = networkError || (response?.ok && !usableApiResponse) || [408, 409, 500, 502, 503, 504].includes(httpStatus) || (httpStatus === 429 && retryable429(parsedPublic));
    if (!retryable || attempt === 3) {
      const error = new Error(`No canonical response for ${job.run_id}; status=${httpStatus}; attempt=${attempt}`);
      error.run = { job, attempts, final: parsedPublic };
      throw error;
    }
    await sleep(retryDelayMs(response, attempt));
  }
  throw new Error(`Unreachable: ${job.run_id}`);
}

async function runOne(args) {
  if (!/^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+__r[1-3]$/u.test(args.job.run_id)) throw new Error(`Unsafe run_id: ${args.job.run_id}`);
  const lockDir = path.join(args.rootDir, "evidence", "locks", args.job.run_id);
  try { await fs.mkdir(lockDir); }
  catch (error) { throw new Error(`Exclusive job lock unavailable for ${args.job.run_id}: ${error.code || error}`); }
  try { return await runOneUnlocked(args); }
  finally { await fs.rmdir(lockDir).catch(() => {}); }
}

export async function runJobs({ apiKey, rootDir, jobIds = null, maxJobs = null, hardCostUsd = 3, requestTimeoutMs = 120000 }) {
  if (typeof apiKey !== "string" || apiKey.length < 80) throw new Error("A valid in-memory API key is required");
  if (!Number.isFinite(hardCostUsd) || hardCostUsd <= 0) throw new Error("hardCostUsd must be a positive finite number");
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("requestTimeoutMs must be a positive finite number");
  if (maxJobs !== null && (!Number.isInteger(maxJobs) || maxJobs < 0)) throw new Error("maxJobs must be a non-negative integer or null");
  await verifyFrozenInputs(rootDir);
  await ensureDirs(rootDir);
  let jobs = buildJobs();
  if (jobIds) {
    if (!Array.isArray(jobIds)) throw new Error("jobIds must be an array or null");
    const known = new Set(jobs.map((job) => job.run_id));
    const unknown = [...new Set(jobIds)].filter((runId) => !known.has(runId));
    if (unknown.length) throw new Error(`Unknown jobIds: ${unknown.join(",")}`);
    const wanted = new Set(jobIds);
    jobs = jobs.filter((job) => wanted.has(job.run_id));
  }
  if (maxJobs !== null) jobs = jobs.slice(0, maxJobs);
  const results = [];
  let cost = await currentCost(rootDir);
  const persistentExposure = await currentReservedExposure(rootDir);
  const costGuard = { hard_limit_usd: hardCostUsd, exposure_usd: persistentExposure };
  if (persistentExposure >= hardCostUsd) throw new Error(`Persistent cost reservation reached before run: ${persistentExposure}`);
  for (const job of jobs) {
    if (costGuard.exposure_usd >= hardCostUsd) throw new Error(`Cost guard reached: ${costGuard.exposure_usd}`);
    const result = await runOne({ apiKey, rootDir, job, requestTimeoutMs, costGuard });
    results.push(result);
    if (!result.skipped) cost += result.estimated_cost_usd || 0;
  }
  return { requested: jobs.length, completed: results.filter((x) => !x.skipped).length, skipped: results.filter((x) => x.skipped).length, estimated_cost_usd: cost, maximum_cost_exposure_usd: costGuard.exposure_usd, results };
}
