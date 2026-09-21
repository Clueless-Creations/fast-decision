# Security policy

Do not open a public issue for credentials, private decision state, or suspected data exposure.

Use GitHub's private vulnerability reporting for this repository. Include the affected revision, a minimal synthetic reproduction, and the expected and observed behavior. Never include API keys, OIDC tokens, Keychain exports, or raw sensitive provider payloads.

## Boundaries

This helper sends explicitly authorized state and questions to Vercel AI Gateway and its configured provider. It is not on-device inference, a sandbox, an authorization service, or a general-purpose data redactor. Do not send secrets or unnecessary personal data. Do not let a model judgment authorize an irreversible action or a sensitive decision about a person.

Credentials stay in process environment or the macOS Keychain, not request JSON, CLI arguments, prompts, or repository files. `--validate` makes no credential lookup or network request. `--doctor` checks local credential presence without exposing its value or claiming that provider authentication succeeded.

Requests and responses have streaming byte bounds and deadlines. The helper rejects malformed model answers, does not follow redirects, and makes no automatic retries. Upstream error bodies, arbitrary metadata, and warning text are not printed. These protections do not stop callers from putting private information in option names, capturing stdout, enabling external process tracing, or configuring provider-side logs.

Zero Data Retention must be requested explicitly and remains subject to Gateway eligibility and provider/account configuration. Never remove a requested privacy restriction to make a failed call succeed. Inspect provider warnings and failures privately rather than pasting dashboard payloads into an issue.

The host must treat source material as untrusted data, define the allowed outcomes, check independent evidence and action preconditions, and keep required human approvals. Input-shape validation is not protection against every semantic prompt injection or an assurance of model accuracy.
