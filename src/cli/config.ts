/**
 * Config command — view and edit individual settings without re-running init
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, removeProvider } from '../core/config.js';
import type { ProviderConfig } from '../core/config.js';
import { getCurrentTier, getTierLimits } from '../core/tier-gate.js';
import { excludeModel, unexcludeModel, getExcludedModels, clearExclusions } from '../core/model-filter.js';

export async function runConfig(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === 'show' || !sub) {
    showConfig();
    return;
  }

  if (sub === 'path') {
    const Conf = (await import('conf')).default;
    const conf = new Conf({ projectName: '360router' });
    console.log(conf.path);
    return;
  }

  if (sub === 'reset') {
    const { confirm } = await inquirer.prompt([
      { type: 'confirm', name: 'confirm', message: 'Reset all configuration?', default: false }
    ]);
    if (confirm) {
      const Conf = (await import('conf')).default;
      const conf = new Conf({ projectName: '360router' });
      conf.clear();
      console.log(chalk.green('✓ Configuration reset\n'));
    }
    return;
  }

  if (sub === 'set') {
    await editConfig();
    return;
  }

  console.log(chalk.bold.cyan('\n  360router config\n'));
  console.log(`  ${chalk.cyan('config')}          Show current configuration`);
  console.log(`  ${chalk.cyan('config show')}     Show current configuration`);
  console.log(`  ${chalk.cyan('config set')}      Edit a setting interactively`);
  console.log(`  ${chalk.cyan('config path')}     Show config file location`);
  console.log(`  ${chalk.cyan('config reset')}    Reset all configuration\n`);
}

function showConfig(): void {
  const config = loadConfig();
  const tier = getCurrentTier();
  const limits = getTierLimits(tier);

  console.log(chalk.bold.cyan('\n  360Router Configuration\n'));

  // Tier
  console.log(chalk.bold('  Tier:'));
  if (tier === 'free') {
    console.log(`    ${chalk.yellow('Free')}  ${chalk.dim('[upgrade: https://360ops.ai/pricing]')}`);
  } else {
    console.log(`    ${chalk.green('Pro')}  ${config.licenseKey ? chalk.dim(`key: ...${config.licenseKey.slice(-8)}`) : ''}`);
  }
  console.log('');

  // Providers
  console.log(chalk.bold('  Providers:'));
  if (config.providers.length === 0) {
    console.log(chalk.dim('    None configured — run 360router init'));
  } else {
    for (const p of config.providers) {
      const status = p.enabled ? chalk.green('✓') : chalk.red('✗');
      const kind = p.kind === 'cloud' ? chalk.cyan('cloud') : chalk.green('local');
      const key = p.apiKey ? chalk.dim(` key: ...${p.apiKey.slice(-4)}`) : '';
      console.log(`    ${status} ${p.label ?? p.name} [${kind}]${p.baseUrl ? chalk.dim(` ${p.baseUrl}`) : ''}${key}`);
    }
  }

  // Features (tier-aware)
  console.log(chalk.bold('\n  Features (your tier):'));
  console.log(`    ${limits.streaming ? chalk.green('✓') : chalk.red('✗')} Streaming`);
  console.log(`    ${limits.toolCalls ? chalk.green('✓') : chalk.red('✗')} Tool calls`);
  console.log(`    ${limits.embeddings ? chalk.green('✓') : chalk.red('✗')} Embeddings`);
  console.log(`    ${limits.maxCloudProviders === Infinity ? chalk.green('✓ Unlimited') : chalk.yellow(`✓ ${limits.maxCloudProviders}`)} cloud providers`);
  console.log(`    ${limits.analyticsHistorical ? chalk.green('✓') : chalk.red('✗')} Historical analytics`);
  console.log(`    ${limits.sensitivityScrubAndBlock ? chalk.green('✓ Scrub+block') : chalk.yellow('✓ Flag only')} Sensitivity detector`);
  console.log(`    ${limits.miOutputValidator ? chalk.green('✓') : chalk.red('✗')} MI output validator`);
  console.log(`    ${chalk.dim(`Cache: ${limits.cacheMaxSize} entries, ${limits.cacheTtlSeconds}s TTL`)}`);
  console.log(`    ${chalk.dim(`Classifier: ${limits.classifierModel}`)}`);

  // Excluded models
  const excluded = config.excludedModels ?? [];
  if (excluded.length > 0) {
    console.log(chalk.bold('\n  Excluded Models:'));
    for (const p of excluded) {
      console.log(`    ${chalk.red('✗')} ${p}`);
    }
  }

  // Security
  console.log(chalk.bold('\n  Security:'));
  console.log(`    Proxy auth:     ${config.proxyApiKey ? chalk.green('enabled') : chalk.dim('disabled')}`);
  console.log(`    Rate limit:     ${config.rateLimitPerMinute ? chalk.white(config.rateLimitPerMinute + ' req/min') : chalk.dim(tier === 'free' ? '60 req/min (tier max)' : 'unlimited')}`);

  // Intelligence
  console.log(chalk.bold('\n  Intelligence:'));
  console.log(`    Adaptive classifier: ${config.useAdaptiveClassifier !== false ? chalk.green('on') : chalk.dim('off')}`);
  console.log(`    Quality gate:        ${config.qualityGateEnabled !== false ? chalk.green('on') : chalk.dim('off')}`);
  console.log(`    Response cache:      ${config.cacheEnabled !== false ? chalk.green('on') : chalk.dim('off')}`);

  // Telemetry
  console.log(chalk.bold('\n  Telemetry:'));
  console.log(`    Enabled: ${config.telemetryEnabled ? chalk.green('yes') : chalk.dim('no')}`);
  console.log('');
}

async function editConfig(): Promise<void> {
  const config = loadConfig();

  const { setting } = await inquirer.prompt([
    {
      type: 'list',
      name: 'setting',
      message: 'What do you want to change?',
      choices: [
        { name: 'Upgrade tier (activate Pro license)', value: 'tier' },
        { name: 'Add/update a cloud API key', value: 'apikey' },
        { name: 'Remove a provider', value: 'remove' },
        { name: 'Exclude a model (block from routing)', value: 'exclude' },
        { name: 'Un-exclude a model', value: 'unexclude' },
        { name: 'Proxy auth key', value: 'proxykey' },
        { name: 'Rate limit', value: 'ratelimit' },
        { name: 'Toggle adaptive classifier', value: 'classifier' },
        { name: 'Toggle quality gate', value: 'qualitygate' },
        { name: 'Toggle response cache', value: 'cache' },
        { name: 'Toggle telemetry', value: 'telemetry' },
        new inquirer.Separator(),
        { name: 'Cancel', value: 'cancel' },
      ]
    }
  ]);

  if (setting === 'cancel') return;

  if (setting === 'tier') {
    const currentTier = config.tier || 'free';
    if (currentTier === 'pro') {
      console.log(chalk.green('  Already on Pro tier\n'));
      return;
    }

    const { licenseKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'licenseKey',
        mask: '*',
        message: 'Enter Pro license key:',
        validate: (input: string) => input.trim() ? true : 'License key required'
      }
    ]);

    // TODO: Validate license key with backend (stub for now)
    saveConfig({ ...config, tier: 'pro', licenseKey: licenseKey.trim() });
    console.log(chalk.green('✓ Pro tier activated\n'));
    console.log(chalk.dim('  Restart 360router serve to apply changes.\n'));
  }

  if (setting === 'exclude') {
    const { pattern } = await inquirer.prompt([
      {
        type: 'input',
        name: 'pattern',
        message: 'Model name or pattern to exclude (supports * wildcard):',
        validate: (i: string) => i.trim() ? true : 'Pattern required'
      }
    ]);
    excludeModel(pattern);
    const current = getExcludedModels();
    console.log(chalk.green(`\n✓ Excluded: ${pattern}`));
    console.log(chalk.dim(`  Current exclude list: ${current.join(', ')}\n`));
    console.log(chalk.dim('  Examples of patterns:'));
    console.log(chalk.dim('    phi4-mini      — exact match'));
    console.log(chalk.dim('    qwen*          — all qwen models'));
    console.log(chalk.dim('    *3b*           — any model with 3b in name'));
    console.log(chalk.dim('    anthropic/*    — all models from a provider\n'));
    return;
  }

  if (setting === 'unexclude') {
    const current = getExcludedModels();
    if (current.length === 0) {
      console.log(chalk.dim('\n  No models are currently excluded.\n'));
      return;
    }
    const { pattern } = await inquirer.prompt([
      {
        type: 'list',
        name: 'pattern',
        message: 'Remove from exclude list:',
        choices: [
          ...current.map(p => ({ name: p, value: p })),
          new inquirer.Separator(),
          { name: 'Clear ALL exclusions', value: '__clear__' },
          { name: 'Cancel', value: '__cancel__' }
        ]
      }
    ]);
    if (pattern === '__cancel__') return;
    if (pattern === '__clear__') {
      clearExclusions();
      console.log(chalk.green('\n✓ All exclusions cleared\n'));
    } else {
      unexcludeModel(pattern);
      console.log(chalk.green(`\n✓ Un-excluded: ${pattern}\n`));
    }
    return;
  }

  if (setting === 'apikey') {
    const cloudProviders = config.providers.filter(p => p.kind === 'cloud');
    if (cloudProviders.length === 0) {
      console.log(chalk.yellow('  No cloud providers configured. Run 360router init to add one.\n'));
      return;
    }
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Which provider?',
        choices: cloudProviders.map(p => ({ name: `${p.label ?? p.name}${p.apiKey ? chalk.dim(` (current: ...${p.apiKey.slice(-4)})`) : ''}`, value: p.name }))
      }
    ]);
    const { apiKey } = await inquirer.prompt([
      { type: 'password', name: 'apiKey', mask: '*', message: 'New API key:', validate: (i: string) => i.trim() ? true : 'Key required' }
    ]);
    const p = config.providers.find(pr => pr.name === provider)!;
    p.apiKey = apiKey.trim();
    saveConfig(config);
    console.log(chalk.green(`✓ ${p.label ?? p.name} API key updated\n`));
  }

  if (setting === 'remove') {
    if (config.providers.length === 0) {
      console.log(chalk.dim('  No providers to remove.\n'));
      return;
    }
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Remove which provider?',
        choices: config.providers.map(p => ({ name: `${p.label ?? p.name} [${p.kind}]`, value: p.name }))
      }
    ]);
    removeProvider(provider);
    console.log(chalk.green(`✓ Removed\n`));
  }

  if (setting === 'proxykey') {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: config.proxyApiKey ? 'Proxy auth is enabled' : 'Proxy auth is disabled',
        choices: [
          { name: 'Set new proxy key', value: 'set' },
          { name: 'Disable proxy auth', value: 'disable' },
          { name: 'Cancel', value: 'cancel' },
        ]
      }
    ]);
    if (action === 'set') {
      const { key } = await inquirer.prompt([{ type: 'password', name: 'key', mask: '*', message: 'Proxy API key:' }]);
      if (key.trim()) { saveConfig({ ...config, proxyApiKey: key.trim() }); console.log(chalk.green('✓ Updated\n')); }
    } else if (action === 'disable') {
      saveConfig({ ...config, proxyApiKey: undefined }); console.log(chalk.green('✓ Proxy auth disabled\n'));
    }
  }

  if (setting === 'ratelimit') {
    const { rpm } = await inquirer.prompt([
      { type: 'number', name: 'rpm', message: 'Requests per minute (0 to disable):', default: config.rateLimitPerMinute ?? 60 }
    ]);
    saveConfig({ ...config, rateLimitPerMinute: rpm > 0 ? rpm : undefined });
    console.log(chalk.green(rpm > 0 ? `✓ Rate limit: ${rpm} req/min\n` : '✓ Rate limiting disabled\n'));
  }

  if (setting === 'classifier') {
    const current = config.useAdaptiveClassifier !== false;
    saveConfig({ ...config, useAdaptiveClassifier: !current });
    console.log(chalk.green(`✓ Adaptive classifier ${!current ? 'enabled' : 'disabled'}\n`));
  }

  if (setting === 'qualitygate') {
    const current = config.qualityGateEnabled !== false;
    saveConfig({ ...config, qualityGateEnabled: !current });
    console.log(chalk.green(`✓ Quality gate ${!current ? 'enabled' : 'disabled'}\n`));
  }

  if (setting === 'cache') {
    const current = config.cacheEnabled !== false;
    saveConfig({ ...config, cacheEnabled: !current });
    console.log(chalk.green(`✓ Response cache ${!current ? 'enabled' : 'disabled'}\n`));
  }

  if (setting === 'telemetry') {
    const current = config.telemetryEnabled ?? false;
    saveConfig({ ...config, telemetryEnabled: !current });
    console.log(chalk.green(`✓ Telemetry ${!current ? 'enabled' : 'disabled'}\n`));
  }
}
