---
name: fast-decision
description: Delegate bounded classification, filtering, routing, and simple scoring to TypeSafe Jev through Vercel AI Gateway, then keep complex reasoning in Codex. Use when the user explicitly asks for fast-decision, Jev, or a low-cost quick judgment.
disable-model-invocation: true
---

# Fast decision

Use this skill only for a decision with a finite, caller-defined set of outcomes or a small scoring rubric. Good fits include intent classification, triage, filtering, routing, ranking, and simple yes/no checks.

Do not use it for open-ended advice, writing, coding, research synthesis, sensitive decisions, or anything where the decision criteria are not explicit. Keep those tasks in the host agent.

## Workflow

1. Reduce the input to the smallest useful state. Do not send secrets or unnecessary personal data to an external model.
2. Define one or more typed questions with explicit criteria. Prefer one request containing independent questions over multiple calls.
3. Resolve the directory containing this `SKILL.md` as `SKILL_DIR`, then call the helper shipped with the skill. Do not hard-code a machine-specific home path:

   ```sh
   node "$SKILL_DIR/scripts/decide.mjs" <<'JSON'
   {"state":"...","questions":{"route":{"type":"choice","instructions":"...","criteria":{"a":"...","b":"..."}}}}
   JSON
   ```

4. Validate that the returned answer matches the requested question type and criteria. Never let an unvalidated model answer directly trigger an irreversible action.
5. Use the result only when it clears an appropriate probability/confidence threshold. Otherwise continue with the host agent or ask the user.
6. Report the delegation briefly: `Jev via Vercel AI Gateway`, the question, the selected result, probability/confidence when available, and usage when returned. Do not claim a quota or cost reduction without measured evidence.

## Authentication

The helper reads `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` from the process environment, then falls back to the macOS Keychain item `codex-fast-decision`. Never ask the user to paste a secret into chat, a prompt, or a repository. If no credential is present, stop and ask the user to authenticate locally before making a live call.

The Gateway model is `typesafe-ai/jev`. The helper does not request zero-data-retention routing by default because Vercel restricts ZDR to Pro and Enterprise plans. On an eligible plan, pass `providerOptions.gateway.zeroDataRetention: true` explicitly.
