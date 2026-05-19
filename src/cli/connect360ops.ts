/**
 * 360ops System Connector
 * Adds Spartan (local box) or Atlas (cloud) as a provider in 360router config.
 * OpenClaw is already pointed at localhost:3600 by app-scanner — this just
 * registers the 360ops backend so the router knows where to forward.
 *
 * No changes to Spartan or Atlas. Router config only.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import http from 'http';
import https from 'https';
import { upsertProvider } from '../core/config.js';

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function httpGet(url: string, apiKey?: string): Promise<{ ok: boolean; body: any; error?: string }> {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const req = mod.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, headers, timeout: 6000 }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve({ ok: true, body: JSON.parse(data) }); }
        catch { resolve({ ok: true, body: data }); }
      });
    });
    req.on('error', e => resolve({ ok: false, body: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: null, error: 'Connection timed out' }); });
  });
}

function httpsPost(hostname: string, path: string, body: object): Promise<{ status: number; body: any; error?: string }> {
  return new Promise(resolve => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 8000 },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      }
    );
    req.on('error', e => resolve({ status: 0, body: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'Connection timed out' }); });
    req.write(payload);
    req.end();
  });
}

// ─── Spartan connect ───────────────────────────────────────────────────────

async function connectSpartan(): Promise<boolean> {
  const { ip } = await inquirer.prompt([
    {
      type: 'input',
      name: 'ip',
      message: 'Spartan IP or Tailscale hostname:',
      default: '100.77.138.83',
      validate: (v: string) => v.trim() ? true : 'IP or hostname is required'
    }
  ]);

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      mask: '*',
      message: 'Spartan API key (press Enter to skip):',
    }
  ]);

  const host = (ip as string).trim();
  const key  = (apiKey as string).trim() || undefined;

  // Test router health
  const spinner = ora('Connecting to Spartan...').start();
  const health = await httpGet(`http://${host}:4000/health`, key);
  spinner.stop();

  if (!health.ok) {
    console.log(chalk.red(`\n  ✗ Could not reach Spartan at ${host}:4000`));
    console.log(chalk.dim(`    ${health.error ?? 'No response'}`));
    console.log(chalk.dim('    Make sure the Spartan AI Router is running and the IP is correct.\n'));
    return false;
  }

  // Fetch model list
  const models = await httpGet(`http://${host}:4000/api/models`, key);
  const modelCount = models.ok && Array.isArray(models.body?.data) ? models.body.data.length : 0;

  console.log(chalk.green(`\n  ✓ Spartan reachable at ${host}:4000`));
  if (modelCount > 0) {
    console.log(chalk.green(`  ✓ ${modelCount} models available`));
  }

  // Register as provider in router config
  // Points at Ollama on the Spartan box (the actual inference engine)
  upsertProvider({
    name:    'spartan',
    kind:    'local',
    enabled: true,
    baseUrl: `http://${host}:11434`,
    apiKey:  key,
    label:   `360ops Spartan (${host})`
  });

  console.log(chalk.green('  ✓ Spartan added as provider → 360router will route to it\n'));
  return true;
}

// ─── Atlas connect ─────────────────────────────────────────────────────────

async function connectAtlas(): Promise<boolean> {
  const { url } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Atlas URL:',
      default: 'portal.360ops.ai'
    }
  ]);

  const { email } = await inquirer.prompt([
    {
      type: 'input',
      name: 'email',
      message: 'Email:',
      validate: (v: string) => v.trim().includes('@') ? true : 'Enter a valid email'
    }
  ]);

  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      mask: '*',
      message: 'Password:',
      validate: (v: string) => v.trim() ? true : 'Password is required'
    }
  ]);

  const hostname = (url as string).trim().replace(/^https?:\/\//, '');

  const spinner = ora('Authenticating with Atlas...').start();
  const result  = await httpsPost(hostname, '/api/auth/login', {
    email:    (email as string).trim(),
    password: (password as string).trim()
  });
  spinner.stop();

  if (result.status !== 200 || !result.body?.token) {
    console.log(chalk.red('\n  ✗ Authentication failed'));
    console.log(chalk.dim(`    ${result.body?.error ?? result.body?.message ?? `HTTP ${result.status}`}\n`));
    return false;
  }

  const orgName = result.body.org?.name ?? 'Atlas';
  const plan    = result.body.org?.plan  ?? 'Unknown';
  const token   = result.body.token as string;

  console.log(chalk.green(`\n  ✓ Authenticated — ${orgName} (${plan})`));

  // Register as provider in router config
  upsertProvider({
    name:    'atlas',
    kind:    'cloud',
    enabled: true,
    baseUrl: `https://${hostname}/api/ai/v1`,
    apiKey:  token,
    label:   `360ops Atlas (${orgName})`
  });

  console.log(chalk.green('  ✓ Atlas added as provider → 360router will route to it\n'));
  return true;
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function connect360ops(): Promise<void> {
  console.log(chalk.bold('\n360ops System (optional)'));
  console.log(chalk.dim('Connect to your Spartan local AI box or Atlas cloud.'));
  console.log(chalk.dim('OpenClaw will route through 360Router → your 360ops system.\n'));

  const { systemChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'systemChoice',
      message: 'Connect to a 360ops system?',
      choices: [
        { name: 'Spartan  — local AI box, data stays on-prem', value: 'spartan' },
        { name: 'Atlas    — cloud, portal.360ops.ai',          value: 'atlas'   },
        { name: 'Skip for now',                                value: 'skip'    }
      ],
      default: 'skip'
    }
  ]);

  if (systemChoice === 'skip') {
    console.log(chalk.dim('  Skipped. Run 360router init again to connect later.\n'));
    return;
  }

  const success = systemChoice === 'spartan'
    ? await connectSpartan()
    : await connectAtlas();

  if (!success) {
    const { retry } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'retry',
        message: 'Try again?',
        default: false
      }
    ]);
    if (retry) return connect360ops();
  }
}
