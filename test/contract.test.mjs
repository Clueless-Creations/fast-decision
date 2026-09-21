import test from "node:test";
import assert from "node:assert/strict";
import { DecisionError, MAX_INPUT_BYTES, validateRequest, gatewayBody, validateAnswers, applyPolicy } from "../scripts/lib/contract.mjs";
import { request, response, oneChoice } from "./fixtures/requests.mjs";
const rejectsInput = (value, code = "INVALID_INPUT") => assert.throws(() => validateRequest(value), { name: "DecisionError", code });
const rejectsAnswer = (mutate) => { const result = response(); mutate(result); assert.throws(() => validateAnswers(request(), result), { code: "INVALID_RESPONSE" }); };
const decision = (mutateRequest, mutateResponse = () => {}) => {
  const input = request(), result = response();
  mutateRequest(input); mutateResponse(result);
  return applyPolicy(validateRequest(input), validateAnswers(input, result));
};

test("valid mixed request is detached and policy is never sent to Gateway", () => {
  const input = request(), copy = validateRequest(input);
  assert.deepEqual(copy, input); copy.state.report = "changed";
  assert.notEqual(copy.state.report, input.state.report);
  assert.equal(Object.hasOwn(gatewayBody(copy), "policy"), false);
});
test("supports structured descriptions, null choices, boolean criteria and explicit privacy options", () => {
  const input = request();
  input.questions.route.instructions = { rule: "Choose the best match" };
  input.questions.route.criteria.idea = null;
  input.questions.clarity.criteria[0] = ["No useful details"];
  input.questions.reproduction.criteria = { true: "Repeatable steps exist", false: { missing: "steps" } };
  input.providerOptions = { gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } };
  assert.deepEqual(gatewayBody(validateRequest(input)).providerOptions, input.providerOptions);
});
for (const value of [null, [], 1, "text", {}, { state: "x", questions: {} }, { state: "x", questions: [] }]) {
  test(`rejects malformed request ${JSON.stringify(value)}`, () => rejectsInput(value));
}
for (const [name, mutate] of [
  ["empty state", (r) => { r.state = " "; }],
  ["empty object state", (r) => { r.state = {}; }],
  ["null state", (r) => { r.state = null; }],
  ["missing state", (r) => { delete r.state; }],
  ["unknown top field", (r) => { r.endpoint = "https://other.invalid"; }],
  ["array question", (r) => { r.questions.route = []; }],
  ["unsupported type", (r) => { r.questions.route.type = "noul"; }],
  ["missing instructions", (r) => { delete r.questions.route.instructions; }],
  ["blank instructions", (r) => { r.questions.route.instructions = " "; }],
  ["extra question field", (r) => { r.questions.route.temperature = 0; }],
  ["choice array", (r) => { r.questions.route.criteria = ["bug", "idea"]; }],
  ["one choice", (r) => { r.questions.route.criteria = { bug: "Broken" }; }],
  ["invalid description", (r) => { r.questions.route.criteria.bug = 9; }],
  ["control character ID", (r) => { r.questions["bad\nname"] = r.questions.route; }],
  ["reserved choice", (r) => { r.questions.route.criteria.constructor = null; }],
  ["reserved question", (r) => { r.questions.prototype = r.questions.route; }],
  ["65 questions", (r) => { r.questions = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), r.questions.route])); }],
  ["256 choices", (r) => { r.questions.route.criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), null])); }],
  ["short score scale", (r) => { r.questions.clarity.criteria = ["only"]; }],
  ["long score scale", (r) => { r.questions.clarity.criteria = Array(11).fill("level"); }],
  ["empty score label", (r) => { r.questions.clarity.criteria[0] = ""; }],
  ["invalid boolean criterion", (r) => { r.questions.reproduction.criteria = { yes: "yes" }; }],
  ["empty boolean criteria", (r) => { r.questions.reproduction.criteria = {}; }],
  ["unknown policy question", (r) => { r.policy.other = { minConfidence: 0.8 }; }],
  ["null policy", (r) => { r.policy = null; }],
  ["missing choice threshold", (r) => { r.policy.route = {}; }],
  ["zero threshold", (r) => { r.policy.route.minProbability = 0; }],
  ["negative margin", (r) => { r.policy.route.minMargin = -0.1; }],
  ["unknown abstention label", (r) => { r.policy.route.abstainChoices = ["unknown"]; }],
  ["overlapping boolean bands", (r) => { r.policy.reproduction = { falseAt: 0.5, trueAt: 0.5 }; }],
  ["inverted boolean bands", (r) => { r.policy.reproduction = { falseAt: 0.9, trueAt: 0.2 }; }],
  ["missing score confidence", (r) => { r.policy.clarity = {}; }],
  ["invalid confidence", (r) => { r.policy.clarity.minConfidence = 1.1; }],
  ["wrong policy type", (r) => { r.policy.reproduction.minProbability = 0.8; }],
  ["missing gateway options", (r) => { r.providerOptions = {}; }],
  ["unknown provider option", (r) => { r.providerOptions = { gateway: { retries: 3 } }; }],
  ["invalid ZDR flag", (r) => { r.providerOptions = { gateway: { zeroDataRetention: "true" } }; }],
  ["other provider", (r) => { r.providerOptions = { gateway: { only: ["other"] } }; }],
]) test(`rejects ${name}`, () => { const input = request(); mutate(input); rejectsInput(input); });
for (const value of [undefined, NaN, Infinity, 1n, Symbol("x"), () => {}]) {
  test(`rejects non-JSON ${String(value)}`, () => { const input = request(); input.state = { value }; rejectsInput(input); });
}
test("rejects cycles, oversized UTF-8, and JSON prototype keys without pollution", () => {
  const cyclic = request(); cyclic.state.self = cyclic.state; rejectsInput(cyclic);
  const large = request(); large.state = "😀".repeat(MAX_INPUT_BYTES / 4); rejectsInput(large, "INPUT_TOO_LARGE");
  rejectsInput(JSON.parse('{"state":"x","questions":{"__proto__":{"type":"boolean","instructions":"x"}}}'));
  assert.equal({}.polluted, undefined);
});
test("upper bounds accept 64 questions, 255 choices and 10 score levels", () => {
  const input = request();
  input.questions.route.criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [String(i), null]));
  input.questions.clarity.criteria = Array(10).fill("A described level");
  for (let i = 3; i < 64; i++) input.questions[String(i)] = input.questions.reproduction;
  assert.equal(Object.keys(validateRequest(input).questions).length, 64);
});
test("accepts Gateway boolean probability and optional choice/score confidence", () => {
  const result = response(); delete result.answers.clarity.confidence;
  const answers = validateAnswers(request(), result);
  assert.equal(answers.reproduction.probability, 0.1);
  assert.equal(Object.hasOwn(answers.route, "confidence"), false);
  assert.equal(Object.hasOwn(answers.clarity, "confidence"), false);
});
for (const [name, mutate] of [
  ["wrong model", (r) => { r.model = "other"; }],
  ["missing model", (r) => { delete r.model; }],
  ["provider error in HTTP 200", (r) => { r.error = "secret"; }],
  ["missing answer", (r) => { delete r.answers.route; }],
  ["extra answer", (r) => { r.answers.extra = r.answers.route; }],
  ["null answer", (r) => { r.answers.route = null; }],
  ["wrong answer type", (r) => { r.answers.reproduction.type = "noul"; }],
  ["string probability", (r) => { r.answers.reproduction.probability = "0.9"; }],
  ["infinite probability", (r) => { r.answers.reproduction.probability = Infinity; }],
  ["negative probability", (r) => { r.answers.route.probabilities.idea = -0.1; }],
  ["bad probability sum", (r) => { r.answers.route.probabilities.idea = 0.5; }],
  ["missing probability", (r) => { delete r.answers.route.probabilities.idea; }],
  ["extra probability", (r) => { r.answers.route.probabilities.extra = 0; }],
  ["undeclared choice", (r) => { r.answers.route.choice = "other"; }],
  ["nonwinning choice", (r) => { r.answers.route.choice = "idea"; }],
  ["invalid confidence", (r) => { r.answers.route.confidence = null; }],
  ["negative score", (r) => { r.answers.clarity.score = -0.1; }],
  ["large score", (r) => { r.answers.clarity.score = 3; }],
  ["NaN score", (r) => { r.answers.clarity.score = NaN; }],
  ["score probability label", (r) => { r.answers.clarity.probabilities = { low: 0, medium: 0.8, high: 0.2 }; }],
]) test(`rejects response: ${name}`, () => rejectsAnswer(mutate));
test("tolerates rounded distributions but strips arbitrary answer fields and legend", () => {
  const result = response();
  result.answers.route.probabilities = { bug: 0.9, idea: 0.0999 };
  result.answers.route.reasoning = "sensitive echoed input";
  result.answers.clarity.legend = ["provider must not rewrite caller criteria"];
  const answers = validateAnswers(request(), result);
  assert.equal(Object.hasOwn(answers.route, "reasoning"), false);
  assert.equal(Object.hasOwn(answers.clarity, "legend"), false);
});
test("all three types become ready only under explicit policies", () => {
  const actual = decision(() => {});
  assert.deepEqual(actual.route, { status: "ready", value: "bug" });
  assert.deepEqual(actual.reproduction, { status: "ready", value: false });
  assert.deepEqual(actual.clarity, { status: "ready", value: 1.2 });
});
test("missing and partial policy abstain without discarding valid answers", () => {
  for (const policy of [undefined, {}, { route: { minProbability: 0.8 } }]) {
    const actual = decision((r) => { if (policy === undefined) delete r.policy; else r.policy = policy; });
    assert.equal(actual.clarity.reason, "policy_required");
    assert.equal(actual.reproduction.value, null);
  }
});
test("object prototype names do not supply policy or contaminate maps", () => {
  const input = oneChoice();
  input.questions = { toString: input.questions.route }; input.policy = {};
  const result = { model: response().model, answers: { toString: response().answers.route } };
  assert.equal(applyPolicy(validateRequest(input), validateAnswers(input, result)).toString.reason, "policy_required");
  input.questions.toString.criteria = { toString: null, valueOf: "Other" };
  result.answers.toString = { type: "choice", choice: "toString", probabilities: { toString: 0.9, valueOf: 0.1 } };
  assert.equal(validateAnswers(validateRequest(input), result).toString.choice, "toString");
});
for (const [name, policy, answer, reason] of [
  ["low probability", { minProbability: 0.95 }, {}, "low_probability"],
  ["small margin", { minProbability: 0.8, minMargin: 0.9 }, {}, "small_margin"],
  ["explicit unknown", { minProbability: 0.8, abstainChoices: ["bug"] }, {}, "abstain_choice"],
  ["ties even at permissive thresholds", { minProbability: 0.1 }, { probabilities: { bug: 0.5, idea: 0.5 } }, "tied_choices"],
  ["missing confidence", { minProbability: 0.8, minConfidence: 0.8 }, {}, "confidence_unavailable"],
  ["low confidence", { minProbability: 0.8, minConfidence: 0.8 }, { confidence: 0.7 }, "low_confidence"],
]) test(`choice abstains on ${name}`, () => {
  const actual = decision((r) => { r.policy.route = policy; }, (r) => { Object.assign(r.answers.route, answer); });
  assert.deepEqual(actual.route, { status: "abstain", value: null, reason });
});
test("choice policy thresholds are inclusive", () => {
  const actual = decision((r) => { r.policy.route = { minProbability: 0.9, minMargin: 0.8, minConfidence: 0.9 }; }, (r) => { r.answers.route.confidence = 0.9; });
  assert.equal(actual.route.status, "ready");
});
for (const [p, expected] of [[0, false], [0.2, false], [0.5, null], [0.8, true], [1, true]]) {
  test(`boolean probability ${p} maps to ${expected}`, () => {
    const actual = decision(() => {}, (r) => { r.answers.reproduction.probability = p; });
    assert.equal(actual.reproduction.value, expected);
    if (expected === null) assert.equal(actual.reproduction.reason, "ambiguous_probability");
  });
}
test("score does not invent confidence when Gateway omits it", () => {
  const actual = decision(() => {}, (r) => { delete r.answers.clarity.confidence; });
  assert.equal(actual.clarity.reason, "confidence_unavailable");
});
test("DecisionError carries stable code, exit status and safe details", () => {
  const error = new DecisionError("TEST", "safe", 2, { retryable: false });
  assert.equal(error.exitCode, 2); assert.deepEqual(error.details, { retryable: false });
});
