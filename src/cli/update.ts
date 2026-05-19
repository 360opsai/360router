/**
 * Self-update command — downloads latest binary from GitHub Releases
 *
 * No npm. Binary distribution only.
 * Checks 360opsai/360ops-releases for the latest release tag,
 * downloads the platform binary, replaces the current executable.
 */

import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { platform, arch, homedir } from 'os';
import { join } from 'path';

const CURRENT_VERSION = '2.4.0';
const RELEASES_REPO = '360opsai/360ops-releases';
const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

function getBinaryName(): string {
  const os = platform();
  if (os === 'win32') return '360router-win.exe';
  if (os === 'linux') return '360router-linux';
  if (os === 'darwin') return '360router-mac';
  return '360router-win.exe';
}

function getInstallPath(): string {
  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), '360Router', '360router.exe');
  }
  return join(homedir(), '.local', 'bin', '360router');
}

export async function runUpdate(): Promise<void> {
  console.log(chalk.bold.cyan('\n  360Router — Update\n'));
  console.log(`  Current version:  ${chalk.white(CURRENT_VERSION)}`);

  // Check latest release on GitHub
  console.log(chalk.dim('  Checking for updates...'));

  let latestTag: string;
  let downloadUrl: string;

  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`GitHub API ${res.status}`);

    const release = await res.json() as any;
    latestTag = release.tag_name || '';  // e.g. "360router-v2.4.0"

    const binaryName = getBinaryName();
    const asset = release.assets?.find((a: any) => a.name === binaryName);

    if (!asset) {
      console.log(chalk.yellow(`\n  No binary found for your platform (${platform()}-${arch()}).`));
      console.log(chalk.dim(`  Check: https://github.com/${RELEASES_REPO}/releases\n`));
      return;
    }

    downloadUrl = asset.browser_download_url;
  } catch (e: any) {
    console.log(chalk.red(`\n  ✗ Could not check for updates: ${e.message}\n`));
    return;
  }

  // Extract version from tag (e.g. "360router-v2.4.0" → "2.4.0")
  const latestVersion = latestTag.replace(/^360router-v/, '');
  console.log(`  Latest version:   ${chalk.white(latestVersion)}`);

  if (CURRENT_VERSION === latestVersion) {
    console.log(chalk.green('\n  ✓ Already up to date!\n'));
    return;
  }

  console.log(chalk.yellow(`\n  Update available: ${CURRENT_VERSION} → ${latestVersion}`));

  // Download new binary
  const installPath = getInstallPath();
  const backupPath = installPath + '.bak';
  const tempPath = installPath + '.new';

  console.log(chalk.dim(`  Downloading from ${RELEASES_REPO}...`));

  try {
    const res = await fetch(downloadUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);

    const totalBytes = parseInt(res.headers.get('content-length') || '0');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const { createWriteStream } = await import('fs');
    const writer = createWriteStream(tempPath);
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      downloaded += value.length;
      if (totalBytes > 0) {
        const pct = Math.round((downloaded / totalBytes) * 100);
        const mb = Math.round(downloaded / 1024 / 1024);
        process.stdout.write(`\r  Downloading: ${mb} MB (${pct}%)   `);
      }
    }
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log('');

    // Swap: current → backup, new → current
    if (existsSync(installPath)) {
      try { unlinkSync(backupPath); } catch { /* no old backup */ }
      renameSync(installPath, backupPath);
    }
    renameSync(tempPath, installPath);

    // Make executable on unix
    if (platform() !== 'win32') {
      execSync(`chmod +x "${installPath}"`, { stdio: 'pipe' });
    }

    console.log(chalk.green(`\n  ✓ Updated to ${latestVersion}`));
    console.log(chalk.dim(`  Binary: ${installPath}`));
    console.log(chalk.dim('  Restart 360router serve to use the new version.\n'));

  } catch (e: any) {
    // Restore backup if swap failed
    if (existsSync(backupPath) && !existsSync(installPath)) {
      try { renameSync(backupPath, installPath); } catch { /* */ }
    }
    try { unlinkSync(tempPath); } catch { /* */ }

    console.log(chalk.red(`\n  ✗ Update failed: ${e.message}`));
    console.log(chalk.dim(`  Download manually: https://github.com/${RELEASES_REPO}/releases\n`));
  }
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
