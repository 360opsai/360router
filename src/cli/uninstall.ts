/**
 * Uninstall command — restore app configs and optionally remove 360router config
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync, unlinkSync } from 'fs';
import { scanApps, restoreApp } from '../scanner/app-scanner.js';
import { loadConfig } from '../core/config.js';
import Conf from 'conf';

export async function runUninstall(): Promise<void> {
  console.log(chalk.bold.cyan('\n  360Router — Uninstall\n'));

  // Step 1: Restore app configs from backups
  const apps = await scanApps();
  const appsWithBackups = apps.filter(a => existsSync(a.configPath + '.360router.bak'));

  if (appsWithBackups.length > 0) {
    console.log(chalk.bold('  Apps reconfigured by 360Router:\n'));
    for (const app of appsWithBackups) {
      console.log(`    ${chalk.cyan(app.name)} — ${chalk.dim(app.configPath)}`);
    }

    const { restoreApps } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'restoreApps',
        message: 'Restore original app configurations?',
        default: true,
      },
    ]);

    if (restoreApps) {
      for (const app of appsWithBackups) {
        const ok = restoreApp(app);
        if (ok) {
          console.log(chalk.green(`    ✓ ${app.name} — restored original config`));
          // Clean up backup file
          try { unlinkSync(app.configPath + '.360router.bak'); } catch { /* ok */ }
        } else {
          console.log(chalk.red(`    ✗ ${app.name} — could not restore`));
        }
      }
    }
  } else {
    console.log(chalk.dim('  No app configs to restore (none were reconfigured).\n'));
  }

  // Step 2: Show current provider config
  const config = loadConfig();
  const providers = config.providers.filter(p => p.enabled);
  if (providers.length > 0) {
    console.log(chalk.bold('\n  Configured providers:\n'));
    for (const p of providers) {
      console.log(`    ${p.kind === 'cloud' ? '☁️' : '🖥️'}  ${p.label ?? p.name}${p.apiKey ? chalk.dim(' (has API key)') : ''}`);
    }
  }

  // Step 3: Remove 360router config
  const { removeConfig } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'removeConfig',
      message: 'Remove 360Router configuration (API keys, providers, telemetry settings)?',
      default: false,
    },
  ]);

  if (removeConfig) {
    try {
      const conf = new Conf({ projectName: '360router' });
      const configPath = conf.path;
      conf.clear();
      console.log(chalk.green(`\n  ✓ Configuration cleared (${chalk.dim(configPath)})`));
    } catch (e: any) {
      console.log(chalk.red(`  ✗ Could not clear config: ${e.message}`));
    }
  }

  // Step 4: Show npm uninstall command
  console.log(chalk.bold('\n  To fully remove 360Router:\n'));
  console.log(chalk.cyan('    npm uninstall -g 360router\n'));

  console.log(chalk.dim('  Thank you for using 360Router.'));
  console.log(chalk.dim('  Feedback? hello@360ops.ai\n'));
}
