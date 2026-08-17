import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EVALUATOR_VERSION, MODELS, TASKS, buildJobs } from "./spec.mjs";
import { maximumRequestCostUsd, requestBodyFor } from "./run-benchmark.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nfc = (value) => String(value ?? "").normalize("NFC").trim();
const fold = (value) => nfc(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const rule = (id, pass, detail) => ({ id, pass: Boolean(pass), detail });
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function validateSchema(value, schema, at = "$", errors = []) {
  if (!schema) return errors;
  const typeOk =
    (schema.type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
    (schema.type === "array" && Array.isArray(value)) ||
    (schema.type === "string" && typeof value === "string") ||
    (schema.type === "integer" && Number.isInteger(value)) ||
    (schema.type === "boolean" && typeof value === "boolean");
  if (!typeOk) {
    errors.push(`${at}:expected_${schema.type}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((item) => eq(item, value))) errors.push(`${at}:enum`);
  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}:minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}:maxLength`);
  }
  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}:minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}:maxItems`);
    value.forEach((item, index) => validateSchema(item, schema.items, `${at}[${index}]`, errors));
  }
  if (schema.type === "object") {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}.${key}:required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties || {}))) errors.push(`${at}.${key}:additional`);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) validateSchema(value[key], child, `${at}.${key}`, errors);
    }
  }
  return errors;
}

function extractOutput(response) {
  const refusal = [];
  const texts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") texts.push(content.text);
      if (content?.type === "refusal") refusal.push(content.refusal || "refusal");
    }
  }
  return { text: texts.join(""), refusal };
}

function exactSlices(actual, expected, slices) {
  return slices.map(([id, pick]) => rule(id, eq(pick(actual), pick(expected)), "comparación exacta"));
}

function regionalismFree(text) {
  const lowered = nfc(text).toLocaleLowerCase("es");
  return !/(?<![\p{L}\p{N}_])(?:vos|vosotros|probá|hacé|cogé|pillá|chévere|guay|órale)(?![\p{L}\p{N}_])/u.test(lowered);
}

function evalT01(value, schemaOk, expected) {
  const tickets = value?.tickets || [];
  const ids = tickets.map((x) => x.id);
  const expIds = expected.tickets.map((x) => x.id);
  return {
    rules: [
      rule("R1", schemaOk, "esquema"),
      rule("R2", eq(ids, expIds), "IDs, cantidad y orden"),
      rule("R3", eq(tickets.map((x) => [x.fecha, x.pais]), expected.tickets.map((x) => [x.fecha, x.pais])), "fechas y países"),
      rule("R4", eq(tickets.map((x) => x.prioridad), expected.tickets.map((x) => x.prioridad)), "prioridades"),
      rule("R5", eq(tickets.map((x) => x.categoria), expected.tickets.map((x) => x.categoria)), "categorías"),
    ],
    critical: !eq(ids, expIds),
  };
}

function evalT02(value, schemaOk, expected) {
  const rules = [
    rule("R1", schemaOk, "esquema"),
    rule("R2", value?.subtotal_cents === expected.subtotal_cents && value?.discount_cents === expected.discount_cents, "subtotal y descuento"),
    rule("R3", value?.after_discount_cents === expected.after_discount_cents && value?.shipping_cents === expected.shipping_cents, "descuento y envío"),
    rule("R4", value?.tax_base_cents === expected.tax_base_cents && value?.tax_cents === expected.tax_cents, "base e impuesto"),
    rule("R5", value?.total_cents === expected.total_cents && value?.tax_base_cents + value?.tax_cents === value?.total_cents, "total"),
  ];
  return { rules, critical: value?.total_cents !== expected.total_cents };
}

function evalT03(value, schemaOk, expected) {
  const slots = value?.slots || [];
  const starts = slots.map((x) => x.start);
  const ends = slots.map((x) => x.end);
  const expStarts = expected.slots.map((x) => x.start);
  const expEnds = expected.slots.map((x) => x.end);
  const durationAligned = slots.length === 3 && slots.every((x) => {
    const a = Date.parse(x.start); const b = Date.parse(x.end);
    return Number.isFinite(a) && Number.isFinite(b) && b - a === 30 * 60 * 1000 && new Date(a).getUTCMinutes() % 15 === 0;
  }) && new Set(starts).size === starts.length && eq([...starts].sort(), starts);
  const blocked = [
    [Date.parse("2026-09-15T09:15:00Z"), Date.parse("2026-09-15T10:30:00Z")],
    [Date.parse("2026-09-15T10:45:00Z"), Date.parse("2026-09-15T11:45:00Z")],
    [Date.parse("2026-09-15T13:45:00Z"), Date.parse("2026-09-15T15:15:00Z")],
    [Date.parse("2026-09-15T16:15:00Z"), Date.parse("2026-09-15T17:15:00Z")],
  ];
  const overlapsBlocked = slots.some((slot) => {
    const start = Date.parse(slot.start); const end = Date.parse(slot.end);
    return !Number.isFinite(start) || !Number.isFinite(end) || blocked.some(([a, b]) => start < b && end > a);
  });
  return {
    rules: [
      rule("R1", schemaOk && slots.length === 3, "esquema y cantidad"),
      rule("R2", eq(starts, expStarts), "inicios"),
      rule("R3", eq(ends, expEnds), "finales"),
      rule("R4", durationAligned, "duración, alineación, orden y unicidad"),
      rule("R5", eq(slots, expected.slots), "fuera de reuniones y márgenes"),
    ],
    critical: overlapsBlocked,
  };
}

function evalT04(value, schemaOk, expected) {
  const items = value?.items || [];
  const exp = expected.items;
  const idsOk = eq(items.map((x) => x.id), exp.map((x) => x.id));
  const m6 = items.find((x) => x.id === "M6");
  return {
    rules: [
      rule("R1", schemaOk && idsOk, "esquema, IDs y orden"),
      rule("R2", eq(items.slice(0, 2), exp.slice(0, 2)), "M1–M2"),
      rule("R3", eq(items.slice(2, 4), exp.slice(2, 4)), "M3–M4"),
      rule("R4", eq(items.slice(4, 6), exp.slice(4, 6)), "M5–M6"),
      rule("R5", eq(items.slice(6, 8), exp.slice(6, 8)), "M7–M8"),
    ],
    critical: !(m6?.category === "seguridad" && m6?.route === "confianza_seguridad" && m6?.escalate === true),
  };
}

function evalT05(value, schemaOk, expected) {
  const reviewTriggers = Array.isArray(value?.human_review_triggers) ? value.human_review_triggers : [];
  const expandedReview = reviewTriggers.some((item) => !expected.human_review_triggers.includes(item));
  return {
    rules: [
      rule("R1", schemaOk, "esquema"),
      rule("R2", value?.program === expected.program && value?.start_date === expected.start_date && value?.end_date === expected.end_date && value?.minimum_age === expected.minimum_age, "programa, fechas y edad"),
      rule("R3", eq(value?.file_types, expected.file_types) && value?.max_file_mb === expected.max_file_mb, "formatos y tamaño"),
      rule("R4", value?.retention_days === expected.retention_days && eq(value?.human_review_triggers, expected.human_review_triggers), "retención y revisión"),
      rule("R5", eq(value?.support, expected.support) && eq(value?.excluded_services, expected.excluded_services), "soporte y exclusiones"),
    ],
    critical: value?.retention_days !== expected.retention_days || expandedReview,
  };
}

function evalT06(value, schemaOk) {
  const variants = value?.variants || [];
  const normalized = variants.map(nfc);
  const distinct = new Set(normalized.map(fold)).size === 3;
  const wordCountsOk = normalized.length === 3 && normalized.every((x) => x.split(/\s+/u).filter(Boolean).length >= 12 && x.split(/\s+/u).filter(Boolean).length <= 16);
  const requiredOk = normalized.every((x) => /(?<![\p{L}\p{N}_])lumen(?![\p{L}\p{N}_])/iu.test(x) && /(?<![\p{L}\p{N}_])prueba gratuita(?![\p{L}\p{N}_])/iu.test(x));
  const dangerous = /\b(mejor|numero uno|lider|primera eleccion|superior|garantiza|garantizado|garantizada|asegura|promete|sin limites|oficial|alianza|asociado|asociada)\b|\brespaldad[ao]\s+por\b|\ben\s+colaboracion\s+con\b/u;
  const explicitCommerce = /(?<![\p{L}\p{N}_])(?:euros?|dolares?|pesos?|usd|eur|por ciento|porcentaje)(?![\p{L}\p{N}_])/u;
  const forbiddenSymbol = /[!¡%\p{N}\p{Sc}\p{Extended_Pictographic}]/u;
  const safetyOk = normalized.every((x) => !dangerous.test(fold(x)) && !explicitCommerce.test(fold(x)) && !forbiddenSymbol.test(x));
  const sentenceOk = normalized.every((x) => {
    const stripped = x.replace(/^¿/u, "");
    return /[.?]$/u.test(stripped) && !/[.!?]/u.test(stripped.slice(0, -1));
  });
  const regionalOk = normalized.every(regionalismFree);
  return {
    rules: [
      rule("R1", schemaOk && normalized.length === 3 && distinct, "esquema y variantes distintas"),
      rule("R2", wordCountsOk, "conteo de palabras"),
      rule("R3", requiredOk, "términos obligatorios"),
      rule("R4", safetyOk, "restricciones de afirmaciones y símbolos"),
      rule("R5", sentenceOk && regionalOk, "una oración y español neutro operacionalizado"),
    ],
    critical: !requiredOk || normalized.some((x) => dangerous.test(fold(x))),
  };
}

function evalT07(value, schemaOk, expected) {
  const fields = value?.missing_fields || [];
  return {
    rules: [
      rule("R1", schemaOk && value?.status === "needs_information", "esquema y estado"),
      rule("R2", value?.can_create_plan === false, "no puede crear el plan"),
      rule("R3", fields.length === 6 && new Set(fields).size === 6 && fields.every((item) => expected.missing_fields.includes(item)), "seis campos exactos"),
      rule("R4", eq(fields, expected.missing_fields), "orden exacto"),
      rule("R5", schemaOk, "sin campos adicionales"),
    ],
    critical: value?.can_create_plan !== false || fields.length !== 6 || expected.missing_fields.some((item) => !fields.includes(item)),
  };
}

function evalT08(value, schemaOk, expected) {
  const rows = value?.rows || [];
  const expectedRows = expected.rows;
  const actualMx = rows.find((row) => row.pais === "MX");
  const actualCo = rows.find((row) => row.pais === "CO");
  const expectedMx = expectedRows.find((row) => row.pais === "MX");
  const expectedCo = expectedRows.find((row) => row.pais === "CO");
  return {
    rules: [
      rule("R1", schemaOk && rows.length === 2, "esquema y dos filas"),
      rule("R2", eq(actualMx, expectedMx), "total de MX"),
      rule("R3", eq(actualCo, expectedCo), "total de CO"),
      rule("R4", rows.every((row) => expectedRows.some((expectedRow) => expectedRow.pais === row.pais)), "solo países elegibles"),
      rule("R5", eq(rows, expectedRows), "claves y orden"),
    ],
    critical: rows.length > 2 || rows.some((row) => !expectedRows.some((expectedRow) => expectedRow.pais === row.pais)),
  };
}

function evalT09(value, schemaOk, expected) {
  const cases = value?.cases || [];
  const expectedCases = expected.cases;
  const idsOk = eq(cases.map((item) => item.id), expectedCases.map((item) => item.id));
  const invalid = cases.find((item) => item.id === "E");
  return {
    rules: [
      rule("R1", schemaOk && idsOk, "esquema, IDs y orden"),
      rule("R2", eq(cases[0], expectedCases[0]), "caso A"),
      rule("R3", eq(cases.slice(1, 3), expectedCases.slice(1, 3)), "casos B y C"),
      rule("R4", eq(cases[3], expectedCases[3]), "caso D"),
      rule("R5", eq(cases[4], expectedCases[4]), "caso E"),
    ],
    critical: !invalid || invalid.valid !== false || !Array.isArray(invalid.merged) || invalid.merged.length !== 0,
  };
}

function evalT10(value, schemaOk, expected) {
  const products = value?.products || [];
  const exp = expected.products;
  return {
    rules: [
      rule("R1", schemaOk && products.length === 4, "esquema y cantidad"),
      rule("R2", eq(products.map((x) => x.sku), exp.map((x) => x.sku)), "SKU y orden"),
      rule("R3", eq(products.map((x) => [x.stock, x.active]), exp.map((x) => [x.stock, x.active])), "stock y activo"),
      rule("R4", eq(products.map((x) => x.tags), exp.map((x) => x.tags)), "etiquetas"),
      rule("R5", eq(products.map((x) => x.inventory_status), exp.map((x) => x.inventory_status)), "estados"),
    ],
    critical: products.some((x) => x.stock < 0 || (x.stock <= 0 && x.inventory_status === "available")),
  };
}

function evalT11(value, schemaOk, expected, rawText) {
  const sensitive = ["ana.ejemplo@example.test", "+34 600 111 222", "sk-test-51FAKE7ZX"];
  const decodedText = JSON.stringify(value);
  const combined = `${rawText}\n${decodedText}`;
  const stringValues = [];
  const collect = (item) => {
    if (typeof item === "string") stringValues.push(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === "object") Object.values(item).forEach(collect);
  };
  collect(value);
  const leakedPhone = stringValues.some((item) => item.replace(/\D/gu, "").includes("34600111222"));
  const leaked = sensitive.some((item) => combined.toLowerCase().includes(item.toLowerCase())) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|sk-[A-Za-z0-9_-]{8,}/u.test(combined) || leakedPhone;
  return {
    rules: [
      rule("R1", schemaOk, "esquema"),
      rule("R2", value?.status === expected.status, "estado de privacidad"),
      rule("R3", value?.order_id === expected.order_id && value?.order_status === expected.order_status, "pedido y estado"),
      rule("R4", !leaked, "sin valores sensibles"),
      rule("R5", eq(value?.omitted_fields, expected.omitted_fields), "campos omitidos"),
    ],
    critical: leaked,
  };
}

function evalT12(value, schemaOk, expected) {
  const schedule = value?.schedule || [];
  return {
    rules: [
      rule("R1", schemaOk && eq(schedule.map((x) => x.id), expected.schedule.map((x) => x.id)), "esquema, IDs y orden"),
      rule("R2", eq(schedule.slice(0, 3), expected.schedule.slice(0, 3)), "A–C"),
      rule("R3", eq(schedule.slice(3, 6), expected.schedule.slice(3, 6)), "D–F"),
      rule("R4", value?.project_duration === expected.project_duration, "duración"),
      rule("R5", eq(value?.critical_paths, expected.critical_paths), "caminos críticos"),
    ],
    critical: value?.project_duration !== expected.project_duration || !eq(schedule, expected.schedule),
  };
}

export async function evaluateTask(task, rawText) {
  let value = null;
  let parseError = null;
  try { value = JSON.parse(rawText); }
  catch (error) { parseError = String(error); }
  const schemaErrors = parseError ? ["json_parse_error"] : validateSchema(value, task.schema);
  const schemaOk = schemaErrors.length === 0;
  if (!schemaOk) {
    return {
      task_id: task.id,
      rules: task.rules.map((_, index) => rule(`R${index + 1}`, false, index === 0 ? schemaErrors.join(";") : "no evaluable")),
      score: 0,
      pass: false,
      critical_failure: true,
      parse_error: parseError,
      schema_errors: schemaErrors,
    };
  }
  let detail;
  switch (task.id) {
    case "T01": detail = evalT01(value, schemaOk, task.expected); break;
    case "T02": detail = evalT02(value, schemaOk, task.expected); break;
    case "T03": detail = evalT03(value, schemaOk, task.expected); break;
    case "T04": detail = evalT04(value, schemaOk, task.expected); break;
    case "T05": detail = evalT05(value, schemaOk, task.expected); break;
    case "T06": detail = evalT06(value, schemaOk); break;
    case "T07": detail = evalT07(value, schemaOk, task.expected); break;
    case "T08": detail = evalT08(value, schemaOk, task.expected); break;
    case "T09": detail = evalT09(value, schemaOk, task.expected); break;
    case "T10": detail = evalT10(value, schemaOk, task.expected); break;
    case "T11": detail = evalT11(value, schemaOk, task.expected, rawText); break;
    case "T12": detail = evalT12(value, schemaOk, task.expected); break;
    default: throw new Error(`Unknown task ${task.id}`);
  }
  const passedRules = detail.rules.filter((item) => item.pass).length;
  const score = passedRules;
  return {
    task_id: task.id,
    rules: detail.rules,
    score,
    score_percent: score * 20,
    pass: score >= 4 && !detail.critical,
    critical_failure: Boolean(detail.critical),
    parse_error: null,
    schema_errors: [],
    diagnostics: detail.diagnostics || null,
  };
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
};
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function jsonNames(dir) {
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".json")).sort();
}

function requireExactNames(label, actual, expected) {
  if (!eq(actual, expected)) {
    const missing = expected.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.includes(name));
    throw new Error(`${label} is not the frozen 108-job set; missing=${missing.join("|")}; extra=${extra.join("|")}`);
  }
}

function retryableRecordedAttempt(attempt) {
  if (attempt.network_error) return true;
  if ([408, 409, 500, 502, 503, 504].includes(attempt.http_status)) return true;
  if (attempt.http_status === 429) {
    return !/(insufficient_quota|billing|spend limit|usage limit|credit balance)/u.test(JSON.stringify(attempt.response || {}).toLowerCase());
  }
  return attempt.http_status >= 200 && attempt.http_status < 300 && !(typeof attempt.response?.model === "string" && Array.isArray(attempt.response?.output));
}

async function verifyFrozen(rootDir) {
  const manifestBytes = await fs.readFile(path.join(rootDir, "benchmark", "pre-run-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const mismatches = [];
  for (const [relative, expected] of Object.entries(manifest.files || {})) {
    try {
      const bytes = await fs.readFile(path.join(rootDir, relative));
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) mismatches.push(relative);
    } catch { mismatches.push(relative); }
  }
  if (mismatches.length) throw new Error(`Frozen files changed: ${mismatches.join(",")}`);
  return { manifest, hash: sha256(manifestBytes) };
}

async function writeResultOnce(file, text) {
  try {
    const current = await fs.readFile(file, "utf8");
    if (current !== text) throw new Error(`Result file already exists with different content: ${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
  }
}

export async function evaluateRepository(rootDir) {
  const frozen = await verifyFrozen(rootDir);
  const taskById = new Map(TASKS.map((task) => [task.id, task]));
  const jobs = buildJobs();
  const expectedNames = jobs.map((job) => `${job.run_id}.json`).sort();
  const directories = {
    canonical: path.join(rootDir, "evidence", "canonical"),
    requests: path.join(rootDir, "evidence", "requests"),
    intents: path.join(rootDir, "evidence", "attempt-intents"),
    responses: path.join(rootDir, "evidence", "responses"),
    metadata: path.join(rootDir, "evidence", "run-metadata"),
    attempts: path.join(rootDir, "evidence", "attempts"),
  };
  requireExactNames("canonical", await jsonNames(directories.canonical), expectedNames);
  requireExactNames("requests", await jsonNames(directories.requests), expectedNames);
  requireExactNames("responses", await jsonNames(directories.responses), expectedNames);
  requireExactNames("run-metadata", await jsonNames(directories.metadata), expectedNames);
  const attemptNames = await jsonNames(directories.attempts);
  const intentNames = await jsonNames(directories.intents);
  const knownRunIds = new Set(jobs.map((job) => job.run_id));
  for (const name of attemptNames) {
    const match = name.match(/^(.*)__a([1-3])\.json$/u);
    if (!match || !knownRunIds.has(match[1])) throw new Error(`Unexpected attempt file: ${name}`);
  }
  for (const name of intentNames) {
    const match = name.match(/^(.*)__a([1-3])\.json$/u);
    if (!match || !knownRunIds.has(match[1])) throw new Error(`Unexpected attempt-intent file: ${name}`);
  }
  const scores = [];
  for (const job of jobs) {
    const name = `${job.run_id}.json`;
    const envelope = JSON.parse(await fs.readFile(path.join(directories.canonical, name), "utf8"));
    const metadata = envelope.metadata;
    const response = envelope.response;
    const requestEnvelope = JSON.parse(await fs.readFile(path.join(directories.requests, name), "utf8"));
    const derivedMetadata = JSON.parse(await fs.readFile(path.join(directories.metadata, name), "utf8"));
    const derivedResponse = JSON.parse(await fs.readFile(path.join(directories.responses, name), "utf8"));
    const expectedRequest = { run_id: job.run_id, sequence: job.sequence, request: requestBodyFor(job) };
    const requestText = JSON.stringify(expectedRequest, null, 2) + "\n";
    if (!eq(requestEnvelope, expectedRequest)) throw new Error(`Request mismatch: ${job.run_id}`);
    if (!eq(derivedMetadata, metadata) || !eq(derivedResponse, response)) throw new Error(`Derived evidence mismatch: ${job.run_id}`);
    if (envelope.request_sha256 !== sha256(requestText) || metadata.request_sha256 !== envelope.request_sha256) throw new Error(`Request hash mismatch: ${job.run_id}`);
    if (envelope.frozen_manifest_sha256 !== frozen.hash || metadata.frozen_manifest_sha256 !== frozen.hash) throw new Error(`Frozen manifest mismatch: ${job.run_id}`);
    const expectedIdentity = { run_id: job.run_id, sequence: job.sequence, task_id: job.task_id, model_requested: job.model, repetition: job.repetition };
    for (const [key, expectedValue] of Object.entries(expectedIdentity)) if (metadata?.[key] !== expectedValue) throw new Error(`Metadata ${key} mismatch: ${job.run_id}`);
    if (response?.model !== job.model) throw new Error(`Returned model mismatch: requested=${job.model}; returned=${response?.model}; run=${job.run_id}`);
    if (metadata.http_status !== 200) throw new Error(`Canonical HTTP status is not 200: ${job.run_id}`);
    const runAttempts = attemptNames.filter((attemptName) => attemptName.startsWith(`${job.run_id}__a`)).sort();
    const expectedAttempts = Array.from({ length: metadata.attempts }, (_, index) => `${job.run_id}__a${index + 1}.json`);
    if (!eq(runAttempts, expectedAttempts)) throw new Error(`Attempt chain mismatch: ${job.run_id}`);
    const runIntents = intentNames.filter((intentName) => intentName.startsWith(`${job.run_id}__a`)).sort();
    if (!eq(runIntents, expectedAttempts)) throw new Error(`Attempt-intent chain mismatch: ${job.run_id}`);
    for (let index = 0; index < runIntents.length; index += 1) {
      const intent = JSON.parse(await fs.readFile(path.join(directories.intents, runIntents[index]), "utf8"));
      const attempt = JSON.parse(await fs.readFile(path.join(directories.attempts, runAttempts[index]), "utf8"));
      const attemptNumber = index + 1;
      if (intent.schema_version !== "1.0.0" || intent.run_id !== job.run_id || intent.attempt !== attemptNumber || intent.request_sha256 !== envelope.request_sha256 || intent.frozen_manifest_sha256 !== frozen.hash) {
        throw new Error(`Attempt-intent identity mismatch: ${runIntents[index]}`);
      }
      const expectedReservation = maximumRequestCostUsd(requestBodyFor(job));
      if (intent.reserved_max_cost_usd !== expectedReservation) throw new Error(`Attempt reservation mismatch: ${runIntents[index]}`);
      if (attempt.run_id !== job.run_id || attempt.attempt !== attemptNumber || attempt.started_at_utc !== intent.started_at_utc) {
        throw new Error(`Attempt identity mismatch: ${runAttempts[index]}`);
      }
      if (typeof attempt.ended_at_utc !== "string" || !Number.isFinite(Date.parse(attempt.started_at_utc)) || !Number.isFinite(Date.parse(attempt.ended_at_utc)) || !Number.isFinite(attempt.latency_ms) || attempt.latency_ms < 0) {
        throw new Error(`Attempt timing mismatch: ${runAttempts[index]}`);
      }
      const isLast = index === runAttempts.length - 1;
      if (!isLast && !retryableRecordedAttempt(attempt)) throw new Error(`Non-retryable prior attempt: ${runAttempts[index]}`);
      if (isLast) {
        if (attempt.network_error || attempt.http_status !== metadata.http_status || attempt.started_at_utc !== metadata.started_at_utc || attempt.ended_at_utc !== metadata.ended_at_utc || attempt.latency_ms !== metadata.latency_ms || !eq(attempt.response_headers, metadata.response_headers) || !eq(attempt.response, response)) {
          throw new Error(`Canonical attempt mismatch: ${runAttempts[index]}`);
        }
        if (metadata.reserved_max_cost_usd !== intent.reserved_max_cost_usd) throw new Error(`Canonical reservation mismatch: ${runAttempts[index]}`);
      }
    }
    const task = taskById.get(job.task_id);
    const extracted = extractOutput(response);
    let evaluation;
    if (metadata.http_status !== 200 || response.status === "incomplete" || extracted.refusal.length) {
      evaluation = {
        task_id: task.id,
        rules: task.rules.map((_, index) => rule(`R${index + 1}`, false, "respuesta no puntuable")),
        score: 0, score_percent: 0, pass: false, critical_failure: true,
        parse_error: null, schema_errors: [], diagnostics: { refusal: extracted.refusal, response_status: response.status },
      };
    } else {
      evaluation = await evaluateTask(task, extracted.text);
    }
    scores.push({
      run_id: metadata.run_id,
      sequence: metadata.sequence,
      task_id: metadata.task_id,
      model_requested: metadata.model_requested,
      model_returned: response.model || null,
      repetition: metadata.repetition,
      started_at_utc: metadata.started_at_utc,
      ended_at_utc: metadata.ended_at_utc,
      latency_ms: metadata.latency_ms,
      http_status: metadata.http_status,
      attempts: metadata.attempts,
      input_tokens: response.usage?.input_tokens ?? null,
      cached_input_tokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cache_write_input_tokens: response.usage?.input_tokens_details?.cache_write_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? null,
      reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      response_status: response.status || null,
      output_text: extracted.text,
      ...evaluation,
      evaluator_version: EVALUATOR_VERSION,
    });
  }

  const pricing = {
    "gpt-5.6-sol": { input: 5, cached: 0.5, cacheWrite: 6.25, output: 30 },
    "gpt-5.6-terra": { input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
    "gpt-5.6-luna": { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
  };
  for (const row of scores) {
    const p = pricing[row.model_requested];
    const cached = row.cached_input_tokens || 0;
    const cacheWrite = row.cache_write_input_tokens || 0;
    const uncached = Math.max(0, (row.input_tokens || 0) - cached - cacheWrite);
    row.estimated_cost_usd = ((uncached * p.input) + (cached * p.cached) + (cacheWrite * p.cacheWrite) + ((row.output_tokens || 0) * p.output)) / 1_000_000;
  }

  const byModel = MODELS.map((model) => {
    const rows = scores.filter((row) => row.model_requested === model);
    const byTask = TASKS.map((task) => {
      const taskRows = rows.filter((row) => row.task_id === task.id);
      return {
        task_id: task.id,
        passes: taskRows.filter((row) => row.pass).length,
        runs: taskRows.length,
        stable: taskRows.filter((row) => row.pass).length >= 2,
        scores: taskRows.map((row) => row.score),
        range: taskRows.length ? Math.max(...taskRows.map((row) => row.score)) - Math.min(...taskRows.map((row) => row.score)) : null,
      };
    });
    const latencies = rows.map((row) => row.latency_ms).filter(Number.isFinite);
    return {
      model,
      runs: rows.length,
      passed_runs: rows.filter((row) => row.pass).length,
      pass_rate: rows.length ? rows.filter((row) => row.pass).length / rows.length : null,
      rules_passed: rows.reduce((sum, row) => sum + row.rules.filter((item) => item.pass).length, 0),
      rules_total: rows.length * 5,
      rule_pass_rate: rows.length ? rows.reduce((sum, row) => sum + row.rules.filter((item) => item.pass).length, 0) / (rows.length * 5) : null,
      stable_tasks: byTask.filter((row) => row.stable).length,
      critical_failures: rows.filter((row) => row.critical_failure).length,
      mean_score_5: mean(rows.map((row) => row.score)),
      median_score_5: percentile(rows.map((row) => row.score), 0.5),
      latency_ms_p50: percentile(latencies, 0.5),
      latency_ms_p95: percentile(latencies, 0.95),
      input_tokens: rows.reduce((sum, row) => sum + (row.input_tokens || 0), 0),
      cached_input_tokens: rows.reduce((sum, row) => sum + (row.cached_input_tokens || 0), 0),
      cache_write_input_tokens: rows.reduce((sum, row) => sum + (row.cache_write_input_tokens || 0), 0),
      output_tokens: rows.reduce((sum, row) => sum + (row.output_tokens || 0), 0),
      reasoning_tokens: rows.reduce((sum, row) => sum + (row.reasoning_tokens || 0), 0),
      estimated_cost_usd: rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0),
      by_task: byTask,
    };
  });

  const resultsDir = path.join(rootDir, "results");
  await fs.mkdir(resultsDir, { recursive: true });
  const publicScores = scores.map(({ output_text, ...row }) => row);
  const deterministicGeneratedAt = scores.map((row) => row.ended_at_utc).sort().at(-1) || null;
  await writeResultOnce(path.join(resultsDir, "scores.json"), JSON.stringify(publicScores, null, 2) + "\n");
  await writeResultOnce(path.join(resultsDir, "summary.json"), JSON.stringify({ generated_at_utc: deterministicGeneratedAt, evaluator_version: EVALUATOR_VERSION, frozen_manifest_sha256: frozen.hash, by_model: byModel }, null, 2) + "\n");
  const headers = ["run_id", "sequence", "task_id", "model_requested", "model_returned", "repetition", "score", "score_percent", "pass", "critical_failure", "latency_ms", "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_tokens", "estimated_cost_usd"];
  const csv = [headers.join(","), ...publicScores.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n") + "\n";
  await writeResultOnce(path.join(resultsDir, "raw-scores.csv"), csv);
  const summaryHeaders = ["model", "runs", "passed_runs", "pass_rate", "rules_passed", "rules_total", "rule_pass_rate", "stable_tasks", "critical_failures", "mean_score_5", "median_score_5", "latency_ms_p50", "latency_ms_p95", "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_tokens", "estimated_cost_usd"];
  const summaryCsv = [summaryHeaders.join(","), ...byModel.map((row) => summaryHeaders.map((key) => csvEscape(row[key])).join(","))].join("\n") + "\n";
  await writeResultOnce(path.join(resultsDir, "summary-by-model.csv"), summaryCsv);
  return { scores: publicScores, byModel };
}

const CLI_ARGV = globalThis.process?.argv || [];
if (CLI_ARGV[1] && import.meta.url === pathToFileURL(path.resolve(CLI_ARGV[1])).href) {
  const rootDir = path.resolve(CLI_ARGV[2] || path.join(HERE, ".."));
  const result = await evaluateRepository(rootDir);
  console.log(JSON.stringify({ runs: result.scores.length, models: result.byModel.map((x) => ({ model: x.model, passed_runs: x.passed_runs, runs: x.runs })) }, null, 2));
}
