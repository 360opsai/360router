#!/usr/bin/env node

/**
 * 360router CLI entry point
 * Command dispatcher: init | status | route | config | help
 */

import { runInit } from './init.js';
import { runStatus } from './status.js';
import { runRoute } from './route.js';
import { runServe } from './serve.js';
import { runUninstall } from './uninstall.js';
import { runUpdate } from './update.js';
import { runConfig } from './config.js';
import chalk from 'chalk';
import { getCurrentTier, getTierLimits } from '../core/tier-gate.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { excludeModel, unexcludeModel, getExcludedModels, clearExclusions } from '../core/model-filter.js';
import { scanApps, reconfigureApp } from '../scanner/app-scanner.js';
import inquirer from 'inquirer';

const VERSION = '2.4.0';

function showHelp() {
  console.log(`
${chalk.bold.cyan('360router')} ${chalk.dim(`v${VERSION}`)}
Smart AI model router — local first, cloud when needed

${chalk.bold('USAGE')}
  ${chalk.cyan('360router')} ${chalk.yellow('<command>')} ${chalk.dim('[options]')}

${chalk.bold('COMMANDS')}
  ${chalk.cyan('init')}           Interactive setup wizard (tier selection included)
  ${chalk.cyan('serve')}          Start the proxy server (port 3600)
  ${chalk.cyan('status')}         Show provider health and stats
  ${chalk.cyan('telemetry')}      Show routing telemetry (requires serve running)
  ${chalk.cyan('route')}          Route a single message
  ${chalk.cyan('config')}         View/edit settings (API keys, toggles, security)
  ${chalk.cyan('tier')}           Show current tier + upgrade info
  ${chalk.cyan('upgrade')}        Activate Pro license key
  ${chalk.cyan('exclude')}        Exclude a model from auto-routing (supports *)
  ${chalk.cyan('unexclude')}      Remove a model from the exclude list
  ${chalk.cyan('update')}         Check for updates and install latest version
  ${chalk.cyan('aiapp')}          Detect AI apps and rewire them to 360Router
  ${chalk.cyan('uninstall')}      Restore app configs + remove 360router config
  ${chalk.cyan('help')}           Show this help message

${chalk.bold('EXAMPLES')}
  ${chalk.dim('$')} 360router init
  ${chalk.dim('$')} 360router serve
  ${chalk.dim('$')} 360router status
  ${chalk.dim('$')} 360router telemetry
  ${chalk.dim('$')} 360router tier
  ${chalk.dim('$')} 360router upgrade sk-abc123...
  ${chalk.dim('$')} 360router route "What is 2+2?"

${chalk.bold('LEARN MORE')}
  Documentation: ${chalk.blue('https://360ops.ai/router')}
  Upgrade to Pro: ${chalk.blue('https://360ops.ai/pricing')}
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'init':
      await runInit();
      break;

    case 'serve':
      await runServe(args.slice(1));
      break;

    case 'config':
      await runConfig(args.slice(1));
      break;

    case 'status':
      await runStatus();
      break;

    case 'telemetry':
    case 'tele': {
      const port = args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3600';
      try {
        const res = await fetch(`http://localhost:${port}/admin/telemetry`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json() as any;
        console.log(chalk.bold.cyan('\n  360Router Telemetry\n'));

        // Overview
        console.log(chalk.bold('  Overview'));
        console.log(`    Requests:      ${data.totalRequests} total (${data.successRate}% success)`);
        console.log(`    Uptime:        ${formatUptime(data.uptimeSeconds ?? 0)}`);
        console.log(`    Since:         ${data.startedAt}`);

        // Routing split
        if (data.routing) {
          console.log(chalk.bold('\n  Routing'));
          console.log(`    Local:         ${data.routing.localCount} requests (${data.routing.localPct}%)`);
          console.log(`    Cloud:         ${data.routing.cloudCount} requests (${100 - data.routing.localPct}%)`);
          console.log(chalk.green(`    Privacy saves: ${data.routing.privacySaves} requests stayed on your hardware`));
        }

        // Token usage
        if (data.tokens && data.tokens.total > 0) {
          console.log(chalk.bold('\n  Token Usage'));
          console.log(`    Input:         ${data.tokens.totalInput.toLocaleString()} tokens`);
          console.log(`    Output:        ${data.tokens.totalOutput.toLocaleString()} tokens`);
          console.log(`    Total:         ${data.tokens.total.toLocaleString()} tokens`);
        }

        // Cost
        if (data.cost) {
          console.log(chalk.bold('\n  Cloud Cost'));
          console.log(`    Total spend:   $${data.cost.totalUsd.toFixed(4)}`);
          console.log(chalk.dim(`    ${data.cost.savedByLocal}`));
        }

        // Provider breakdown
        if (data.byProvider?.length > 0) {
          console.log(chalk.bold('\n  Provider Breakdown'));
          for (const p of data.byProvider) {
            const cost = p.costUsd > 0 ? chalk.yellow(` $${p.costUsd.toFixed(4)}`) : chalk.green(' free');
            console.log(`    ${chalk.cyan(p.provider)}: ${p.requests} req, avg ${p.avgLatencyMs}ms, ${p.successRate}% ok${cost}`);
          }
        }

        // Top models
        if (data.topModels?.length > 0) {
          console.log(chalk.bold('\n  Top Models'));
          for (const m of data.topModels.slice(0, 5)) {
            console.log(`    ${chalk.dim(m.count + 'x')} ${m.model}`);
          }
        }

        // Recent requests
        if (data.recentRequests?.length > 0) {
          console.log(chalk.bold('\n  Recent Requests'));
          for (const r of data.recentRequests.slice(-10)) {
            const icon = r.success ? chalk.green('✓') : chalk.red('✗');
            const cost = r.costUsd > 0 ? chalk.yellow(` $${r.costUsd.toFixed(4)}`) : '';
            const kind = r.kind === 'local' ? chalk.green('local') : chalk.cyan('cloud');
            console.log(`    ${icon} ${r.provider}/${r.model} — ${r.latencyMs}ms [${kind}]${cost}`);
          }
        }

        console.log('');
      } catch {
        console.log(chalk.yellow(`\n  360Router is not running on port ${port}.`));
        console.log(chalk.dim(`  Start it with: 360router serve\n`));
      }
      break;
    }

    case 'tier': {
      const tier = getCurrentTier();
      const limits = getTierLimits(tier);
      console.log(chalk.bold.cyan('\n  360Router Tier\n'));
      console.log(`  Current tier: ${tier === 'pro' ? chalk.green('Pro') : chalk.yellow('Free')}`);
      console.log('');
      console.log(chalk.bold('  Your limits:'));
      console.log(`    Cloud providers:        ${limits.maxCloudProviders === Infinity ? chalk.green('Unlimited') : chalk.yellow(limits.maxCloudProviders.toString())}`);
      console.log(`    Streaming:              ${limits.streaming ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
      console.log(`    Tool calls:             ${limits.toolCalls ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
      console.log(`    Embeddings:             ${limits.embeddings ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
      console.log(`    Rate limit:             ${limits.rateLimitMax === Infinity ? chalk.green('Unlimited') : chalk.yellow(limits.rateLimitMax + ' req/min')}`);
      console.log(`    Cache:                  ${chalk.white(limits.cacheMaxSize + ' entries, ' + limits.cacheTtlSeconds + 's TTL')}`);
      console.log(`    Historical analytics:   ${limits.analyticsHistorical ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
      console.log(`    Sensitivity scrubbing:  ${limits.sensitivityScrubAndBlock ? chalk.green('✓ Scrub+block') : chalk.yellow('✓ Flag only')}`);
      console.log(`    MI output validator:    ${limits.miOutputValidator ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
      console.log(`    Classifier model:       ${chalk.white(limits.classifierModel)}`);
      console.log('');
      if (tier === 'free') {
        console.log(chalk.bold('  Upgrade to Pro:'));
        console.log(`    ${chalk.blue('https://360ops.ai/pricing')}`);
        console.log('');
      }
      break;
    }

    case 'upgrade': {
      let licenseKey = args[1];

      // No arg → offer to open browser to pricing page
      if (!licenseKey) {
        console.log(chalk.bold.cyan('\n  360Router Pro\n'));
        console.log('  Pro unlocks: sensitivity scrubbing, persistence, audit logs,');
        console.log('  historical analytics, quality auto-escalation, MI validator,');
        console.log('  Phi-4-mini classifier, unlimited rate limits, and more.\n');

        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'How do you want to upgrade?',
            choices: [
              { name: 'Open the pricing page to buy Pro ($19/mo)', value: 'browser' },
              { name: 'I have a license key — paste it now', value: 'paste' },
              { name: 'Cancel', value: 'cancel' },
            ]
          }
        ]);

        if (action === 'cancel') break;

        if (action === 'browser') {
          // Primary: portal (unified account + billing in /dashboard)
          const url = 'https://portal.360ops.ai/router/upgrade';
          console.log(chalk.dim('\n  Opening ' + url));
          console.log(chalk.dim('  Sign in (or sign up) → subscribe → get your license key.'));
          console.log(chalk.dim('  You can also manage Router Pro from /dashboard/billing.'));
          console.log(chalk.dim('\n  After payment, run: 360router upgrade <your-key>\n'));
          try {
            const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            const { execSync } = await import('child_process');
            execSync(`${opener} "${url}"`, { stdio: 'ignore' });
          } catch { /* user can click manually */ }
          break;
        }

        const { key } = await inquirer.prompt([
          {
            type: 'password',
            name: 'key',
            mask: '*',
            message: 'Enter Pro license key:',
            validate: (input: string) => input.trim() ? true : 'License key required'
          }
        ]);
        licenseKey = key;
      }

      licenseKey = licenseKey.trim();

      // Verify against backend before saving
      console.log(chalk.dim('\n  Verifying license…'));
      try {
        const res = await fetch('https://llyftztfkadrnbtisagn.supabase.co/functions/v1/router-license-verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'sb_publishable_i2PkHuKmU3qTR7t7OwX3lg_zvRNiJUa',
            'Authorization': 'Bearer sb_publishable_i2PkHuKmU3qTR7t7OwX3lg_zvRNiJUa'
          },
          body: JSON.stringify({ license_key: licenseKey }),
          signal: AbortSignal.timeout(10000)
        });
        const data = await res.json() as any;

        if (!data.valid) {
          console.log(chalk.red(`\n  ✗ ${data.reason || 'License key invalid'}\n`));
          console.log(chalk.dim('  Check your email for the correct key, or visit:'));
          console.log(chalk.dim('  https://www.360ops.ai/360router.html#pricing\n'));
          process.exit(1);
        }

        const config = loadConfig();
        saveConfig({ ...config, tier: 'pro', licenseKey });
        console.log(chalk.green(`\n  ✓ Pro tier activated for ${data.email}`));
        if (data.expires_at) {
          console.log(chalk.dim(`  Valid until: ${new Date(data.expires_at).toLocaleDateString()}`));
        }
        console.log(chalk.dim('  Restart 360router serve to apply changes.\n'));
      } catch (e: any) {
        console.log(chalk.red(`\n  ✗ Could not reach license server: ${e.message}`));
        console.log(chalk.dim('  Check your internet connection and try again.\n'));
        process.exit(1);
      }
      break;
    }

    case 'exclude': {
      const pattern = args[1];
      if (!pattern) {
        // interactive mode — delegate to config command
        await runConfig(['set']);
        break;
      }
      excludeModel(pattern);
      const list = getExcludedModels();
      console.log(chalk.green(`\n✓ Excluded: ${pattern}`));
      console.log(chalk.dim(`  Current exclusions: ${list.join(', ')}\n`));
      break;
    }

    case 'unexclude': {
      const pattern = args[1];
      if (!pattern) {
        console.log(chalk.dim('\nUsage: 360router unexclude <pattern>'));
        console.log(chalk.dim('       360router unexclude --all\n'));
        console.log(chalk.bold('Currently excluded:'));
        const list = getExcludedModels();
        if (list.length === 0) {
          console.log(chalk.dim('  (none)\n'));
        } else {
          for (const p of list) console.log(`  - ${p}`);
          console.log('');
        }
        break;
      }
      if (pattern === '--all') {
        clearExclusions();
        console.log(chalk.green('\n✓ All exclusions cleared\n'));
      } else {
        unexcludeModel(pattern);
        console.log(chalk.green(`\n✓ Un-excluded: ${pattern}\n`));
      }
      break;
    }

    case 'aiapp': {
      console.log(chalk.bold.cyan('\n  360Router — AI App Setup\n'));
      const apps = await scanApps();

      if (apps.length === 0) {
        console.log(chalk.yellow('  No supported AI apps found.\n'));
        console.log(chalk.dim('  Supported: OpenClaw, Continue.dev, LM Studio\n'));
        break;
      }

      console.log(chalk.bold(`  Found ${apps.length} AI app(s):\n`));
      for (const app of apps) {
        const current = app.currentEndpoint ?? 'unknown';
        const alreadySet = current.includes('localhost:3600');
        const status = alreadySet
          ? chalk.green('✓ already pointing to 360Router')
          : chalk.yellow(`currently: ${current}`);
        console.log(`  ${chalk.cyan(app.name)} — ${status}`);
        console.log(chalk.dim(`    ${app.configPath}`));
      }
      console.log('');

      const toUpdate = apps.filter(a => {
        const c = a.currentEndpoint ?? '';
        return !c.includes('localhost:3600') && a.canReconfigure;
      });

      if (toUpdate.length === 0) {
        console.log(chalk.green('  All apps already point to 360Router. Nothing to do.\n'));
        break;
      }

      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Rewire ${toUpdate.length} app(s) to point to 360Router (http://localhost:3600)?`,
        default: true,
      }]);

      if (!confirm) {
        console.log(chalk.dim('\n  Cancelled. No changes made.\n'));
        break;
      }

      for (const app of toUpdate) {
        const ok = reconfigureApp(app);
        if (ok) {
          console.log(chalk.green(`  ✓ ${app.name} → http://localhost:3600`));
          console.log(chalk.dim(`    Backup saved: ${app.configPath}.360router.bak`));
        } else {
          console.log(chalk.red(`  ✗ ${app.name} — could not update config`));
        }
      }

      console.log(chalk.dim('\n  Restart any open AI apps to apply changes.\n'));
      break;
    }

    case 'update':
      await runUpdate();
      break;

    case 'uninstall':
      await runUninstall();
      break;

    case 'route':
      await runRoute(args.slice(1));
      break;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;

    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(chalk.red(`Unknown command: ${command}`));
      console.log(chalk.dim(`Run '360router help' for usage information`));
      process.exit(1);
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

main().catch(error => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
