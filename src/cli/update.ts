/**
 * Self-update command
 *
 * Two paths:
 *  1. Dev / local install  — git pull → npm run build → npm install -g .
 *  2. npm global install   — npm install -g 360router@latest
 *
 * Detects which path applies automatically.
 */

import chalk from 'chalk';
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import ora from 'ora';

export const CURRENT_VERSION = '2.4.0';
const NPM_PACKAGE = '360router';

// ── Helpers ────────────────────────────────────────────────────────────────

function run(cmd: string, cwd?: string): { ok: boolean; out: string; err: string } {
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return { ok: true, out: out.trim(), err: '' };
  } catch (e: any) {
    return { ok: false, out: '', err: e.message ?? String(e) };
  }
}

/** Find where 360router is installed in the npm global node_modules. */
function findPackageDir(): string | null {
  const r = run('npm root -g');
  if (!r.ok) return null;
  const dir = join(r.out, NPM_PACKAGE);
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

/** Read installed version from package.json in the package dir. */
function readVersion(pkgDir: string): string {
  try {
    const { readFileSync } = require('fs') as typeof import('fs');
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    return pkg.version ?? CURRENT_VERSION;
  } catch { return CURRENT_VERSION; }
}

/** Check npm registry for the latest published version. */
async function fetchLatestNpmVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.version ?? null;
  } catch { return null; }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function runUpdate(): Promise<void> {
  console.log(chalk.bold.cyan('\n  360Router — Update\n'));

  const pkgDir = findPackageDir();
  const currentVersion = pkgDir ? readVersion(pkgDir) : CURRENT_VERSION;
  console.log(`  Installed version: ${chalk.white(currentVersion)}`);

  // ── Path 1: local git repo — pull + rebuild ──────────────────────────────
  // Guard: if pkgDir is inside node_modules it was copied there by `npm install -g .`
  // and devDependencies (tsup) won't be present — fall through to npm path instead.
  const isDevRepo = pkgDir &&
    existsSync(join(pkgDir, '.git')) &&
    !pkgDir.split(/[\\/]/).includes('node_modules');

  if (isDevRepo && pkgDir) {
    console.log(chalk.dim(`  Source: ${pkgDir} (git repo)\n`));

    // Check for remote updates
    const spinner = ora('Checking for updates...').start();
    const fetchResult = run('git fetch --quiet', pkgDir);
    spinner.stop();

    if (!fetchResult.ok) {
      console.log(chalk.yellow('  ⚠ Could not reach remote. Building from current source.\n'));
    } else {
      const behind = run('git rev-list HEAD..@{u} --count', pkgDir);
      const commitsBehind = parseInt(behind.out) || 0;

      if (commitsBehind === 0) {
        console.log(chalk.green('  ✓ Already up to date (no new commits)\n'));
        console.log(chalk.dim('  Rebuilding anyway to apply any local changes...\n'));
      } else {
        console.log(chalk.yellow(`  ↓ ${commitsBehind} new commit(s) available\n`));

        // Pull
        const pullSpinner = ora('Pulling latest changes...').start();
        const pull = run('git pull', pkgDir);
        pullSpinner.stop();

        if (!pull.ok) {
          console.log(chalk.red(`  ✗ git pull failed: ${pull.err}\n`));
          return;
        }
        console.log(chalk.green('  ✓ Pulled latest\n'));
      }
    }

    // Build
    const buildSpinner = ora('Building...').start();
    const build = run('npm run build', pkgDir);
    buildSpinner.stop();

    if (!build.ok) {
      console.log(chalk.red('  ✗ Build failed:\n'));
      console.log(chalk.dim('  ' + build.err.split('\n').slice(0, 10).join('\n  ')));
      return;
    }
    console.log(chalk.green('  ✓ Build complete\n'));

    // Reinstall globally
    const installSpinner = ora('Installing globally...').start();
    const install = run('npm install -g .', pkgDir);
    installSpinner.stop();

    if (!install.ok) {
      console.log(chalk.red(`  ✗ Install failed: ${install.err}\n`));
      return;
    }

    const newVersion = readVersion(pkgDir);
    console.log(chalk.green(`  ✓ 360router ${newVersion} installed\n`));
    console.log(chalk.dim('  Restart with: 360router stop  then  360router start\n'));
    return;
  }

  // ── Path 2: npm global install — check registry + upgrade ───────────────
  if (pkgDir) {
    console.log(chalk.dim(`  Source: npm global install\n`));
  }

  const spinner = ora('Checking npm registry...').start();
  const latestVersion = await fetchLatestNpmVersion();
  spinner.stop();

  if (!latestVersion) {
    console.log(chalk.yellow('  Could not reach npm registry.\n'));
    console.log(chalk.dim('  Manual update: npm install -g 360router@latest\n'));
    return;
  }

  console.log(`  Latest version:    ${chalk.white(latestVersion)}`);

  if (currentVersion === latestVersion) {
    console.log(chalk.green('\n  ✓ Already up to date!\n'));
    return;
  }

  console.log(chalk.yellow(`\n  Update available: ${currentVersion} → ${latestVersion}\n`));

  const installSpinner = ora(`Installing 360router@${latestVersion}...`).start();
  const result = run(`npm install -g ${NPM_PACKAGE}@latest`);
  installSpinner.stop();

  if (!result.ok) {
    console.log(chalk.red(`  ✗ Update failed: ${result.err}\n`));
    console.log(chalk.dim('  Try manually: npm install -g 360router@latest\n'));
    return;
  }

  console.log(chalk.green(`  ✓ Updated to ${latestVersion}\n`));
  console.log(chalk.dim('  Restart with: 360router stop  then  360router start\n'));
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
