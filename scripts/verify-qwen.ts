import { creativeModel } from "../src/lib/ai/provider";
import { planCreative } from "../src/lib/ai/creative-planner";
import { getPreset } from "../src/lib/presets";

/** Live check of the configured local model. Reports the real outcome; `--require` fails unless Qwen answered. */
async function main() {
  const provider = creativeModel();
  const health = await provider.health(true);
  console.log(JSON.stringify({ health }, null, 2));
  const preset = getPreset("movie-trailer")!;
  const runs = [];
  for (const run of ["first", "second-distinct"]) {
    const started = Date.now();
    const plan = await planCreative(preset, run === "first" ? "dramatic" : "energetic", [undefined, undefined, undefined], undefined, provider);
    runs.push({ run, source: plan.source, model: plan.model, modelLatencyMs: plan.latencyMs, wallMs: Date.now() - started, fallbackReason: plan.fallbackReason, hook: plan.patch.hook, shotOrder: plan.patch.shotOrder, grade: plan.patch.grade });
  }
  console.log(JSON.stringify(runs, null, 2));
  if (process.argv.includes("--require") && runs.some((run) => run.source !== "qwen")) process.exitCode = 1;
}
void main();
