// Gateway /v1/evaluate contract. This module performs no I/O.
export const MODEL = "typesafe-ai/jev";
export const MAX_INPUT_BYTES = 128_000;
export const MAX_OUTPUT_BYTES = 256_000;
export const MAX_QUESTIONS = 64;
const EPSILON = 0.001;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const own = (object, key) => Object.hasOwn(object, key);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const probability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const description = (value) => (typeof value === "string" && value.trim().length > 0)
  || (Array.isArray(value) && value.length > 0) || (record(value) && Object.keys(value).length > 0);

export class DecisionError extends Error {
  constructor(code, message, exitCode = 1, details = {}) {
    super(message);
    this.name = "DecisionError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function requireInput(ok, message) {
  if (!ok) throw new DecisionError("INVALID_INPUT", message);
}
function requireAnswer(ok, message) {
  if (!ok) throw new DecisionError("INVALID_RESPONSE", message);
}
function keysAllowed(object, allowed) {
  return Object.keys(object).every((key) => allowed.includes(key));
}
function validId(key) {
  return key.trim().length > 0 && key.length <= 128 && !/[\x00-\x1f\x7f]/u.test(key) && !unsafeKeys.has(key);
}
function sameKeys(object, keys) {
  return record(object) && Object.keys(object).length === keys.length && keys.every((key) => own(object, key));
}

// Also reject non-JSON library inputs instead of silently dropping/coercing fields.
function snapshot(value) {
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol"
        || typeof item === "bigint" || (typeof item === "number" && !Number.isFinite(item))) throw new Error();
      return item;
    });
    if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new DecisionError("INPUT_TOO_LARGE", "Input exceeds 128000 bytes.");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    throw new DecisionError("INVALID_INPUT", "Input must contain only finite JSON values and no cycles.");
  }
}

/** Validate and detach the request before credential access or any network call. */
export function validateRequest(value) {
  const request = snapshot(value);
  requireInput(record(request), "Input must be a JSON object.");
  requireInput(keysAllowed(request, ["state", "questions", "policy", "providerOptions"]), "Unknown top-level field. Allowed: state, questions, policy, providerOptions.");
  requireInput(own(request, "state") && description(request.state), "state must be a nonempty string, object, or array.");
  requireInput(record(request.questions), "questions must be an object.");
  const questions = Object.entries(request.questions);
  requireInput(questions.length >= 1 && questions.length <= MAX_QUESTIONS, "Provide between 1 and 64 questions per request.");
  for (const [index, [id, question]] of questions.entries()) {
    const at = `Question ${index + 1}`;
    requireInput(validId(id), `${at} has an invalid ID.`);
    requireInput(record(question) && keysAllowed(question, ["type", "instructions", "criteria"]), `${at} has an invalid shape.`);
    requireInput(["choice", "boolean", "score"].includes(question.type), `${at} type must be choice, boolean, or score. Gateway does not use noul.`);
    requireInput(description(question.instructions), `${at} needs nonempty instructions.`);
    if (question.type === "choice") {
      requireInput(record(question.criteria), `${at} choice criteria must be an object.`);
      const choices = Object.entries(question.criteria);
      requireInput(choices.length >= 2 && choices.length <= 255, `${at} needs 2 to 255 choices.`);
      requireInput(choices.every(([key, detail]) => validId(key) && (detail === null || description(detail))), `${at} has an invalid choice or description.`);
    } else if (question.type === "score") {
      requireInput(Array.isArray(question.criteria) && question.criteria.length >= 2 && question.criteria.length <= 10
        && question.criteria.every(description), `${at} score criteria must contain 2 to 10 descriptive levels.`);
    } else if (own(question, "criteria")) {
      requireInput(record(question.criteria) && Object.keys(question.criteria).length > 0
        && keysAllowed(question.criteria, ["true", "false"]) && Object.values(question.criteria).every(description), `${at} boolean criteria can describe true and/or false only.`);
    }
  }
  if (own(request, "providerOptions")) {
    const options = request.providerOptions;
    requireInput(record(options) && keysAllowed(options, ["gateway"]) && record(options.gateway), "providerOptions must contain a gateway object.");
    const gateway = options.gateway;
    requireInput(keysAllowed(gateway, ["zeroDataRetention", "only"]), "Supported gateway options: zeroDataRetention and only.");
    if (own(gateway, "zeroDataRetention")) requireInput(typeof gateway.zeroDataRetention === "boolean", "zeroDataRetention must be a boolean.");
    if (own(gateway, "only")) requireInput(Array.isArray(gateway.only) && gateway.only.length === 1 && gateway.only[0] === "typesafe-ai", "only must be [\"typesafe-ai\"].");
  }
  if (own(request, "policy")) {
    requireInput(record(request.policy), "policy must be an object keyed by question ID.");
    for (const [id, policy] of Object.entries(request.policy)) {
      requireInput(own(request.questions, id) && record(policy), "Each policy must reference an existing question and be an object.");
      const type = request.questions[id].type;
      const allowed = type === "choice" ? ["minProbability", "minMargin", "minConfidence", "abstainChoices"]
        : type === "boolean" ? ["falseAt", "trueAt"] : ["minConfidence"];
      requireInput(keysAllowed(policy, allowed), "Policy contains a field unsupported for its question type.");
      if (type === "choice") {
        requireInput(probability(policy.minProbability) && policy.minProbability > 0, "Choice policy needs minProbability in (0, 1].");
        if (own(policy, "minMargin")) requireInput(probability(policy.minMargin), "minMargin must be in [0, 1].");
        if (own(policy, "abstainChoices")) requireInput(Array.isArray(policy.abstainChoices)
          && policy.abstainChoices.every((key) => typeof key === "string" && own(request.questions[id].criteria, key)), "abstainChoices must name declared choices.");
      } else if (type === "boolean") {
        requireInput(probability(policy.falseAt) && probability(policy.trueAt) && policy.falseAt < policy.trueAt,
          "Boolean policy needs 0 <= falseAt < trueAt <= 1.");
      }
      if (type === "score" || own(policy, "minConfidence")) requireInput(probability(policy.minConfidence)
        && policy.minConfidence > 0, "minConfidence must be in (0, 1].");
    }
  }
  return request;
}

export function gatewayBody(request) {
  return { model: MODEL, state: request.state, questions: request.questions,
    ...(request.providerOptions ? { providerOptions: request.providerOptions } : {}) };
}

function distribution(value, keys) {
  requireAnswer(sameKeys(value, keys), "Response probability keys do not match the requested criteria.");
  const probabilities = Object.values(value);
  requireAnswer(probabilities.every(probability) && Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) <= EPSILON,
    "Response probabilities must be finite, in [0, 1], and sum to 1 within 0.001.");
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

/** All answers must pass before any result can be consumed. Unknown metadata is not copied. */
export function validateAnswers(request, result) {
  requireAnswer(record(result) && !own(result, "error") && result.model === MODEL, "Response must identify the requested Gateway model and contain no error.");
  requireAnswer(sameKeys(result.answers, Object.keys(request.questions)), "Response answer IDs must exactly match the requested questions.");
  const answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = result.answers[id];
    requireAnswer(record(answer) && answer.type === question.type, "Response answer type does not match its question.");
    if (question.type === "boolean") {
      requireAnswer(probability(answer.probability), "Boolean probability must be finite and in [0, 1].");
      answers[id] = { type: "boolean", probability: answer.probability };
      continue;
    }
    const keys = question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_level, i) => String(i));
    const probabilities = distribution(answer.probabilities, keys);
    if (own(answer, "confidence")) requireAnswer(probability(answer.confidence), "Confidence must be finite and in [0, 1].");
    const confidence = own(answer, "confidence") ? { confidence: answer.confidence } : {};
    if (question.type === "choice") {
      requireAnswer(typeof answer.choice === "string" && own(question.criteria, answer.choice), "Response choice is not a declared option.");
      requireAnswer(probabilities[answer.choice] >= Math.max(...Object.values(probabilities)) - 1e-9, "Response choice is not a highest-probability option.");
      answers[id] = { type: "choice", choice: answer.choice, probabilities, ...confidence };
    } else {
      requireAnswer(typeof answer.score === "number" && Number.isFinite(answer.score) && answer.score >= 0
        && answer.score <= question.criteria.length - 1, "Response score is outside the requested scale.");
      // Gateway may omit a legend. The caller's rubric, not provider text, defines it.
      answers[id] = { type: "score", score: answer.score, probabilities, ...confidence };
    }
  }
  return answers;
}

/** Policy readiness is not permission, factual verification, or approval to execute. */
export function applyPolicy(request, answers) {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => {
    const policy = request.policy && own(request.policy, id) ? request.policy[id] : undefined;
    const abstain = (reason) => [id, { status: "abstain", value: null, reason }];
    if (!policy) return abstain("policy_required");
    if (answer.type === "boolean") {
      if (answer.probability <= policy.falseAt) return [id, { status: "ready", value: false }];
      if (answer.probability >= policy.trueAt) return [id, { status: "ready", value: true }];
      return abstain("ambiguous_probability");
    }
    if (own(policy, "minConfidence")) {
      if (!own(answer, "confidence")) return abstain("confidence_unavailable");
      if (answer.confidence < policy.minConfidence) return abstain("low_confidence");
    }
    if (answer.type === "choice") {
      if (policy.abstainChoices?.includes(answer.choice)) return abstain("abstain_choice");
      const selected = answer.probabilities[answer.choice];
      const runnerUp = Math.max(...Object.entries(answer.probabilities).filter(([key]) => key !== answer.choice).map(([, p]) => p));
      if (selected - runnerUp <= 1e-9) return abstain("tied_choices");
      if (selected < policy.minProbability) return abstain("low_probability");
      if (selected - runnerUp + 1e-9 < (policy.minMargin ?? 0)) return abstain("small_margin");
      return [id, { status: "ready", value: answer.choice }];
    }
    return [id, { status: "ready", value: answer.score }];
  }));
}
