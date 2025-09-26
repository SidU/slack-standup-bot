# Repository Guidelines

## Project Structure & Module Organization
- `index.js` exposes the bot via `src/index.js`; all bot wiring lives in `src/`.
- Controllers under `src/controller/` group Slack command handlers (`standup-controller.js`, `help-controller.js`, etc.). Data access lives in `src/model/`.
- Shared helpers sit in `test/helpers.js`, and test suites mirror source folders (`test/controller`, `test/model`). Coverage artifacts write to `coverage/`.
- Deployment helpers include `Procfile` for Heroku and `.editorconfig` for consistent whitespace.

## Build, Test & Development Commands
- `npm install` installs runtime and tooling dependencies. Pin Node to 0.12.x for parity with production.
- `npm start` (or `npm run bot`) launches the RTM bot; set `SLACK_API_TOKEN` and `REDIS_URL` before running.
- `npm test` runs linting (`jshint` + `jscs`) via the `pretest` hook, then executes Mocha unit specs with Istanbul coverage.
- `npm run unit-test` skips linting when you need a faster feedback loop, while `npm run ci` adds Coveralls reporting for pipelines.

## Coding Style & Naming Conventions
- Follow the enforced 2-space indentation, LF line endings, and single quotes (`.jscsrc` / `.jshintrc`).
- Keep modules CommonJS (`module.exports`) and prefer camelCase for identifiers; constructors must remain Capitalized.
- Avoid trailing whitespace, multiple var declarations per block, and unused definitions—the linters will fail the build otherwise.

## Testing Guidelines
- Write tests with Mocha + Chai + Sinon; stub external services with Proxyquire when necessary.
- Place specs beside matching modules under `test/` using the `.spec.js` suffix (e.g., `test/controller/standup-controller.spec.js`).
- Maintain deterministic tests; `npm test` generates `coverage/lcov.info`, so clean up flaky cases before opening a PR.

## Commit & Pull Request Guidelines
- Emulate the existing Conventional Commit style (`chore(package): update moment…`); include the affected scope when possible.
- Keep commits focused and reference related issues in the body; amend instead of stacking fix-up commits.
- PRs must explain the change, list manual/test verification steps, and add screenshots for user-visible Slack output when practical.

## Security & Configuration Tips
- Never hard-code tokens or Redis URLs; use environment variables or deployment configs (`heroku config:set`).
- Review new dependencies for known vulnerabilities and document any required Slack scopes in the PR description.
