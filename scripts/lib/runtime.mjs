import { spawnSync } from "node:child_process";
import { DecisionError, MODEL, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, validateRequest, gatewayBody, validateAnswers, applyPolicy } from "./contract.mjs";

export const ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate";
export const TIMEOUT_MS = 15_000;
const timeoutError = () => new DecisionError("TIMEOUT", "Fast decision timed out.", 1, { retryable: true });

// Race the deadline as well as aborting fetch, so a stalled reader cannot hang the CLI.
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(timeoutError());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

/** Count bytes while reading, before allocating the whole input or response. */
export async function readBounded(stream, maxBytes, signal, side = "INPUT") {
  const chunks = [];
  let size = 0;
  let completed = false;
  const iterator = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      const { value, done } = await abortable(iterator.next(), signal);
      if (done) { completed = true; break; }
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) throw new DecisionError(`${side}_TOO_LARGE`, `${side === "INPUT" ? "Input" : "Response"} exceeds ${maxBytes} bytes.`);
      chunks.push(chunk);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    } catch {
      throw new DecisionError(`INVALID_${side}`, `${side === "INPUT" ? "Input" : "Response"} must be valid UTF-8.`);
    }
  } finally {
    if (!completed) {
      stream.destroy?.();
      // Some transports never settle their pending read. Do not await cleanup.
      Promise.resolve(iterator.return?.()).catch(() => {});
    }
  }
}

export function resolveCredential({ env = process.env, platform = process.platform, run = spawnSync } = {}) {
  for (const name of ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) {
    if (typeof env[name] === "string" && env[name].trim()) return { token: validateToken(env[name]), source: name };
  }
  if (platform === "darwin") {
    const result = run("/usr/bin/security", ["find-generic-password", "-a", env.USER || env.USERNAME || "", "-s", "codex-fast-decision", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, maxBuffer: 16_384, killSignal: "SIGKILL" });
    if (result.status === 0 && result.stdout?.trim()) return { token: validateToken(result.stdout), source: "macOS Keychain: codex-fast-decision" };
  }
  throw new DecisionError("AUTH_REQUIRED", "Configure AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, or macOS Keychain item codex-fast-decision locally. Do not paste credentials into chat.", 2);
}

function validateToken(value) {
  if (typeof value !== "string" || value.trim().length > 16_384 || !/^[A-Za-z0-9._~+\/-]+=*$/u.test(value.trim())) {
    throw new DecisionError("INVALID_CREDENTIAL", "The configured credential is not a valid bearer token. Replace it locally.", 2);
  }
  return value.trim();
}

function telemetry(result) {
  const output = {};
  if (result.usage && typeof result.usage === "object") {
    const usage = {};
    for (const field of ["inputTokens", "outputTokens", "totalTokens"]) {
      const value = result.usage[field];
      if (Number.isSafeInteger(value) && value >= 0) usage[field] = value;
    }
    if (Object.keys(usage).length) output.usage = usage;
  }
  const metadata = result.providerMetadata?.gateway;
  if (metadata && typeof metadata === "object") {
    const gateway = {};
    for (const field of ["cost", "marketCost", "surchargeCost", "gatewayCost"]) {
      const value = metadata[field];
      if ((typeof value === "string" && value.length <= 64 && /^\d+(?:\.\d+)?$/u.test(value))
        || (typeof value === "number" && Number.isFinite(value) && value >= 0)) gateway[field] = value;
    }
    if (typeof metadata.generationId === "string" && /^gen_[A-Za-z0-9_-]{1,128}$/u.test(metadata.generationId)) gateway.generationId = metadata.generationId;
    if (Object.keys(gateway).length) output.providerMetadata = { gateway };
  }
  output.warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
  return output;
}

export function preflight(value) {
  const request = validateRequest(value);
  const bytes = Buffer.byteLength(JSON.stringify(gatewayBody(request)));
  if (bytes > MAX_INPUT_BYTES) throw new DecisionError("INPUT_TOO_LARGE", "Gateway request exceeds 128000 bytes.");
  return { schemaVersion: "fast-decision/preflight/v1", valid: true, model: MODEL,
    questionCount: Object.keys(request.questions).length,
    questionTypes: [...new Set(Object.values(request.questions).map((q) => q.type))],
    questionsWithoutPolicy: Object.keys(request.questions).filter((id) => !request.policy || !Object.hasOwn(request.policy, id)).length,
    requestBytes: bytes, network: false };
}

/** One paid request at most. Inject fetch/token for tests or server-side reuse. */
export async function evaluate(value, { fetchImpl = globalThis.fetch, token, timeoutMs = TIMEOUT_MS } = {}) {
  const request = validateRequest(value);
  const summary = preflight(request);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new DecisionError("INVALID_CONFIG", "timeoutMs must be an integer from 1 to 60000.");
  const credential = token === undefined ? resolveCredential().token : validateToken(token);
  const body = JSON.stringify(gatewayBody(request));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await abortable(fetchImpl(ENDPOINT, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", Accept: "application/json" },
      body, signal: controller.signal,
    }), controller.signal);
    if (!response.ok) {
      // Never echo provider errors: they may reflect prompts, credentials or terminal escapes.
      const retryable = [408, 429, 500, 502, 503, 504, 529].includes(response.status);
      const auth = response.status === 401 || response.status === 403;
      throw new DecisionError(auth ? "AUTH_REJECTED" : "PROVIDER_HTTP_ERROR",
        auth ? "Gateway rejected authentication or access. Check local credentials and Gateway permissions."
          : `Gateway returned HTTP ${response.status}. Inspect the Gateway dashboard privately.`, auth ? 2 : 1,
        { httpStatus: response.status, retryable });
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_OUTPUT_BYTES) throw new DecisionError("RESPONSE_TOO_LARGE", "Response exceeds 256000 bytes.");
    if (!response.body) throw new DecisionError("INVALID_RESPONSE", "Gateway returned an empty response.");
    const raw = await readBounded(response.body, MAX_OUTPUT_BYTES, controller.signal, "RESPONSE");
    let result;
    try { result = JSON.parse(raw); } catch { throw new DecisionError("INVALID_RESPONSE", "Gateway returned invalid JSON."); }
    const answers = validateAnswers(request, result);
    const decisions = applyPolicy(request, answers);
    return { schemaVersion: "fast-decision/v1", status: Object.values(decisions).every((d) => d.status === "ready") ? "ready" : "abstain",
      model: MODEL, answers, decisions, ...telemetry(result),
      metrics: { elapsedMs: Math.round(performance.now() - started), requestBytes: summary.requestBytes,
        questionCount: summary.questionCount, attempts: 1 } };
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    if (controller.signal.aborted || error?.name === "AbortError") throw timeoutError();
    throw new DecisionError("REQUEST_FAILED", "Gateway request failed. Check network access; redirects are not followed.", 1, { retryable: true });
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}
