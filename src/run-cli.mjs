import path from "node:path";
import { runJobs } from "./run-benchmark.mjs";

const apiKey = process.env.OPENAI_API_KEY;
const rootDir = path.resolve(process.argv[2] || ".");

try {
  const result = await runJobs({ apiKey, rootDir, hardCostUsd: 3 });
  console.log(JSON.stringify({
    requested: result.requested,
    completed: result.completed,
    skipped: result.skipped,
    estimated_cost_usd: result.estimated_cost_usd,
  }, null, 2));
} catch (error) {
  console.error(`Benchmark stopped safely: ${error?.message || error}`);
  process.exitCode = 1;
}
