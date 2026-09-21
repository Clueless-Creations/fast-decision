# Fast decision

Give an agent a small judgment to delegate, not another agent to manage.

Fast decision sends explicit, bounded questions to **TypeSafe Jev through Vercel AI Gateway**. It validates every answer and applies your acceptance policy before returning `ready` or `abstain`. The host agent still owns reasoning, evidence collection, permissions, and execution.

Use it to route a report, classify intent, filter candidates, or score an item against a short rubric. Do not use it to generate code, replace a test run, decide whether a person deserves a service, or approve an irreversible action.

## Try it without a key

Requires **Node.js 22 or later**. There are no runtime dependencies, build steps, or packages to install.

```sh
git clone https://github.com/Clueless-Creations/fast-decision.git
cd fast-decision
node scripts/decide.mjs --help
node scripts/decide.mjs --validate < examples/route.json
npm test
```

Validation and tests run offline. `--validate` checks the request, reports its size and policy coverage, and prints no decision state. It does not predict the model's answer or check provider availability.

## Use with an agent

Install with your agent's skill installer, or copy `SKILL.md`, the **entire `scripts/` directory**, `docs/`, and `examples/` together into its skill directory. Keep their relative paths. No machine-specific home path is required.

Start with an explicit instruction:

```text
Use fast-decision to classify this bug report as bug, feature, how_to, or
needs_context. Read SKILL.md, minimize the state, and validate locally first.
Use the routing example's policy for this trial. Do not execute any action.
```

The skill remains explicit-only. An integration must preserve that consent boundary rather than silently forwarding unrelated conversation to an external model. Instructions for the consuming agent live in [SKILL.md](SKILL.md); repository editing rules live in [AGENTS.md](AGENTS.md).

## Authenticate locally, then evaluate

Expose a credential through your local secret manager or process environment. The helper checks `AI_GATEWAY_API_KEY`, then `VERCEL_OIDC_TOKEN`, then the macOS Keychain item `codex-fast-decision`. It does not load `.env` automatically. Do not paste a credential into chat, put it in a request, or commit it.

```sh
node scripts/decide.mjs --doctor
node scripts/decide.mjs < examples/route.json
```

`--doctor` checks that a credential is present and syntactically usable. It shows only its source and **does not verify authentication with Vercel**. The second command sends state and questions to the provider and may incur charges.

## Supply the decision policy

[The routing example](examples/route.json) defines four choices, including an explicit `needs_context` outcome, and a local policy:

```json
{
  "route": {
    "minProbability": 0.85,
    "minMargin": 0.2,
    "abstainChoices": ["needs_context"]
  }
}
```

Here, a result must clear the selected-option threshold, beat the runner-up by the specified margin, and not select the abstention label. **These are example thresholds, not calibrated guarantees.** Set and test policies against labeled examples for your own workflow. A probability is a model judgment, not evidence that a statement is true.

The JSON result contains a versioned envelope, validated `answers`, and per-question `decisions`. Use `decisions.<id>.value` only after checking that decision's status. `ready` means the answer cleared the supplied policy, not that an action was authorized. If any question abstains, the overall status is `abstain`.

| Exit | Meaning | Output |
| --- | --- | --- |
| `0` | Every decision is ready, or an offline command succeeded | JSON on stdout, except help text |
| `1` | Invalid request, malformed response, transport failure, or timeout | JSON error on stderr; no partial result |
| `2` | Missing/invalid credentials, or Gateway rejected access | JSON error on stderr |
| `3` | Valid answers need host review | JSON on stdout with `status: "abstain"` |

**Without a policy, valid answers are still returned, but the helper abstains and exits `3`.** This is an intentional change from the original pass-through script. Update callers that previously treated every HTTP 200 response as usable.

## Ask independent questions together

```sh
node scripts/decide.mjs --validate < examples/batch.json
node scripts/decide.mjs < examples/batch.json
```

This example groups routing, a boolean judgment, and a score against the same state. Questions do not consume one another's answers. When a later judgment needs an earlier result, the host must validate the first result before making the next request.

Gateway's boolean type is `boolean`, with an answer field named `probability`, not TypeSafe's direct-API `noul`. Choice and score responses may omit confidence. A policy that requires unavailable confidence abstains; the helper never invents it. The batch example deliberately exposes this behavior for its score.

## Boundaries

One evaluation sends at most one request to a fixed HTTPS endpoint. There are no automatic retries, provider fallbacks, redirects, hidden model calls, or action tools in this helper. Input and output are byte-limited while streaming. Provider error bodies, arbitrary metadata, and warning text are not echoed. The helper returns allowlisted usage/cost fields and measured request time when available, not estimated savings.

Zero Data Retention is not requested by default. An eligible caller can require it explicitly with `providerOptions.gateway.zeroDataRetention: true`; the helper never silently weakens a requested privacy constraint. See [Vercel's evaluation API](https://vercel.com/docs/ai-gateway/modalities/evaluation) and the [contract](docs/contract.md) for supported fields and limits. Provider-side routing and retention remain governed by your Gateway configuration.

## Develop

```sh
npm run check
npm test
npm run test:coverage
```

Tests use synthetic responses, fake credentials, and injected transports. They do not make paid calls or measure live Jev quality or latency. CI runs the same checks on Linux, macOS, and Windows with Node.js 22 and 24.

Read [the contract and migration notes](docs/contract.md), [contributing requirements](CONTRIBUTING.md), and [security policy](SECURITY.md) before changing behavior.

MIT. See [LICENSE](LICENSE).
