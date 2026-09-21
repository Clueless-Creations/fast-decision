#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate";
const MODEL = "typesafe-ai/jev";
const MAX_INPUT_BYTES = 128_000;
const MAX_OUTPUT_BYTES = 256_000;
const TIMEOUT_MS = 15_000;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function safeProviderDetail(result) {
  const error = result && typeof result === "object" ? result.error : undefined;
  if (typeof error === "string") return error.slice(0, 300).replace(/[\r\n]+/g, " ");
  if (!error || typeof error !== "object") return "no provider detail";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  const detail = [code, message].filter(Boolean).join(": ");
  return (detail || "no provider detail").slice(0, 300).replace(/[\r\n]+/g, " ");
}

function keychainToken() {
  if (process.platform !== "darwin") return "";
  const account = process.env.USER || process.env.USERNAME || "";
  const result = spawnSync(
    "security",
    ["find-generic-password", "-a", account, "-s", "codex-fast-decision", "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return result.status === 0 ? result.stdout.trim() : "";
}

const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || keychainToken();
if (!token) fail("Fast decision needs AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, or the macOS Keychain item codex-fast-decision.", 2);

const input = fs.readFileSync(0, "utf8");
if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) fail("Fast decision input is too large.");

let request;
try {
  request = JSON.parse(input);
} catch {
  fail("Fast decision input must be one JSON object on stdin.");
}

if (!request || typeof request !== "object" || Array.isArray(request)) fail("Fast decision input must be a JSON object.");
if (!("state" in request) || !request.questions || typeof request.questions !== "object" || Array.isArray(request.questions)) {
  fail("Fast decision input requires state and questions.");
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      state: request.state,
      questions: request.questions,
      ...(request.providerOptions ? { providerOptions: request.providerOptions } : {}),
    }),
    signal: controller.signal,
  });

  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_OUTPUT_BYTES) fail("Fast decision response is too large.");

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    fail(`Fast decision provider returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) fail(`Fast decision provider returned HTTP ${response.status}: ${safeProviderDetail(result)}`);
  process.stdout.write(JSON.stringify({
    model: result.model,
    answers: result.answers,
    providerMetadata: result.providerMetadata,
    usage: result.usage,
    warnings: result.warnings,
  }, null, 2) + "\n");
} catch (error) {
  if (error?.name === "AbortError") fail("Fast decision timed out.");
  fail("Fast decision request failed.");
} finally {
  clearTimeout(timer);
}
