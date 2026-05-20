/**
 * Serve command — starts the proxy server
 */

import chalk from 'chalk';
import { startServer } from '../server/index.js';
import { healthCheckAll } from '../core/router.js';
import { loadConfig, isConfigured, type ModelRecord } from '../core/config.js';
import { createRoutingTable, type RoutingTable } from '../core/routing-table.js';
import { createProvider } from '../providers/index.js';
// Engine imported lazily inside runServe() to avoid binary load crashes

const HOT_LATENCY_MS  = 100;    // model already loaded in VRAM
const COLD_LATENCY_MS = 30000;  // model needs to load from disk

/**
 * Query each local provider's /api/ps, mark hot models with low latency
 * and cold models with high latency so Pareto scoring prefers loaded models.
 */
async function refreshHotModels(table: RoutingTable): Promise<void> {
  const config = loadConfig();
  const localProviders = config.providers.filter(p => p.enabled && p.kind === 'local' && p.baseUrl);

  const hotNames = new Set<string>();

  for (const provider of localProviders) {
    try {
      const r = await fetch(`${provider.baseUrl}/api/ps`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const data = await r.json() as any;
        const loaded: any[] = data.models ?? [];
        for (const m of loaded) {
          if (m.name) hotNames.add(m.name);
        }
      }
    } catch { /* provider offline or doesn't support /api/ps */ }
  }

  // Update every record in the routing table
  for (const record of table.getAll()) {
    table.upsert({
      ...record,
      latency_avg: hotNames.has(record.name) ? HOT_LATENCY_MS : COLD_LATENCY_MS,
    });
  }
}

export async function runServe(args: string[]): Promise<void> {
  if (!isConfigured()) {
    console.log(chalk.yellow('\n  No providers configured. Run: 360router init\n'));
    return;
  }

  const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3600');
  const skipEngine = args.includes('--no-engine');
  const config = loadConfig();

  console.log(chalk.bold.cyan('\n  360Router — Starting proxy server\n'));

  // Start native engine (downloads on first run, ~45MB + ~700MB model)
  if (!skipEngine) {
    let ensureEngine: any, isEngineRunning: any, getEngineUrl: any;
    try {
      const engineMod = await import('../engine/index.js');
      ensureEngine = engineMod.ensureEngine;
      isEngineRunning = engineMod.isEngineRunning;
      getEngineUrl = engineMod.getEngineUrl;
    } catch (err: any) {
      console.log(`  ${chalk.yellow('⚠')} Built-in engine unavailable: ${err.message}`);
      console.log('');
    }
    const engineUrl = ensureEngine ? await ensureEngine((msg: string) => {
      console.log(`  ${chalk.dim(msg)}`);
    }) : null;
    if (engineUrl) {
      console.log(`  ${chalk.green('✓')} ${chalk.white('Built-in engine')} ${chalk.dim(engineUrl)}`);
      console.log(chalk.gray('    Llama 3.2 1B classifier (native, no Ollama needed)'));
    } else {
      console.log(`  ${chalk.yellow('⚠')} ${chalk.dim('No built-in engine — using configured providers for classification')}`);
    }
    console.log('');
  }

  // Health check all providers
  console.log(chalk.gray('  Checking providers...'));
  const health = await healthCheckAll();
  const online = health.filter(h => h.online);
  const offline = health.filter(h => !h.online);

  for (const h of online) {
    const providerConfig = config.providers.find(p => p.name === h.name);
    const label = providerConfig?.label ?? h.name;
    console.log(`  ${chalk.green('✓')} ${chalk.white(label)} ${chalk.gray(h.latencyMs + 'ms')}`);
    if (h.modelCount > 0) {
      console.log(chalk.gray(`    ${h.modelCount} models available`));
    }
  }

  for (const h of offline) {
    const providerConfig = config.providers.find(p => p.name === h.name);
    const label = providerConfig?.label ?? h.name;
    console.log(`  ${chalk.red('✗')} ${chalk.gray(label)} — offline`);
  }

  if (online.length === 0) {
    console.log(chalk.red('\n  No providers available. Check your configuration.\n'));
    return;
  }

  // ── Seed the routing table with discovered models ──────────────────────────
  const routingTable = createRoutingTable(config.tier ?? 'free');

  function getTierScoreRange(modelName: string): [number, number] {
    const n = modelName.toLowerCase();
    if (n.includes('70b') || n.includes('72b') || n.includes('120b')) return [0.75, 1.0];
    if (n.includes('32b') || n.includes('30b'))                        return [0.50, 1.0];
    if (n.includes('14b') || n.includes('13b'))                        return [0.35, 0.75];
    if (n.includes('8b')  || n.includes('7b'))                         return [0.20, 0.60];
    if (n.includes('3b')  || n.includes('1b'))                         return [0.00, 0.35];
    return [0.0, 1.0]; // unknown size — accept all
  }
  for (const h of online) {
    const providerConfig = config.providers.find(p => p.name === h.name);
    if (!providerConfig) continue;
    try {
      const provider = createProvider(providerConfig);
      const models = await provider.listModels();
      for (const modelName of models) {
        const record: ModelRecord = {
          name: modelName,
          provider: providerConfig.name,
          tier: 'standard',
          tier_score_range: getTierScoreRange(modelName),
          capabilities: ['chat', 'code'],
          cost_per_1k: 0.001,
          latency_avg: h.latencyMs,
          context_window: 32768,
          status: 'alive',
          failure_count: 0,
          cooldown_until: null,
          detected_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          us_origin: true
        };
        routingTable.upsert(record);
      }
    } catch { /* skip provider if model list fails */ }
  }
  // Export routing table for router.ts to use
  (globalThis as any).__360routerTable = routingTable;

  // Stamp hot vs cold latency so Pareto scoring prefers loaded models
  await refreshHotModels(routingTable);
  setInterval(() => refreshHotModels(routingTable), 30_000);

  console.log();
  console.log(chalk.bold.white(`  Routing table:`));
  console.log(
    chalk.green(
      `    Local:  ${
        online
          .filter(h => config.providers.find(p => p.name === h.name)?.kind === 'local')
          .map(h => config.providers.find(p => p.name === h.name)?.label ?? h.name)
          .join(', ') || 'none'
      }`
    )
  );
  console.log(
    chalk.cyan(
      `    Cloud:  ${
        online
          .filter(h => config.providers.find(p => p.name === h.name)?.kind === 'cloud')
          .map(h => config.providers.find(p => p.name === h.name)?.label ?? h.name)
          .join(', ') || 'none'
      }`
    )
  );

  console.log();
  console.log(chalk.bold.white(`  Your apps should point to:`));
  console.log(chalk.cyan(`    http://localhost:${port}`));
  console.log(chalk.gray(`    API endpoint: http://localhost:${port}/v1`));
  console.log();

  startServer(port);

  // ── Keyboard shortcuts while serving ──────────────────────────────────────
  console.log(chalk.dim('  Keyboard: [s] status  [t] telemetry  [h] help  [q] quit\n'));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', async (key: string) => {
      if (key === 'q' || key === '\u0003') { // q or Ctrl+C
        console.log(chalk.gray('\n  Shutting down...'));
        process.exit(0);
      }

      if (key === 's') {
        try {
          const res = await fetch(`http://localhost:${port}/admin/status`, { signal: AbortSignal.timeout(2000) });
          const data = await res.json() as any;
          console.log(chalk.bold.cyan(`\n  ── Status ──`));
          console.log(chalk.white(`  Uptime: ${formatUptime(data.uptime)}`));
          console.log(chalk.white(`  Requests: ${data.stats.totalRequests} (${data.stats.successRate}% success)`));
          console.log(chalk.white(`  Providers: ${data.providers.map((p: any) => p.label).join(', ')}`));
          console.log('');
        } catch { console.log(chalk.red('  Could not fetch status')); }
      }

      if (key === 't') {
        try {
          const res = await fetch(`http://localhost:${port}/admin/telemetry`, { signal: AbortSignal.timeout(2000) });
          const data = await res.json() as any;
          console.log(chalk.bold.cyan(`\n  ── Telemetry ──`));
          console.log(chalk.white(`  Total: ${data.totalRequests} requests | ${data.successRate}% success`));
          if (data.byProvider.length > 0) {
            for (const p of data.byProvider) {
              console.log(chalk.gray(`    ${p.provider}: ${p.requests} req, avg ${p.avgLatencyMs}ms, ${p.successRate}% ok`));
            }
          } else {
            console.log(chalk.gray('    No requests yet'));
          }
          if (data.recentRequests.length > 0) {
            console.log(chalk.dim(`\n  Last 5 requests:`));
            for (const r of data.recentRequests.slice(-5)) {
              const icon = r.success ? chalk.green('✓') : chalk.red('✗');
              console.log(chalk.gray(`    ${icon} ${r.provider}/${r.model} ${r.latencyMs}ms`));
            }
          }
          console.log('');
        } catch { console.log(chalk.red('  Could not fetch telemetry')); }
      }

      if (key === 'h') {
        console.log(chalk.bold.cyan(`\n  ── Keyboard Shortcuts ──`));
        console.log(chalk.white('  [s] Server status + provider health'));
        console.log(chalk.white('  [t] Telemetry + request log'));
        console.log(chalk.white('  [h] This help'));
        console.log(chalk.white('  [q] Quit'));
        console.log(chalk.dim(`\n  Or from another terminal:`));
        console.log(chalk.gray(`    curl http://localhost:${port}/admin/status`));
        console.log(chalk.gray(`    curl http://localhost:${port}/admin/telemetry`));
        console.log(chalk.gray(`    360router status`));
        console.log(chalk.gray(`    360router telemetry`));
        console.log('');
      }
    });
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
