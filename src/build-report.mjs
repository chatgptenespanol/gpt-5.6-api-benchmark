import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summary = JSON.parse(await fs.readFile(path.join(root, "results", "summary.json"), "utf8"));
const reportDir = path.join(root, "reports");
await fs.mkdir(reportDir, { recursive: true });

async function writeOnce(file, text) {
  try {
    const current = await fs.readFile(file, "utf8");
    if (current !== text) throw new Error(`Existing generated artifact differs: ${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
  }
}

const pct = (value) => `${(value * 100).toFixed(1)} %`;
const money = (value) => `$${value.toFixed(4)}`;
const rows = summary.by_model;
const table = [
  "| Modelo | Salidas aprobadas | Reglas cumplidas | Tareas estables | Fallos críticos | Latencia p50 | Coste estimado |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...rows.map((row) => `| \`${row.model}\` | ${row.passed_runs}/${row.runs} (${pct(row.pass_rate)}) | ${row.rules_passed}/${row.rules_total} (${pct(row.rule_pass_rate)}) | ${row.stable_tasks}/12 | ${row.critical_failures} | ${row.latency_ms_p50} ms | ${money(row.estimated_cost_usd)} |`),
].join("\n");
const markdown = `# Resultados fechados\n\nFecha y hora final de la ejecución: \`${summary.generated_at_utc}\`  \nEvaluador: \`${summary.evaluator_version}\`  \nManifest congelado: \`${summary.frozen_manifest_sha256}\`\n\n${table}\n\nEstas métricas describen únicamente las 12 tareas, tres repeticiones y configuración publicadas. La latencia y el coste no intervienen en la puntuación de calidad. Consulte \`LIMITATIONS.md\` antes de citar diferencias.\n`;
await writeOnce(path.join(reportDir, "results.md"), markdown);

const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const colors = ["#6D4AFF", "#1677FF", "#0A9B72"];
const cards = rows.map((row, index) => {
  const x = 80 + index * 370;
  const qualityWidth = Math.round(270 * row.rule_pass_rate);
  const passWidth = Math.round(270 * row.pass_rate);
  const model = row.model.replace("gpt-5.6-", "");
  return `<g transform="translate(${x} 0)">
    <rect x="0" y="190" width="330" height="330" rx="24" fill="#FFFFFF" stroke="#DDE3EA"/>
    <circle cx="38" cy="235" r="9" fill="${colors[index]}"/>
    <text x="58" y="244" class="model">${escapeXml(model)}</text>
    <text x="30" y="300" class="label">Reglas cumplidas</text>
    <text x="300" y="300" text-anchor="end" class="value">${escapeXml(pct(row.rule_pass_rate))}</text>
    <rect x="30" y="320" width="270" height="14" rx="7" fill="#EEF1F5"/>
    <rect x="30" y="320" width="${qualityWidth}" height="14" rx="7" fill="${colors[index]}"/>
    <text x="30" y="385" class="label">Salidas aprobadas</text>
    <text x="300" y="385" text-anchor="end" class="value">${row.passed_runs}/${row.runs}</text>
    <rect x="30" y="405" width="270" height="14" rx="7" fill="#EEF1F5"/>
    <rect x="30" y="405" width="${passWidth}" height="14" rx="7" fill="${colors[index]}"/>
    <text x="30" y="470" class="small">Tareas estables: ${row.stable_tasks}/12 · Fallos críticos: ${row.critical_failures}</text>
  </g>`;
}).join("\n");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">
  <title id="title">Resultados del benchmark público GPT-5.6</title>
  <desc id="desc">Comparación de reglas cumplidas, salidas aprobadas, tareas estables y fallos críticos para Sol, Terra y Luna.</desc>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #172033; }
    .headline { font-size: 38px; font-weight: 700; }
    .subtitle { font-size: 19px; fill: #596579; }
    .model { font-size: 27px; font-weight: 700; text-transform: capitalize; }
    .label { font-size: 17px; fill: #596579; }
    .value { font-size: 18px; font-weight: 700; }
    .small { font-size: 14px; fill: #596579; }
    .foot { font-size: 15px; fill: #69758A; }
  </style>
  <rect width="1200" height="675" fill="#F7F9FC"/>
  <text x="600" y="80" text-anchor="middle" class="headline">Benchmark público GPT-5.6</text>
  <text x="600" y="120" text-anchor="middle" class="subtitle">12 tareas sintéticas en español neutro · 3 repeticiones por modelo</text>
  ${cards}
  <text x="600" y="590" text-anchor="middle" class="foot">Resultados fechados; no demuestran superioridad universal. Calidad sin latencia ni coste.</text>
  <text x="600" y="620" text-anchor="middle" class="foot">chatgpt-gratis.chat · 17 de agosto de 2026</text>
</svg>\n`;
await writeOnce(path.join(reportDir, "gpt56-benchmark-results.svg"), svg);
console.log(JSON.stringify({ ok: true, models: rows.length, report: "reports/results.md", chart: "reports/gpt56-benchmark-results.svg" }, null, 2));
