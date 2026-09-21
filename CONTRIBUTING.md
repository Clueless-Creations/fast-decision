# Contributing

Contributions are welcome through pull requests from a fork.

The `main` branch is protected for outside contributors:

- contributors should use a pull request from a fork;
- every change requires a pull request;
- at least one approving review is required;
- code-owner review is required;
- contributors cannot approve their own pull requests;
- the latest push must be covered by an approval;
- force-pushes and branch deletion are disabled;
- conversations must be resolved before merge.

Repository maintainers may merge their own pull requests when they are acting as
administrators. This owner bypass is intentional; it lets the project owner
ship their own work while keeping the review gate in place for outside
contributors. Contributors must not weaken repository protections or bypass
review. Maintainers may also request changes or close a pull request.

Do not include API keys, OIDC tokens, Keychain exports, personal data, or
provider responses containing sensitive state.

## Local verification

Use Node.js 22 or later. No dependencies need to be installed.

```sh
npm run check
npm test
npm run test:coverage
```

Tests must remain offline and use synthetic fixtures. Add regression coverage for request/response validation, policy decisions, deadlines, streaming bounds, and credential handling when changing them. The CLI tests also validate every shipped JSON example and copy the scripts into a temporary directory to test standalone installation.

A passing mocked contract test does not prove current provider availability, model quality, cost, or latency. Live evaluations require separate authorization and local credentials; do not add them to ordinary CI.

Read [AGENTS.md](AGENTS.md) and the [helper contract](docs/contract.md). Describe user-visible changes, verification results, and any migration steps in the pull request. Keep runtime code portable with the copied skill and preserve explicit invocation and host-owned action gates.
