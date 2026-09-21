import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from "../scripts/lib/contract.mjs";
import { ENDPOINT, evaluate, preflight, readBounded, resolveCredential } from "../scripts/lib/runtime.mjs";
import { request, response } from "./fixtures/requests.mjs";
const token = "synthetic-test-token";
const mock = (value = response()) => async () => Response.json(value);
const call = (fetchImpl, value = request(), extra = {}) => evaluate(value, { token, fetchImpl, ...extra });

test("makes exactly one fixed-endpoint call, excludes policy, disables redirects and preserves options", async () => {
  const input = request(); input.providerOptions = { gateway: { zeroDataRetention: true } };
  let calls = 0, capturedSignal;
  const result = await call(async (url, options) => {
    calls++; capturedSignal = options.signal;
    assert.equal(url, ENDPOINT); assert.equal(options.redirect, "error"); assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const body = JSON.parse(options.body);
    assert.equal(Object.hasOwn(body, "policy"), false);
    assert.deepEqual(body.providerOptions, input.providerOptions);
    return Response.json(response());
  }, input);
  assert.equal(calls, 1); assert.equal(result.status, "ready"); assert.equal(result.metrics.attempts, 1);
  assert.equal(result.metrics.questionCount, 3); assert.ok(result.metrics.elapsedMs >= 0);
  assert.equal(capturedSignal.aborted, true);
});
test("invalid input is rejected before credentials or fetch", async () => {
  let calls = 0;
  await assert.rejects(evaluate({}, { token: "\ninvalid credential", fetchImpl: async () => { calls++; } }), { code: "INVALID_INPUT" });
  assert.equal(calls, 0);
});
test("invalid timeout is rejected before fetch", async () => {
  for (const timeoutMs of [0, -1, 60_001, 1.5, NaN]) await assert.rejects(call(mock(), request(), { timeoutMs }), { code: "INVALID_CONFIG" });
});
test("missing policy produces a valid abstaining envelope", async () => {
  const input = request(); delete input.policy;
  const result = await call(mock(), input);
  assert.equal(result.status, "abstain"); assert.equal(result.decisions.route.reason, "policy_required");
  assert.equal(result.answers.route.choice, "bug");
});
test("preflight is content-free and reports policy coverage and wire bytes", () => {
  const input = request(); delete input.policy.route;
  const output = preflight(input);
  assert.equal(output.network, false); assert.equal(output.questionsWithoutPolicy, 1);
  assert.deepEqual(output.questionTypes, ["choice", "boolean", "score"]);
  assert.equal(JSON.stringify(output).includes(input.state.report), false);
  assert.ok(output.requestBytes > 0);
});
test("preflight bounds the actual wire envelope, including the fixed model", () => {
  const input = request(); delete input.policy;
  input.state = "";
  const overhead = Buffer.byteLength(JSON.stringify(input));
  input.state = "x".repeat(MAX_INPUT_BYTES - overhead);
  assert.throws(() => preflight(input), { code: "INPUT_TOO_LARGE" });
});
for (const status of [400, 401, 403, 408, 429, 500, 502, 503, 504, 529]) test(`HTTP ${status}: safe error, no retry, no error-body read`, async () => {
  let calls = 0, reads = 0, signal;
  const auth = [401, 403].includes(status), retryable = ![400, 401, 403].includes(status);
  await assert.rejects(call(async (_url, options) => {
    calls++; signal = options.signal;
    return { ok: false, status, get body() { reads++; throw new Error("private-state"); } };
  }), (error) => {
    assert.equal(error.code, auth ? "AUTH_REJECTED" : "PROVIDER_HTTP_ERROR");
    assert.equal(error.exitCode, auth ? 2 : 1);
    assert.deepEqual(error.details, { httpStatus: status, retryable });
    assert.equal(error.message.includes("private-state"), false); return true;
  });
  assert.equal(calls, 1); assert.equal(reads, 0); assert.equal(signal.aborted, true);
});
test("HTTP 200 error envelope, invalid JSON and missing body fail closed", async () => {
  for (const fetchImpl of [mock({ error: "private-data" }), async () => new Response("<html>private-data</html>"), async () => new Response(null)]) {
    await assert.rejects(call(fetchImpl), (error) => { assert.equal(error.code, "INVALID_RESPONSE"); assert.equal(error.message.includes("private-data"), false); return true; });
  }
});
test("schema failure is atomic even when other answers were ready", async () => {
  const data = response(); data.answers.clarity.score = 100;
  await assert.rejects(call(mock(data)), { code: "INVALID_RESPONSE" });
});
test("transport exception details never leak", async () => {
  await assert.rejects(call(async () => { throw new Error(`secret ${token}\x1b[31m`); }), (error) => {
    assert.equal(error.code, "REQUEST_FAILED"); assert.equal(error.message.includes(token), false); return true;
  });
});
test("deadline covers a stalled fetch even when it ignores abort", async () => {
  const start = performance.now();
  await assert.rejects(call(() => new Promise(() => {}), request(), { timeoutMs: 20 }), { code: "TIMEOUT" });
  assert.ok(performance.now() - start < 2_000);
});
test("deadline covers a stalled body and cleanup does not hang", async () => {
  const start = performance.now();
  const body = new ReadableStream({ pull: () => new Promise(() => {}) });
  await assert.rejects(call(async () => new Response(body), request(), { timeoutMs: 20 }), { code: "TIMEOUT" });
  assert.ok(performance.now() - start < 2_000);
});
test("body cancellation on oversized response happens before unbounded buffering", async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(64_000)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(call(async () => new Response(body)), { code: "RESPONSE_TOO_LARGE" });
  assert.equal(pulls, 5); assert.equal(cancelled, true);
});
test("oversized content-length is rejected without reading the body", async () => {
  await assert.rejects(call(async () => ({ ok: true, headers: new Headers({ "content-length": String(MAX_OUTPUT_BYTES + 1) }), get body() { throw new Error("body should not be read"); } })), { code: "RESPONSE_TOO_LARGE" });
});
test("malformed response UTF-8 is not silently replaced", async () => {
  await assert.rejects(call(async () => new Response(new Uint8Array([0xff]))), { code: "INVALID_RESPONSE" });
});
test("bounded reader counts bytes, preserves split UTF-8 and closes oversize input", async () => {
  const bytes = Buffer.from("😀é");
  const text = await readBounded(Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]), 6, new AbortController().signal);
  assert.equal(text, "😀é");
  const input = Readable.from([bytes]);
  await assert.rejects(readBounded(input, 5, new AbortController().signal), { code: "INPUT_TOO_LARGE" });
  assert.equal(input.destroyed, true);
});
test("bounded reader accepts exact limit and rejects invalid UTF-8 input", async () => {
  assert.equal(await readBounded(Readable.from(["abc"]), 3, new AbortController().signal), "abc");
  await assert.rejects(readBounded(Readable.from([Buffer.from([0xff])]), 3, new AbortController().signal), { code: "INVALID_INPUT" });
});
test("already-aborted reader fails with a controlled timeout", async () => {
  const control = new AbortController(); control.abort();
  await assert.rejects(readBounded(Readable.from(["abc"]), 3, control.signal), { code: "TIMEOUT" });
});
test("telemetry is allowlisted: no echoed state, routing details, warnings or model text", async () => {
  const data = response();
  data.usage = { inputTokens: 20, outputTokens: -1, totalTokens: 21, prompt: "private-data" };
  data.warnings = ["private-data", { message: token }];
  data.providerMetadata = { other: { secret: token }, gateway: { cost: "0.00012", marketCost: 0.1, surchargeCost: -1, gatewayCost: "private-data", generationId: "gen_synthetic-123", routing: { secret: token } } };
  data.answers.route.reason = "private-data";
  const result = await call(mock(data));
  assert.deepEqual(result.usage, { inputTokens: 20, totalTokens: 21 });
  assert.deepEqual(result.providerMetadata, { gateway: { cost: "0.00012", marketCost: 0.1, generationId: "gen_synthetic-123" } });
  assert.equal(result.warningCount, 2);
  assert.equal(JSON.stringify(result).includes("private-data"), false); assert.equal(JSON.stringify(result).includes(token), false);
});
test("missing optional metadata is fine and unsafe metadata is omitted", async () => {
  const data = response(); data.usage = { inputTokens: "20" };
  data.providerMetadata = { gateway: { generationId: "private data", cost: "1\nsecret" } };
  const result = await call(mock(data));
  assert.equal(result.usage, undefined); assert.equal(result.providerMetadata, undefined); assert.equal(result.warningCount, 0);
});
test("environment precedence, trimming and blank fallback never invoke Keychain unnecessarily", () => {
  const run = () => { throw new Error("must not run"); };
  assert.deepEqual(resolveCredential({ platform: "darwin", env: { AI_GATEWAY_API_KEY: ` ${token} `, VERCEL_OIDC_TOKEN: "other" }, run }), { token, source: "AI_GATEWAY_API_KEY" });
  assert.equal(resolveCredential({ platform: "linux", env: { AI_GATEWAY_API_KEY: " ", VERCEL_OIDC_TOKEN: token }, run }).source, "VERCEL_OIDC_TOKEN");
});
test("no Keychain access on non-macOS; missing credentials use exit 2", () => {
  assert.throws(() => resolveCredential({ platform: "linux", env: {}, run: () => { throw new Error("must not run"); } }), { code: "AUTH_REQUIRED", exitCode: 2 });
});
test("Keychain uses an absolute binary, bounded process and source-only diagnostics", () => {
  const result = resolveCredential({ platform: "darwin", env: { USER: "test-user" }, run: (command, args, options) => {
    assert.equal(command, "/usr/bin/security"); assert.equal(args[2], "test-user"); assert.ok(args.includes("codex-fast-decision"));
    assert.equal(options.timeout, 5_000); assert.equal(options.maxBuffer, 16_384);
    return { status: 0, stdout: `${token}\n` };
  } });
  assert.deepEqual(result, { token, source: "macOS Keychain: codex-fast-decision" });
});
test("Keychain misses and timeouts do not reveal local errors", () => {
  for (const result of [{ status: 1, stderr: token }, { status: null, error: new Error(token) }, { status: 0, stdout: " " }]) {
    assert.throws(() => resolveCredential({ platform: "darwin", env: { USERNAME: "fallback" }, run: () => result }), { code: "AUTH_REQUIRED" });
  }
});
for (const badToken of ["has\nnewline", "x".repeat(16_385), "white space", "\x1b[31msecret"]) test("rejects malformed bearer tokens without echo", () => {
  assert.throws(() => resolveCredential({ env: { AI_GATEWAY_API_KEY: badToken, VERCEL_OIDC_TOKEN: token }, platform: "linux" }), (error) => {
    assert.equal(error.code, "INVALID_CREDENTIAL"); assert.equal(error.message.includes(badToken), false); return true;
  });
});
