/**
 * Single-message routing command
 * Route a message and show response with metadata
 */

import chalk from 'chalk';
import ora from 'ora';
import { route } from '../core/router.js';
import { loadConfig } from '../core/config.js';

export async function runRoute(args: string[]) {
  const config = loadConfig();

  if (config.providers.length === 0) {
    console.log(chalk.yellow('\nNo providers configured.'));
    console.log(chalk.dim('Run ') + chalk.cyan('360router init') + chalk.dim(' to get started.\n'));
    return;
  }

  const message = args.join(' ').trim();

  if (!message) {
    console.log(chalk.red('\nError: No message provided'));
    console.log(chalk.dim('Usage: ') + chalk.cyan('360router route "Your message here"') + '\n');
    return;
  }

  const spinner = ora('Routing request').start();

  const result = await route([
    {
      role: 'user',
      content: message
    }
  ]);

  spinner.stop();

  if (!result.success) {
    console.log(chalk.red('\n✗ Route failed'));
    console.log(chalk.dim('Error: ') + chalk.red(result.error || 'Unknown error'));
    console.log(chalk.dim('Provider: ') + chalk.yellow(result.provider));
    console.log(chalk.dim('Tier: ') + chalk.yellow(result.tier));
    console.log();
    return;
  }

  console.log(chalk.green('\n✓ Route successful'));
  console.log(chalk.dim('Provider: ') + chalk.cyan(result.provider));
  console.log(chalk.dim('Model: ') + chalk.cyan(result.model));
  console.log(chalk.dim('Tier: ') + chalk.cyan(result.tier));
  console.log(chalk.dim('Latency: ') + chalk.cyan(`${result.latencyMs}ms`));
  console.log(chalk.dim('Reason: ') + chalk.dim(result.reason));

  if (result.piiDetected) {
    console.log(chalk.yellow('\n⚠ Potential sensitive data detected'));
  }

  console.log(chalk.bold('\nResponse:'));
  console.log(chalk.white(result.content));
  console.log();
}
