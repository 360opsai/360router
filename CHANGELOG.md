# Changelog

All notable changes to 360router are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.4.0] — 2026-05-22

### Added
- `360router start` command (replaces `serve`; `serve` kept as a legacy alias)
- `360router stop` command — reads PID file and gracefully terminates the server
- `360router update` command — auto-detects git repo vs npm global install, pulls/rebuilds/reinstalls accordingly
- PID file (`~/.360router/server.pid`) for reliable start/stop lifecycle management
- GitHub Actions workflow for npm provenance publishing (improves supply chain security score)
- `SECURITY.md` — documents expected OS permissions and vulnerability disclosure policy
- Pre-flight port check: friendly message instead of Node.js assertion crash when server is already running

### Changed
- `connect360ops` command no longer defaults to a hardcoded IP address
- Provider name/label now uses the IP address directly (not "spartan") — more meaningful for all users
- OS service scripts (systemd, launchd, Windows startup) updated to use `start` command
- `@anthropic-ai/sdk` updated to latest; default model updated to `claude-sonnet-4-5`
- All dependency vulnerabilities resolved (0 `npm audit` findings)

### Fixed
- `EADDRINUSE` Node.js assertion crash when `360router start` was invoked while already running
- Broken GitHub issues URL in README (`360ops/360router` → `360opsai/360router`)

---

## [2.3.1] — 2026-05-19

### Added
- Hot-model routing: dynamically selects models based on request complexity
- Background service auto-start via `360router service install`
- Expanded `aiapp` adapter support

### Fixed
- Various circuit breaker stability improvements
- Provider health-check timing under load

---

## [2.0.0] — 2026-05-19

### Added
- Initial extraction from 360ops-portal monorepo as a standalone package
- OpenAI-compatible proxy server on port 3600
- Multi-provider routing: Ollama, LM Studio, vLLM, Jan, Anthropic, OpenAI, Groq, Gemini, xAI
- Layer 3 routing intelligence (complexity classification, PII detection, circuit breaker)
- `360router init` interactive setup
- `360router status` provider health dashboard
- `360router config set` interactive config editor
- Opt-in telemetry (never logs prompts or keys)

---

[2.4.0]: https://github.com/360opsai/360router/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/360opsai/360router/compare/v2.0.0...v2.3.1
[2.0.0]: https://github.com/360opsai/360router/releases/tag/v2.0.0
