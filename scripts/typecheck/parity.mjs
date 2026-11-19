import { dirname, relative } from "node:path";
import {
  byCode,
  codesOf,
  effectDiagnostics,
  plainCodes,
  readProjects,
  typeScriptCodes,
} from "./checkers.mjs";

const TSC_EFFECT_PREFIX = "TS377";

/** @typedef {{ diagnostics?: { code: number | string }[], typescriptDiagnostics?: { code: string }[] }} EffectReport */

/** @param {number | null} status */
const verdict = (status) => (status === 0 ? "ok" : "failed");

/**
 * @param {string[]} left
 * @param {string[]} right
 */
const same = (left, right) => left.join(",") === right.join(",");

/** @param {EffectReport} report */
const effectCodesOf = (report) =>
  [
    ...(report.diagnostics ?? []).map((diagnostic) => `TS${String(diagnostic.code).padStart(6, "0")}`),
    ...(report.typescriptDiagnostics ?? []).map((diagnostic) => `TS${diagnostic.code}`),
  ].sort(byCode);

let mismatched = false;
const projects = readProjects();
for (const config of projects) {
  const name = relative(process.cwd(), dirname(config));
  const effect = effectDiagnostics(config);
  const tsc = typeScriptCodes(config);
  const plain = plainCodes(config);

  const effectCodes = effectCodesOf(JSON.parse(effect.output.slice(effect.output.indexOf("{")) || "{}"));
  const tscCodes = codesOf(tsc.output);
  const effectFree = codesOf(effect.output).filter((code) => !code.startsWith(TSC_EFFECT_PREFIX));
  const plainEffectFree = codesOf(plain.output).filter((code) => !code.startsWith(TSC_EFFECT_PREFIX));

  const verdictAgrees = verdict(effect.status) === verdict(tsc.status);
  const tscEffectOnly = tscCodes.length > 0 && tscCodes.every((code) => code.startsWith(TSC_EFFECT_PREFIX));
  const plainExpected = tscEffectOnly ? "ok" : verdict(tsc.status);
  const plainVerdictAgrees = verdict(plain.status) === plainExpected;
  const codesAgree = same([...new Set(effectCodes)], tscCodes);
  const plainAgree = same(effectFree, plainEffectFree);

  const ok = verdictAgrees && plainVerdictAgrees && codesAgree && plainAgree;
  if (!ok) {
    mismatched = true;
  }
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!verdictAgrees) {
    console.log(`  effect-tsrs ${verdict(effect.status)}, patched tsc ${verdict(tsc.status)}`);
  }
  if (!plainVerdictAgrees) {
    console.log(`  plain tsrs ${verdict(plain.status)}, expected ${plainExpected}`);
  }
  if (!codesAgree) {
    console.log(
      `  codes: effect-tsrs ${effectCodes.join(" ") || "none"}; tsc ${tscCodes.join(" ") || "none"}`,
    );
  }
  if (!plainAgree) {
    console.log(
      `  codes without Effect: effect-tsrs ${effectFree.join(" ") || "none"}; plain tsrs ${plainEffectFree.join(" ") || "none"}`,
    );
  }
}

console.log(`parity compared ${projects.length} projects${mismatched ? "" : "; the checkers agree"}.`);
process.exit(mismatched ? 1 : 0);
