#!/usr/bin/env node
import { DecisionError, MODEL, MAX_INPUT_BYTES } from "./lib/contract.mjs";
import { evaluate, preflight, readBounded, resolveCredential, TIMEOUT_MS } from "./lib/runtime.mjs";

const HELP = `Fast decision: bounded Jev judgments via Vercel AI Gateway.

Usage:
  node scripts/decide.mjs < request.json              Evaluate (one external call)
  node scripts/decide.mjs --validate < request.json   Validate locally, no auth/network
  node scripts/decide.mjs --doctor                    Check local credentials, no network
  node scripts/decide.mjs --help                      Show this help

Input: {state, questions, policy?, providerOptions?}
Questions: choice, boolean, score. Gateway uses boolean, not noul.
No policy means abstain. Read SKILL.md and docs/contract.md before acting.
Exit codes: 0 ready/offline success; 1 invalid input/provider/network;
            2 authentication; 3 valid answers requiring host review.
JSON results go to stdout; JSON errors go to stderr. Credentials stay local.
`;

function emit(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--help", "-h", "--validate", "--doctor"].includes(args[0]))) {
    throw new DecisionError("INVALID_ARGUMENT", "Use --help, --validate, --doctor, or no arguments. Supply JSON on stdin.");
  }
  if (["--help", "-h"].includes(args[0])) { process.stdout.write(HELP); return; }
  if (args[0] === "--doctor") {
    const { source } = resolveCredential();
    emit({ schemaVersion: "fast-decision/doctor/v1", credentialDetected: true, credentialSource: source,
      authenticationVerified: false, model: MODEL, node: process.versions.node, network: false });
    return;
  }
  if (process.stdin.isTTY) throw new DecisionError("INPUT_REQUIRED", "Provide one JSON request on stdin. Use --help for examples.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw;
  try { raw = await readBounded(process.stdin, MAX_INPUT_BYTES, controller.signal); }
  finally { clearTimeout(timer); }
  let request;
  try { request = JSON.parse(raw); } catch { throw new DecisionError("INVALID_INPUT", "Input must be one JSON object on stdin."); }
  if (args[0] === "--validate") { emit(preflight(request)); return; }
  const result = await evaluate(request);
  emit(result);
  if (result.status === "abstain") process.exitCode = 3;
}

// Do not print exception stacks, request data, or upstream error bodies.
main().catch((error) => {
  const known = error instanceof DecisionError;
  process.stderr.write(`${JSON.stringify({ error: {
    code: known ? error.code : "INTERNAL_ERROR",
    message: known ? error.message : "Fast decision failed without exposing diagnostic data.",
    retryable: false, ...(known ? error.details : {}),
  } })}\n`);
  process.exitCode = known ? error.exitCode : 1;
});
