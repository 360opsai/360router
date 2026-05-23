# 360router

[![npm version](https://img.shields.io/npm/v/360router.svg)](https://www.npmjs.com/package/360router)
[![npm downloads](https://img.shields.io/npm/dm/360router.svg)](https://www.npmjs.com/package/360router)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Smart AI model router — local first, cloud when needed.

## What is 360router?

360router is an OpenAI-compatible proxy that intelligently routes AI requests between local models (Ollama, LM Studio, vLLM) and cloud providers (Anthropic, OpenAI, Groq, Gemini, xAI). It runs as a background service on `localhost:3600` and automatically selects the best provider based on:

- Request complexity
- Provider availability
- Circuit breaker state
- Your configured preferences

**Key features:**
- Local-first routing (privacy by default)
- Automatic fallback to cloud when local is unavailable
- Circuit breaker prevents repeated calls to failing providers
- Basic PII detection and privacy counter
- Drop-in replacement: any OpenAI-compatible client points to `http://localhost:3600`
- Opt-in telemetry (never logs prompts, responses, or API keys)

## Installation

```bash
npm install -g 360router
```

## Quick Start

**1. Configure providers**

```bash
360router init
```

Scans for local providers (Ollama, LM Studio, vLLM, Jan) and optionally adds cloud providers.

**2. Start the proxy**

```bash
360router start
```

Runs on `http://localhost:3600` (OpenAI-compatible). Point any client at this URL.

**3. Check status**

```bash
360router status
```

Shows provider health, latency, model counts, and routing stats.

**4. Stop the proxy**

```bash
360router stop
```

## CLI Reference

| Command | Description |
|---|---|
| `360router init` | Interactive setup — scan local + add cloud providers |
| `360router start` | Start the proxy server on port 3600 |
| `360router stop` | Stop the running proxy server |
| `360router status` | Show provider health and routing stats |
| `360router route "<prompt>"` | Route a single message and print the response |
| `360router config set` | Interactive config editor |
| `360router update` | Update to the latest version |
| `360router service install` | Install as a background OS service (systemd / launchd / startup) |
| `360router service uninstall` | Remove the background service |

## Connect to a Custom AI Box

If you have an on-premises GPU server (Ollama running on a remote machine):

```bash
360router init
# Select: "Local AI box — on-prem GPU server"
# Enter the IP address of your box
```

## Usage as a Library

```typescript
import { route } from '360router';

const result = await route([
  { role: 'user', content: 'Hello!' }
]);

console.log(result.content);
console.log(`Provider: ${result.provider}, Model: ${result.model}`);
```

## Configuration

Configuration is stored per-user (cross-platform via [`conf`](https://github.com/sindresorhus/conf)):

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\360router\config.json` |
| macOS | `~/Library/Preferences/360router/config.json` |
| Linux | `~/.config/360router/config.json` |

## Routing Logic

360router uses a 5-step routing process:

1. **Complexity** — Classify request (simple / medium / complex / expert)
2. **Sensitivity** — Check for PII (cloud-bound only)
3. **Tier** — Select appropriate model tier
4. **Queue** — Try local providers first, then cloud
5. **Fallback** — Circuit breaker prevents repeated failures

## Supported Providers

### Local (OpenAI-compatible)
- [Ollama](https://ollama.ai) (port 11434) ← auto-detected
- [LM Studio](https://lmstudio.ai) (port 1234) ← auto-detected
- [vLLM](https://github.com/vllm-project/vllm) (port 8000) ← auto-detected
- [Jan](https://jan.ai) (port 1337) ← auto-detected
- Custom endpoints

### Cloud
- Anthropic (Claude)
- OpenAI (GPT)
- Groq
- Google Gemini
- xAI Grok

## Privacy

- Local requests never leave your machine
- Cloud requests are scanned for basic PII patterns (SSN, email, phone, credit card)
- Privacy counter tracks cloud-bound requests with potential sensitive data
- Telemetry is opt-in and never collects prompts, responses, or API keys

## Telemetry

If enabled, 360router collects:
- Provider latency and success/failure rates
- Error codes, OS, and version

**Never collected:** prompt content, response content, API keys, IP addresses, personal identifiers.

## Managed API Keys

Don't want to manage API keys? Get managed cloud access at [360ops.ai](https://360ops.ai) from $3.99/mo.

## Security

See [SECURITY.md](SECURITY.md) for our vulnerability disclosure policy and a full list of expected OS permissions.

## License

MIT — see [LICENSE](LICENSE)

## Support

- Documentation: https://360ops.ai/router
- Issues: https://github.com/360opsai/360router/issues
- Email: support@360ops.ai
