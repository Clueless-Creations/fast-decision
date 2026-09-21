# Contributing

Contributions are welcome through pull requests from a fork.

The `main` branch is protected:

- direct pushes are not accepted;
- every change requires a pull request;
- at least one approving review is required;
- code-owner review is required;
- authors cannot approve their own pull requests;
- the latest push must be covered by an approval;
- force-pushes, branch deletion, and self-merges are disabled;
- conversations must be resolved before merge.

Maintainers may request changes or close a pull request. Do not include API keys, OIDC tokens, Keychain exports, personal data, or provider responses containing sensitive state.

Run the local check before opening a pull request:

```sh
node --check scripts/decide.mjs
```
