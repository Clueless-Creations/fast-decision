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
contributors. Maintainers may also request changes or close a pull request.

Do not include API keys, OIDC tokens, Keychain exports, personal data, or
provider responses containing sensitive state.

Run the local check before opening a pull request:

```sh
node --check scripts/decide.mjs
```
