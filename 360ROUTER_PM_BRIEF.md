# 360Router — Product Manager Brief
**Prepared: April 14, 2026**
**Package: `360router` on npm**
**Current version: 1.0.4**
**Status: Published, installable, working**

---

## What is 360Router?

360Router is a smart AI proxy that sits between your AI apps and your AI models. Instead of each app talking directly to one LLM, every app talks to 360Router, and 360Router picks the best model for each request.

```
Your AI Apps                        Your AI Models
─────────────                       ──────────────
Continue.dev  ──┐                ┌── Ollama (local)
Open WebUI    ──┤                ├── vLLM on DGX (remote)
Custom agents ──┼── localhost:3600 ──┼── Anthropic Claude (cloud)
Python scripts──┤   (360Router)  ├── OpenAI GPT (cloud)
Any AI app    ──┘                └── 12+ more providers
```

**One install. One port. Every app. Every model.**

---

## Why it exists

1. **Developers waste time** configuring each AI app to talk to each model separately
2. **Privacy risk** — apps send data to cloud providers without checking for sensitive content
3. **Cost waste** — simple questions go to expensive models when a small local model would work
4. **No visibility** — nobody knows which models are being used, how much they cost, or how fast they are

360Router solves all four.

---

## How it works (user experience)

```bash
# Install (30 seconds)
npm install -g 360router

# Configure (interactive wizard — scans for LLMs, detects AI apps)
360router init

# Start the proxy
360router serve

# Done. Point any AI app at localhost:3600.
```

The init wizard:
- Scans localhost for running LLM servers (Ollama, vLLM, LM Studio, Jan)
- Asks for remote IPs and scans their ports for LLM servers
- Optionally adds cloud providers (Anthropic, OpenAI, Groq, Gemini, Grok, DeepSeek, Mistral, and 5 more)
- Detects AI apps on the machine (OpenClaw, Continue.dev, LM Studio)
- Offers to reconfigure those apps to route through 360Router automatically

---

## Key features

### Routing intelligence (what makes us different)
| Feature | What it does |
|---|---|
| **Adaptive classifier** | Uses a tiny local LLM to score each request's complexity in ~100ms. Routes simple questions to small models, complex questions to large models. |
| **Pareto optimizer** | Scores every available provider on quality, cost, and latency. Picks the best tradeoff based on user-configurable weights. |
| **Quality feedback loop** | After getting a response, checks if it's good enough (refusal detection, length check, relevance). If bad, auto-retries on a bigger model. Max 1 retry. |
| **Response cache** | Same question within 5 minutes returns instantly from cache. Zero compute, zero cost. Cache hit = ~15ms. |
| **PII detection** | 20+ patterns (SSN, email, phone, credit card, DOB, addresses, medical IDs, passport, API keys). Sensitive requests forced to local models — data never leaves the machine. |

### Proxy server
| Feature | Details |
|---|---|
| **OpenAI-compatible API** | `POST /v1/chat/completions`, `GET /v1/models`, `POST /v1/embeddings` |
| **Ollama-compatible API** | `POST /api/chat`, `POST /api/generate`, `GET /api/tags` — drop-in Ollama replacement |
| **Streaming** | Full SSE streaming from all providers. Anthropic and Gemini auto-translated to OpenAI format. |
| **Tool/function calling** | Passes through tool definitions and tool_calls. Anthropic format auto-translated. |
| **Auth** | Optional API key gate on all /v1/* routes |
| **Rate limiting** | Token bucket per client, configurable req/min |

### CLI commands
| Command | What it does |
|---|---|
| `360router init` | Interactive setup wizard |
| `360router serve` | Start the proxy server (default port 3600) |
| `360router status` | Provider health check |
| `360router telemetry` | Live stats — requests, latency, cost, local vs cloud split |
| `360router config` | View/edit settings without re-running init |
| `360router update` | Self-update to latest version |
| `360router uninstall` | Restore app configs and remove 360router config |
| `360router route "msg"` | One-shot route a message |
| `360router help` | Help |

### Provider coverage
**Tier 1 — Native SDK (5):** Anthropic, OpenAI, Groq, Gemini, xAI Grok
**Tier 2 — OpenAI-compatible presets (7):** DeepSeek, Mistral, Together AI, Fireworks, Perplexity, Cohere, OpenRouter
**Tier 3 — Any OpenAI-compatible endpoint:** unlimited custom providers
**Local:** Ollama, vLLM, LM Studio, Jan, any OpenAI-compat server

Total: 200+ models accessible.

---

## Competitive position

| Capability | 360Router | LiteLLM (open source) | Portkey ($49/mo) |
|---|---|---|---|
| Providers | 200+ models | 100+ | 250+ |
| Install | `npm install -g` (30 sec) | Docker + Postgres | SaaS (no install) |
| Local-first routing | Yes (default) | No | No |
| PII detection | 20+ patterns | No | Basic |
| Adaptive classifier | Yes (LLM-scored) | No | No |
| Quality feedback loop | Yes (auto-escalate) | No | No |
| Response cache | Yes (in-memory LRU) | Yes (Redis required) | Yes |
| App auto-detection | Yes | No | No |
| App auto-reconfig | Yes | No | No |
| Ollama drop-in | Yes (same API) | No | No |
| Self-hosted | Yes | Yes | No |
| Price | Free | Free | $49/mo+ |

**Our moat:** The combination of adaptive classification + quality feedback + PII-aware routing + zero-config app detection is unique. No competitor does intelligent routing — they all do dumb passthrough with fallback.

---

## Architecture

```
packages/router/
├── src/cli/         ← 8 CLI commands (init, serve, status, config, etc.)
├── src/core/        ← 9 intelligence modules (router, classifier, optimizer, cache, PII, etc.)
├── src/providers/   ← 8 provider implementations + 7 cloud presets
├── src/scanner/     ← LLM port scanner + AI app detector
├── src/server/      ← Express proxy (OpenAI routes + Ollama routes + middleware)
├── Dockerfile       ← Docker support (nice-to-have, not default)
├── install.ps1/sh   ← One-line install scripts
└── package.json     ← v1.0.4, published on npm
```

**Tech stack:** TypeScript, Node.js, Express, ESM. No native modules — clean install on Windows, Mac, Linux without build tools.

**34 source files. ~3,500 lines of code. 23KB packaged.**

---

## Benchmark results (laptop, 16GB RAM)

| Metric | Result |
|---|---|
| Cold request (through router) | 11.7s (zero overhead vs direct) |
| Cached request | 15ms (900x faster) |
| Throughput (cached) | ~660 req/sec |
| RAM usage | ~60MB |
| Routing | 100% local by default, $0 cloud cost |
| Success rate | 100% |

---

## Pricing model (planned)

| Tier | Price | What you get |
|---|---|---|
| **Free** | $0 | Local routing, all features, unlimited |
| **Pro** | $3.99/mo | Managed cloud API keys (no setup), priority support |
| **Team** | TBD | Shared proxy, team telemetry dashboard, SSO |

The product is free and fully functional. Revenue comes from managed cloud keys (users who don't want to manage their own Anthropic/OpenAI accounts).

---

## Release history (all shipped April 14, 2026)

| Version | Milestone |
|---|---|
| 0.1.3 | IP port scanning in init wizard |
| 0.2.0 | Express proxy server on port 3600 |
| 0.2.1 | Runtime telemetry + keyboard shortcuts |
| 0.2.2 | Uninstall + cloud cost tracking |
| 0.2.3 | Self-update command |
| 0.3.0 | Streaming SSE + tool calls + embeddings + auth + rate limiting |
| 1.0.0 | Adaptive classifier + Pareto optimizer + quality gate + cache + semantic PII |
| 1.0.1 | Performance tuning (zero cold-call overhead) |
| 1.0.2 | Config command + init UX fixes |
| 1.0.3 | Version sync fix |
| 1.0.4 | Ollama-compatible API (drop-in replacement) |

**11 releases. v0.1.2 → v1.0.4 in one session.**

---

## What's next

| Item | Priority | Status |
|---|---|---|
| Update landing page for v1.0 features | High | v0.2.0 messaging is live, needs v1.0 update |
| README.md rewrite | High | Still shows v0.1.0 content |
| Persistent request logging (to disk) | Medium | Currently in-memory only |
| Config profiles (dev/prod/test) | Medium | Single config only |
| Load balancing across same-provider instances | Medium | Not implemented |
| Semantic caching (similarity-based, not exact match) | Low | Current cache is exact-match only |
| Install script obfuscation | Low | Plain text currently |

---

*360opsAI LLC — Confidential*
*Package: npmjs.com/package/360router*
