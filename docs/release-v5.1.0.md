# v5.1.0 — Agy and Kimi join the bridge

This backward-compatible minor release expands the supported backend set and
makes Codex App-visible sessions practical without changing the default path
for existing installations.

## Highlights

- Adds Agy (Antigravity CLI) and Kimi Code backends, including session listing,
  resume, model/effort behavior, streaming progress, configurable timeouts, and
  preservation of useful partial output when a long turn is interrupted.
- Adds an opt-in Codex `app-server` transport. Its threads can be indexed by the
  shared Codex App inventory, completed turns are fully persisted, and events
  are filtered by parent thread and turn so sub-agent output cannot be mistaken
  for the requested result.
- Keeps the existing Codex SDK transport as the default and leaves every new
  backend disabled until explicitly configured.
- Improves failure logs and user-facing error detail while keeping generated
  text available when a CLI exits or is cancelled after producing output.
- Tightens configuration-file permissions and standardizes dependency installs
  on the committed Bun lockfile.

## Compatibility and upgrade

No session or database migration is required. Existing Claude, Codex, and
legacy Gemini configurations continue to load. Add `agy` or `kimi` blocks only
when enabling those backends; select `transport: "app-server"` only when Codex
App-visible threads are wanted.

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run check --backend claude
```

Repeat the config check for every backend you run. The supported distribution
path remains a repository clone plus Bun; the historical npm v3.1.0 snapshot is
not a supported v5 package.

## Verification

- Frozen Bun install
- Config schema validation against `config.example.json`
- 173 automated tests in an environment-neutral run
- Package dry-run and config schema smoke without starting a Telegram bot
- GitHub Actions CI

No service is restarted and no tag, package, or GitHub Release is created by
this preparation commit.
