import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "./fixtures/requests.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "scripts/decide.mjs");
const stub = pathToFileURL(join(root, "test/fixtures/mock-fetch.mjs")).href;
const env = { ...process.env, AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", NODE_OPTIONS: "" };
const run = (args = [], input = JSON.stringify(request()), extraEnv = {}, entry = cli) => spawnSync(process.execPath, [entry, ...args], {
  input, encoding: "utf8", env: { ...env, ...extraEnv }, cwd: tmpdir(), timeout: 5_000, maxBuffer: 1_000_000,
});
const liveMock = (mode, input = request()) => spawnSync(process.execPath, ["--import", stub, cli], {
  input: JSON.stringify(input), encoding: "utf8", env: { ...env, AI_GATEWAY_API_KEY: "synthetic-test-token", FAST_DECISION_TEST_MODE: mode }, timeout: 5_000,
});
test("help works without credentials or stdin", () => {
  const result = run(["--help"], "");
  assert.equal(result.status, 0); assert.match(result.stdout, /--validate/); assert.equal(result.stderr, "");
  assert.equal(run(["-h"], "").status, 0);
});
test("unknown flags and extra arguments fail predictably", () => {
  for (const args of [["--other"], ["--help", "--doctor"]]) {
    const result = run(args, ""); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_ARGUMENT");
  }
});
test("offline validation runs without auth and does not disclose state", () => {
  const result = run(["--validate"]);
  assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).network, false); assert.equal(result.stdout.includes(request().state.report), false);
});
test("invalid JSON and schema are reported before any credential lookup", () => {
  for (const input of ["", "sensitive-not-json", "{}", "{}\n{}", "[]"]) {
    const result = run([], input, { AI_GATEWAY_API_KEY: "bad token" });
    assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_INPUT");
    assert.equal(result.stderr.includes("sensitive-not-json"), false);
  }
});
test("invalid UTF-8 and oversized stdin fail with empty stdout", () => {
  for (const [input, code] of [[Buffer.from([0xff]), "INVALID_INPUT"], ["x".repeat(128_001), "INPUT_TOO_LARGE"]]) {
    const result = run(["--validate"], input); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, code);
  }
});
test("doctor exposes credential source, never the value or a false authentication claim", () => {
  const result = run(["--doctor"], "", { AI_GATEWAY_API_KEY: "synthetic-test-token" });
  assert.equal(result.status, 0);
  const diagnostic = JSON.parse(result.stdout);
  assert.equal(diagnostic.credentialSource, "AI_GATEWAY_API_KEY"); assert.equal(diagnostic.authenticationVerified, false);
  assert.equal(diagnostic.network, false); assert.equal(result.stdout.includes("synthetic-test-token"), false);
});
test("doctor with malformed credential returns stable JSON error and exit 2", () => {
  const result = run(["--doctor"], "", { AI_GATEWAY_API_KEY: "bad token" });
  assert.equal(result.status, 2); assert.equal(result.stdout, ""); assert.equal(JSON.parse(result.stderr).error.code, "INVALID_CREDENTIAL");
});
test("actual CLI: ready result is one JSON document, exit 0 and no stderr", () => {
  const result = liveMock("ready");
  assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.equal(JSON.parse(result.stdout).status, "ready");
});
test("actual CLI: no policy emits answers but abstains with exit 3", () => {
  const input = request(); delete input.policy;
  const result = liveMock("ready", input);
  assert.equal(result.status, 3); assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).status, "abstain");
  assert.equal(JSON.parse(result.stdout).answers.route.choice, "bug");
});
for (const [mode, exit, code] of [["bad", 1, "INVALID_RESPONSE"], ["http", 1, "PROVIDER_HTTP_ERROR"], ["auth", 2, "AUTH_REJECTED"]]) {
  test(`actual CLI: ${mode} error uses exit ${exit}, no partial answer and no upstream leak`, () => {
    const result = liveMock(mode);
    assert.equal(result.status, exit); assert.equal(result.stdout, ""); assert.equal(JSON.parse(result.stderr).error.code, code);
    assert.equal(result.stderr.includes("sensitive-upstream-state"), false);
  });
}
test("copied scripts directory works from another working directory without node_modules", () => {
  const directory = mkdtempSync(join(tmpdir(), "fast-decision-test-"));
  try {
    cpSync(join(root, "scripts"), join(directory, "scripts"), { recursive: true });
    const result = run(["--validate"], JSON.stringify(request()), {}, join(directory, "scripts/decide.mjs"));
    assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).valid, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("every shipped JSON example validates offline", () => {
  const directory = join(root, "examples");
  const examples = readdirSync(directory).filter((name) => name.endsWith(".json"));
  assert.ok(examples.length >= 2, "ship at least routing and batched examples");
  for (const name of examples) {
    const result = run(["--validate"], readFileSync(join(directory, name), "utf8"));
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});
test("documentation JSON is syntactically valid and skill heredocs validate", () => {
  for (const name of ["README.md", "SKILL.md", "docs/contract.md"]) {
    const text = readFileSync(join(root, name), "utf8");
    for (const [, json] of text.matchAll(/```json\n([\s\S]*?)\n```/gu)) assert.doesNotThrow(() => JSON.parse(json), name);
    for (const [, json] of text.matchAll(/<<'JSON'\n([\s\S]*?)\n\s*JSON/gu)) {
      const result = run(["--validate"], json.trim());
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    }
  }
});
