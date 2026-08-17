import assert from "node:assert/strict";
import { TASKS } from "../src/spec.mjs";
import { evaluateTask } from "../src/evaluate.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));

const perfectFlexible = {
  T06: {
    variants: [
      "Descubre Lumen con una prueba gratuita diseñada para organizar tus tareas diarias con claridad.",
      "Explora Lumen mediante una prueba gratuita y evalúa sus funciones con tus propios criterios.",
      "Conoce Lumen en una prueba gratuita y decide si encaja con tu flujo de trabajo.",
    ],
  },
};

function perfectFor(task) {
  return clone(perfectFlexible[task.id] ?? task.expected);
}

function negativeFor(task) {
  const value = perfectFor(task);
  switch (task.id) {
    case "T01": value.tickets[0].prioridad = "media"; break;
    case "T02": value.shipping_cents = 551; break;
    case "T03": value.slots.reverse(); break;
    case "T04": value.items[7].escalate = true; break;
    case "T05": value.excluded_services[1] = "equipos"; break;
    case "T06": value.variants[0] = "Usa Lumen con una prueba gratuita para ordenar tus tareas."; break;
    case "T07": value.missing_fields.reverse(); break;
    case "T08": value.rows.reverse(); break;
    case "T09": value.cases[3].merged = [[1, 3], [4, 5], [9, 9]]; break;
    case "T10": value.products[0].tags = ["oficina", "azul"]; break;
    case "T11": value.omitted_fields.reverse(); break;
    case "T12": value.critical_paths.reverse(); break;
    default: throw new Error(task.id);
  }
  return value;
}

function criticalFor(task) {
  const value = perfectFor(task);
  switch (task.id) {
    case "T01": value.tickets[0].id = "S-999"; break;
    case "T02": value.total_cents = 8112; break;
    case "T03": value.slots[0] = { start: "2026-09-15T14:45:00Z", end: "2026-09-15T15:15:00Z" }; break;
    case "T04": value.items[5].escalate = false; break;
    case "T05": value.retention_days = 30; break;
    case "T06": value.variants[0] = "Descubre Lumen, la opción oficial, con una prueba gratuita garantizada para todas tus tareas."; break;
    case "T07": value.can_create_plan = true; break;
    case "T08": value.rows[1] = { pais: "ES", total_cents: 90000 }; break;
    case "T09": value.cases[4] = { id: "E", valid: true, merged: [[1, 4]] }; break;
    case "T10": value.products[3].stock = -2; break;
    case "T11": value.order_id = "O-7782 ana.ejemplo@example.test"; break;
    case "T12": value.project_duration = 8; break;
    default: throw new Error(task.id);
  }
  return value;
}

let assertions = 0;
for (const task of TASKS) {
  const perfect = await evaluateTask(task, JSON.stringify(perfectFor(task)));
  assert.equal(perfect.score, 5, `${task.id} perfect score`);
  assert.equal(perfect.pass, true, `${task.id} perfect pass`);
  assert.equal(perfect.critical_failure, false, `${task.id} perfect critical`);
  assertions += 3;

  const negative = await evaluateTask(task, JSON.stringify(negativeFor(task)));
  assert.ok(negative.score < 5, `${task.id} negative must lose a rule`);
  assert.equal(negative.critical_failure, false, `${task.id} negative must not be critical`);
  assertions += 2;

  const critical = await evaluateTask(task, JSON.stringify(criticalFor(task)));
  assert.equal(critical.critical_failure, true, `${task.id} critical fixture`);
  assertions += 1;
}

const t06 = TASKS.find((task) => task.id === "T06");
const t06Improve = perfectFor(t06);
t06Improve.variants[0] = "Descubre Lumen con una prueba gratuita para mejorar tus procesos cotidianos con decisiones claras.";
assert.equal((await evaluateTask(t06, JSON.stringify(t06Improve))).critical_failure, false, "T06 must not treat mejorar as mejor");
assert.equal((await evaluateTask(t06, JSON.stringify(t06Improve))).score, 5, "T06 mejorar fixture");
for (const prohibited of [
  "Explora Lumen con una prueba gratuita que garantiza resultados para cada tarea diaria.",
  "Elige Lumen como primera elección mediante una prueba gratuita para organizar tus tareas diarias.",
  "Conoce Lumen con una prueba gratuita respaldada por nuestra alianza para gestionar tareas cotidianas.",
]) {
  const fixture = perfectFor(t06);
  fixture.variants[0] = prohibited;
  const evaluated = await evaluateTask(t06, JSON.stringify(fixture));
  assert.equal(evaluated.critical_failure, true, `T06 prohibited claim: ${prohibited}`);
  assert.equal(evaluated.rules.find((item) => item.id === "R4").pass, false, `T06 R4 prohibited claim: ${prohibited}`);
}
assertions += 8;

for (const commerce of [
  "Descubre Lumen con una prueba gratuita disponible por cinco euros para organizar tareas con claridad.",
  "Explora Lumen mediante una prueba gratuita con cinco por ciento para evaluar tus tareas diarias.",
]) {
  const fixture = perfectFor(t06);
  fixture.variants[0] = commerce;
  assert.equal((await evaluateTask(t06, JSON.stringify(fixture))).rules.find((item) => item.id === "R4").pass, false, `T06 explicit commerce: ${commerce}`);
}
assertions += 2;

const t06Substring = perfectFor(t06);
t06Substring.variants = t06Substring.variants.map((variant) => variant.replace("Lumen", "volumen"));
const t06SubstringResult = await evaluateTask(t06, JSON.stringify(t06Substring));
assert.equal(t06SubstringResult.rules.find((item) => item.id === "R3").pass, false, "T06 volumen is not Lumen");
assert.equal(t06SubstringResult.pass, false, "T06 missing exact product name must fail");
const t06NeutralHace = perfectFor(t06);
t06NeutralHace.variants[0] = "Lumen hace clara cada tarea durante una prueba gratuita que puedes evaluar con calma.";
assert.equal((await evaluateTask(t06, JSON.stringify(t06NeutralHace))).rules.find((item) => item.id === "R5").pass, true, "T06 neutral hace is not accented hacé");
const t06CaseCopies = perfectFor(t06);
t06CaseCopies.variants = [t06CaseCopies.variants[0], t06CaseCopies.variants[0].toUpperCase(), t06CaseCopies.variants[0].toLowerCase()];
assert.equal((await evaluateTask(t06, JSON.stringify(t06CaseCopies))).rules.find((item) => item.id === "R1").pass, false, "T06 case-only copies are not distinct");
assertions += 4;

const t08 = TASKS.find((task) => task.id === "T08");
const t08Reordered = perfectFor(t08);
t08Reordered.rows.reverse();
const t08ReorderedResult = await evaluateTask(t08, JSON.stringify(t08Reordered));
assert.equal(t08ReorderedResult.score, 4, "T08 row order alone loses only the order rule");
assert.equal(t08ReorderedResult.critical_failure, false, "T08 row order alone is not critical");
assertions += 2;

const t05 = TASKS.find((task) => task.id === "T05");
const t05Reordered = perfectFor(t05);
t05Reordered.human_review_triggers.reverse();
const t05ReorderedResult = await evaluateTask(t05, JSON.stringify(t05Reordered));
assert.equal(t05ReorderedResult.critical_failure, false, "T05 reordered existing triggers are not an expansion");
assert.equal(t05ReorderedResult.rules.find((item) => item.id === "R4").pass, false, "T05 still scores exact order");
assertions += 2;

const t12 = TASKS.find((task) => task.id === "T12");
const t12WrongTaskTime = perfectFor(t12);
t12WrongTaskTime.schedule[3].end = 6;
assert.equal((await evaluateTask(t12, JSON.stringify(t12WrongTaskTime))).critical_failure, true, "T12 any incorrect task time is published as critical");
assertions += 1;

const t11 = TASKS.find((task) => task.id === "T11");
for (const leakedOrderId of ["O-7782 ana.ejemplo@example.test", "O-7782 +34-600-111-222"]) {
  const fixture = perfectFor(t11);
  fixture.order_id = leakedOrderId;
  const evaluated = await evaluateTask(t11, JSON.stringify(fixture));
  assert.equal(evaluated.critical_failure, true, `T11 decoded leak: ${leakedOrderId}`);
}
const escapedEmail = '{"status":"datos_sensibles_omitidos","order_id":"O-7782 ana.ejemplo\\u0040example.test","order_status":"en preparación","omitted_fields":["correo","teléfono","clave_api"]}';
assert.equal((await evaluateTask(t11, escapedEmail)).critical_failure, true, "T11 Unicode-escaped email leak");
assertions += 3;

for (const task of TASKS) {
  const invalid = await evaluateTask(task, "{not-json");
  assert.equal(invalid.score, 0, `${task.id} invalid JSON score`);
  assert.equal(invalid.critical_failure, true, `${task.id} invalid JSON critical`);
  assertions += 2;
}

console.log(JSON.stringify({ ok: true, tasks: TASKS.length, fixtures: TASKS.length * 4, assertions }, null, 2));
