# Fast decision

An explicit agent skill for delegating bounded judgments to TypeSafe Jev through Vercel AI Gateway.

Use it for classification, filtering, routing, ranking, triage, and small scoring decisions. Keep writing, coding, research synthesis, and nuanced reasoning in the host agent.

## Use

Install the skill with the skill installer supported by your agent, or copy this repository's `SKILL.md` and `scripts/` directory into that agent's skill directory. Then invoke it explicitly:

```text
Use fast-decision for: Should I buy a gaming console?
```

The skill is explicit-only so it does not silently send ordinary conversation to an external provider.

## Authentication

Create a Vercel AI Gateway API key and expose it to the helper as `AI_GATEWAY_API_KEY`, or provide `VERCEL_OIDC_TOKEN` in a Vercel runtime. On macOS, the helper also reads the Keychain item named `codex-fast-decision`.

Do not commit credentials or send secrets in decision state. The helper uses `typesafe-ai/jev` and does not request Zero Data Retention by default because Vercel restricts that option to Pro and Enterprise plans.

## Direct helper call

From the repository root:

```sh
node scripts/decide.mjs <<'JSON'
{
  "state": "Should I buy a gaming console?",
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "What kind of request is this?",
      "criteria": {
        "purchase_consultation": "The user is asking for buying advice",
        "general_question": "The user is asking for general information",
        "casual_conversation": "The user is making casual conversation"
      }
    }
  }
}
JSON
```

The surrounding agent owns thresholds, policy, and control flow. Jev's output must be validated before it drives an action. Uncertain results should stay in the host agent or go to human review.

## License

MIT. See [LICENSE](LICENSE).
