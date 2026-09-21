# Helper contract

This document describes the local helper, not every option supported by the provider. Gateway's [evaluation HTTP API](https://vercel.com/docs/ai-gateway/modalities/evaluation#http-api) is the wire authority. The direct [TypeSafe API](https://docs.typesafe.ai/api) uses a different shape; do not mix it into this endpoint.

## Request

Send exactly one UTF-8 JSON object on stdin. Its only fields are:

| Field | Contract |
| --- | --- |
| `state` | Required nonempty string, object, or array containing authorized evidence |
| `questions` | Required object with 1 to 64 named questions |
| `policy` | Optional local acceptance rules keyed by existing question IDs; never sent upstream |
| `providerOptions` | Optional object containing `gateway`; supported fields below |

Question and choice IDs must be nonblank, at most 128 characters, and contain no control characters. `__proto__`, `constructor`, and `prototype` are rejected in these positions. Other prototype-like names are treated as ordinary own properties, not inherited policy.

Every question has `type` and nonempty `instructions`, plus criteria appropriate to the type. Instructions and descriptions can be strings or nonempty structured JSON objects/arrays. Nested numbers must be finite. Unknown request, question, and policy fields fail validation rather than being silently ignored.

| Type | Criteria | Validated answer |
| --- | --- | --- |
| `choice` | Object containing 2 to 255 named options and their descriptions; a description may be null | Declared `choice`, full `probabilities` map, optional `confidence` |
| `boolean` | Optional nonempty object describing `true`, `false`, or both | `probability` in `[0, 1]` |
| `score` | Array of 2 to 10 descriptions ordered lowest to highest | Finite `score` in `[0, levels - 1]`, full index-keyed `probabilities`, optional `confidence` |

Choice/score probabilities must have exactly the requested keys, each in `[0, 1]`, and sum to one within `0.001` to allow rounding. The selected choice must be a highest-probability option. Ties are structurally valid but never ready. Score need not be an integer; the helper does not force equality with a mean calculated from rounded probabilities. The caller's score rubric is authoritative, so provider-supplied legend text is not forwarded.

These size and shape limits are deliberate helper constraints. They are not a promise about upstream maximum capacity.

## Acceptance policy

There are no default acceptance thresholds. A question without a policy has `status: "abstain"`, `value: null`, and `reason: "policy_required"`. Define policy using evaluated examples and the consequences of a wrong answer, not a model's own proposed threshold.

**Choice:** require `minProbability` in `(0, 1]`. Optionally supply `minMargin` in `[0, 1]`, `minConfidence` in `(0, 1]`, and `abstainChoices` containing declared option names. Margin means selected probability minus the highest other probability. Exact ties, excluded labels, missing required confidence, and values below thresholds abstain.

**Boolean:** require `falseAt` and `trueAt`, with `0 <= falseAt < trueAt <= 1`. A probability at or below `falseAt` gives ready `false`; at or above `trueAt` gives ready `true`. Between them, abstain. Do not confuse `false` with a failed or absent decision.

**Score:** require `minConfidence` in `(0, 1]`. A valid answer with confidence meeting the threshold becomes ready. Gateway may omit confidence, in which case this policy abstains with `confidence_unavailable`. The score and distribution remain available for host review. Do not substitute top-rung probability, certainty about factual accuracy, or a fabricated confidence field.

Threshold comparisons are inclusive. Margin comparisons allow `1e-9` floating-point tolerance. Ties within that tolerance abstain. Readiness only says the local policy passed. Authorization, evidence freshness, deterministic tests, and final sign-off remain outside this helper.

Stable abstention reasons: `policy_required`, `ambiguous_probability`, `confidence_unavailable`, `low_confidence`, `abstain_choice`, `tied_choices`, `low_probability`, `small_margin`. When multiple conditions fail, the helper reports the first one it evaluates; reason ordering is not a priority recommendation.

## Response

A successful evaluation emits one JSON document to stdout:

```json
{
  "schemaVersion": "fast-decision/v1",
  "status": "ready",
  "model": "typesafe-ai/jev",
  "answers": {
    "route": {
      "type": "choice",
      "choice": "bug",
      "probabilities": { "bug": 0.9, "needs_context": 0.1 }
    }
  },
  "decisions": { "route": { "status": "ready", "value": "bug" } },
  "warningCount": 0,
  "metrics": { "elapsedMs": 123, "requestBytes": 456, "questionCount": 1, "attempts": 1 }
}
```

This is an illustrative result, not a live measurement. `metrics.elapsedMs` measures the helper's fetch/body/validation interval, excluding credential lookup and stdin. It is not provider-only inference latency or a comparison with a host model. `requestBytes` counts the outgoing JSON body, including model and excluding local policy.

The model must match `typesafe-ai/jev`; the answer ID set and types must match the request exactly. If any answer fails, **nothing is emitted on stdout**, even when other answers were valid. If every answer validates but any question abstains, overall status is `abstain` and the CLI exits `3`. Other per-question ready results remain visible; consuming them is an explicit host decision, not a hidden partial execution.

Optional telemetry is allowlisted: nonnegative integer `usage.inputTokens`, `outputTokens`, `totalTokens`; numeric Gateway `cost`, `marketCost`, `surchargeCost`, `gatewayCost`; and a bounded `gen_...` generation ID. Missing usage is not treated as zero cost. Other metadata, free-text answer fields, and warning text are dropped. Only warning count is exposed. A warning count above zero is a reason to inspect the provider dashboard privately before trusting operational assumptions.

## Offline commands and errors

`--validate` outputs `fast-decision/preflight/v1` with question count/types, uncovered policy count, wire byte count, and `network: false`. It validates before credential access and includes no state or criteria text. It does not call the provider or check whether a policy is statistically appropriate.

`--doctor` outputs `fast-decision/doctor/v1` with credential source, Node version, `authenticationVerified: false`, and `network: false`. It does not echo the credential, refresh an OIDC token, or verify the account. An invalid nonblank credential fails instead of silently switching projects.

Errors are a single JSON object on stderr with `error.code`, a safe fixed `message`, and `retryable`. HTTP failures also include `httpStatus`. Input errors, invalid responses, and transport failures exit `1`; local credential failures and HTTP 401/403 exit `2`. Help, valid offline commands, and fully ready evaluations exit `0`. Valid abstaining evaluations exit `3` with JSON on stdout.

Common codes: `INVALID_INPUT`, `INPUT_TOO_LARGE`, `INVALID_ARGUMENT`, `INPUT_REQUIRED`, `AUTH_REQUIRED`, `INVALID_CREDENTIAL`, `AUTH_REJECTED`, `PROVIDER_HTTP_ERROR`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, `TIMEOUT`, `REQUEST_FAILED`, `INVALID_CONFIG`, `INTERNAL_ERROR`.

`retryable: true` is diagnostic, not an instruction to call again. The helper never retries automatically. A timed-out request may already have been processed and billed. The host owns retry budgets, backoff, deduplication, and user consent.

## Transport and privacy

The endpoint and model are fixed. The helper follows no HTTP redirects and has no CLI endpoint override. One invocation sends at most one request; Gateway's own behavior is controlled by the caller's provider/account configuration.

Limits: 128,000 input bytes, 128,000 outgoing body bytes, 256,000 response bytes, a 15-second stdin deadline, a separate 15-second evaluation deadline including body reads, and a 5-second macOS Keychain subprocess limit. Keychain output is limited to 16,384 bytes. Byte limits apply while streaming, not after reading an unlimited body. The stdin and network deadlines are separate, not a single end-to-end deadline.

Credentials come from `AI_GATEWAY_API_KEY`, then `VERCEL_OIDC_TOKEN`, then `/usr/bin/security` for macOS Keychain item `codex-fast-decision`. `.env` is not automatically loaded. Tokens are never accepted as request fields or CLI arguments.

The supported provider option subset is:

```json
{ "providerOptions": { "gateway": { "zeroDataRetention": true, "only": ["typesafe-ai"] } } }
```

Both inner fields are optional. `only`, when present, must contain exactly `typesafe-ai`. Unsupported provider options fail before network access. Zero Data Retention is not the default and depends on Gateway eligibility; explicit privacy options are forwarded unchanged and never removed after an error. Check your provider agreement and account configuration rather than inferring a retention guarantee from a local validation result.

The helper does not persist requests, responses, or credentials. It suppresses upstream error bodies, warning text, and unrecognized metadata because they can reflect state or secrets. This is **not a general-purpose redactor**: state leaves the machine during evaluation, and caller-defined IDs/labels and returned answers may themselves be sensitive. Shell history, process tracing, provider logging, and downstream storage are outside this helper's control. See [SECURITY.md](../SECURITY.md).

## Server-side reuse

`evaluate(request, { token, fetchImpl, timeoutMs })` in `scripts/lib/runtime.mjs` provides the same validation and policy behavior without spawning a process. Omit `token` to use local credential resolution. Optional `timeoutMs` must be an integer from 1 to 60,000. `fetchImpl` is an explicit dependency-injection seam for trusted server code and offline tests, not a runtime switch for untrusted callers. Rejected evaluations throw `DecisionError` with `code`, `exitCode`, and safe `details`; abstention is a returned result, not an exception.

## Migration from the original helper

The endpoint, model, credential precedence, direct stdin command, and `answers` field remain. Observable changes are intentional: Node.js 22+, strict input/answer validation, explicit policy readiness, exit `3` for missing/failed policy, structured stderr, filtered metadata instead of raw warnings, and a supported provider-option subset. Copy the whole `scripts/` directory, not just `decide.mjs`.

Update wrappers to parse the versioned envelope and both stdout and exit status. Do not translate an error, missing answer, or abstention into a default `true`, empty success, or permission to execute.
