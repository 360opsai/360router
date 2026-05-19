# 360router

Smart AI model router — local first, cloud when needed.

## What is 360router?

360router intelligently routes AI requests between local models (Ollama, LM Studio, vLLM) and cloud providers (Anthropic, OpenAI, Groq, Gemini, Grok). It automatically selects the best provider based on:

- Request complexity
- Provider availability
- Circuit breaker state
- Your configured preferences

**Key features:**
- Local-first routing (privacy by default)
- Automatic fallback to cloud when local unavailable
- Circuit breaker prevents repeated calls to failing providers
- Basic PII detection and privacy counter
- Opt-in telemetry for performance insights
- Zero configuration for common local setups

## Installation

```bash
npm install -g 360router
```

## Quick Start

1. **Setup**

```bash
360router init
```

This will:
- Scan for local providers (Ollama, LM Studio, vLLM, Jan)
- Optionally add remote local providers
- Optionally add cloud providers (Anthropic, OpenAI, etc.)

2. **Check status**

```bash
360router status
```

Shows provider health, latency, model counts, and privacy stats.

3. **Route a message**

```bash
360router route "What is 2+2?"
```

## Usage as Library

```typescript
import { route } from '360router';

const result = await route([
  { role: 'user', content: 'Hello!' }
]);

console.log(result.content);
console.log(`Provider: ${result.provider}, Model: ${result.model}`);
```

## Configuration

Configuration is stored in `~/.config/360router/config.json` (cross-platform).

### Provider Configuration

```typescript
interface ProviderConfig {
  name: string;
  kind: 'local' | 'cloud';
  enabled: boolean;
  baseUrl?: string;      // For local providers
  apiKey?: string;       // For cloud providers
  label?: string;        // Display name
}
```

## Routing Logic

360router uses a 5-step routing process:

1. **Complexity** — Classify request (simple/medium/complex/expert)
2. **Sensitivity** — Check for PII (cloud-bound only)
3. **Tier** — Select appropriate model tier
4. **Queue** — Try local providers first, then cloud
5. **Fallback** — Circuit breaker prevents repeated failures

## Supported Providers

### Local (OpenAI-compatible)
- Ollama (port 11434)
- LM Studio (port 1234)
- vLLM (port 8000)
- Jan (port 1337)
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
- Provider latency
- Success/failure rates
- Error codes
- OS and version

Never collected:
- Prompt content
- Response content
- API keys
- IP addresses
- Personal identifiers

## Managed API Keys

Don't want to manage API keys? Get managed cloud access at [360ops.ai](https://360ops.ai) from $3.99/mo.

## License

MIT

## Support

- Documentation: https://360ops.ai/router
- Issues: https://github.com/360ops/360router/issues
- Email: support@360ops.ai
