/**
 * Provider health status command
 * Shows online/offline status, latency, model counts, and privacy stats
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { healthCheckAll } from '../core/router.js';
import { loadConfig } from '../core/config.js';

export async function runStatus() {
  const config = loadConfig();

  if (config.providers.length === 0) {
    console.log(chalk.yellow('\nNo providers configured.'));
    console.log(chalk.dim('Run ') + chalk.cyan('360router init') + chalk.dim(' to get started.\n'));
    return;
  }

  console.log(chalk.bold('\nProvider Health Status\n'));

  const spinner = ora('Checking providers').start();
  const results = await healthCheckAll();
  spinner.stop();

  // Group by kind
  const localProviders = results.filter(r => r.kind === 'local');
  const cloudProviders = results.filter(r => r.kind === 'cloud');

  if (localProviders.length > 0) {
    console.log(chalk.bold.cyan('Local Providers'));
    for (const provider of localProviders) {
      const status = provider.online
        ? chalk.green('● online')
        : chalk.red('● offline');
      const latency = provider.online
        ? chalk.dim(`${provider.latencyMs}ms`)
        : '';
      const models = provider.online
        ? chalk.dim(`${provider.modelCount} models`)
        : chalk.dim(provider.error || 'unreachable');

      console.log(`  ${status}  ${chalk.cyan(provider.name)}  ${latency}  ${models}`);
    }
    console.log();
  }

  if (cloudProviders.length > 0) {
    console.log(chalk.bold.cyan('Cloud Providers'));
    for (const provider of cloudProviders) {
      const status = provider.online
        ? chalk.green('● online')
        : chalk.red('● offline');
      const latency = provider.online
        ? chalk.dim(`${provider.latencyMs}ms`)
        : '';
      const models = provider.online
        ? chalk.dim(`${provider.modelCount} models`)
        : chalk.dim(provider.error || 'unreachable');

      console.log(`  ${status}  ${chalk.cyan(provider.name)}  ${latency}  ${models}`);
    }
    console.log();
  }

  // Privacy counter
  const piiCount = config.history.piiDetected;
  const lastReset = new Date(config.history.lastResetDate).toLocaleDateString();

  console.log(chalk.bold.cyan('Privacy Counter'));
  console.log(
    chalk.dim('  Prompts with potential sensitive data sent to cloud this month: ') +
      chalk.yellow(piiCount.toString())
  );
  console.log(chalk.dim(`  Counter resets monthly (last: ${lastReset})`));
  console.log();

  // Total routes
  console.log(chalk.bold.cyan('Usage'));
  console.log(
    chalk.dim('  Total routes: ') + chalk.white(config.history.totalRoutes.toString())
  );
  console.log();

  // 360ops upgrade CTA
  if (cloudProviders.length === 0) {
    console.log(
      boxen(
        chalk.bold('Upgrade to managed cloud access') +
          '\n\n' +
          chalk.dim('Add cloud fallback without managing API keys.\n') +
          chalk.blue('https://360ops.ai') +
          chalk.dim(' — from $3.99/mo'),
        {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'blue'
        }
      )
    );
    console.log();
  }

  // Telemetry status
  console.log(
    chalk.dim('Telemetry: ') +
      (config.telemetry ? chalk.green('enabled') : chalk.yellow('disabled'))
  );
  console.log();
}
