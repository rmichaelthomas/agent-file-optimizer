# Contributing

Thanks for looking. This project is small and maintained by one person on a best-effort basis. Issues and pull requests are welcome; response times vary.

## Before you start

- Read the capability table in the README. Changes that claim more than the code does will be asked to narrow their wording.
- Read [PRIVACY.md](PRIVACY.md). Changes that touch storage, deletion, logging, or tokens need extra care and tests.
- Read [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) for the architecture and the rules this codebase follows.

## Working on the code

```sh
npm install
npm test          # unit and HTTP tests, all in-memory
npm run typecheck
npm run site:check
npm run deploy:dry
npm run smoke    # starts the Worker locally and runs the first-run flow end to end
```

CI runs the same commands. A change is ready when they pass locally.

Schema changes need two edits: a new file in `migrations/` for existing databases, and the matching statement in `src/schema.ts`, which creates the schema on a fresh database. Keep the two in step.

## Guidelines

- Keep the product language plain. Do not describe the project as a service, a platform, or a scanner, and do not say "any file", "malware scanned", "zero retention guaranteed", or "private repositories supported" unless the code and tests support it.
- Add a test with each behavior change. Storage behavior should be tested against the in-memory adapters and, where practical, against the R2 and D1 adapters through their interfaces.
- Keep the parser seam explicit. Anything that sends content outside the Worker must be opt-in, must be marked in the manifest, and must not change the default free native path.
- Do not add a dependency unless it solves a real problem that the standard library and the Workers runtime cannot. Justify it in the pull request, and add its license to [THIRD_PARTY.md](THIRD_PARTY.md).
- Do not commit secrets, `.dev.vars`, local paths, logs, or generated Wrangler output.

## Pull requests

Describe what changed and why, list the commands you ran and their results, and say what you could not verify. Security-relevant changes should go through [SECURITY.md](SECURITY.md) first.

## License

By contributing, you agree that your contribution is licensed under the Apache License 2.0, the same as the project.
