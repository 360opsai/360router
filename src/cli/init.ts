/**
 * Interactive setup wizard
 * Scans for local providers, optionally adds cloud providers
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import {
  scanLocalProviders,
  probeCustomEndpoint,
  scanRemoteIp,
  REMOTE_SCAN_PORTS,
  getProviderLabel
} from '../core/scanner.js';
import { saveConfig, loadConfig, upsertProvider, setTelemetry } from '../core/config.js';
import { scanApps, reconfigureApp } from '../scanner/app-scanner.js';
import type { ProviderConfig } from '../core/config.js';
import { connect360ops } from './connect360ops.js';

export async function runInit() {
  // Welcome banner
  console.log(
    boxen(
      chalk.bold.cyan('360router') +
        '\n\n' +
        'Smart AI model router\n' +
        chalk.dim('Local first, cloud when needed'),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan'
      }
    )
  );

  // Tier selection
  console.log(chalk.bold('\nTier Selection'));
  const { tierChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'tierChoice',
      message: 'Which tier are you using?',
      choices: [
        {
          name: 'Free (default — single cloud, local-first, 1B classifier)',
          value: 'free'
        },
        {
          name: 'Pro (license key required — unlimited, advanced features)',
          value: 'pro'
        }
      ],
      default: 'free'
    }
  ]);

  let tier: 'free' | 'pro' = tierChoice;
  let licenseKey: string | undefined = undefined;

  if (tier === 'pro') {
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        mask: '*',
        message: 'Enter your Pro license key:',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'License key is required for Pro tier';
          }
          return true;
        }
      }
    ]);

    licenseKey = key.trim();
    // TODO: Validate license key with backend (stub for now)
    console.log(chalk.green('✓ License key accepted\n'));
  }

  // Save tier to config early
  saveConfig({
    ...loadConfig(),
    tier,
    licenseKey
  });

  // Regulated industry check
  console.log(chalk.bold('\nIndustry Compliance'));
  const { isRegulated } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'isRegulated',
      message: 'Are you in a regulated industry (HIPAA, GovCon, CMMC, SOC 2)?',
      default: false
    }
  ]);

  saveConfig({
    ...loadConfig(),
    regulatedMode: isRegulated
  });

  if (isRegulated) {
    console.log(chalk.dim('  Non-US origin models will be hidden from selection\n'));
  }

  // Telemetry opt-in
  console.log(chalk.bold('\nTelemetry'));
  console.log(
    chalk.dim(
      'Help us improve 360router by sharing anonymous performance metrics.\n' +
        'We collect: provider latency, success rates, error codes.\n' +
        'We never collect: prompts, responses, API keys, or personal data.'
    )
  );

  const { enableTelemetry } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableTelemetry',
      message: 'Enable telemetry?',
      default: false
    }
  ]);

  setTelemetry(enableTelemetry);

  // Scan for local providers
  console.log(chalk.bold('\nScanning for local providers...'));
  const spinner = ora('Probing localhost').start();

  const localResults = await scanLocalProviders();
  spinner.stop();

  const onlineProviders = localResults.filter(r => r.online);

  if (onlineProviders.length > 0) {
    console.log(chalk.green(`\n✓ Found ${onlineProviders.length} local provider(s):\n`));

    for (const provider of onlineProviders) {
      console.log(
        chalk.cyan(`  ${getProviderLabel(provider.name)}`) +
          chalk.dim(` (${provider.url})`)
      );
      console.log(
        chalk.dim(`    ${provider.models.length} models, ${provider.latencyMs}ms latency`)
      );

      // Add to config
      upsertProvider({
        name: provider.name,
        kind: 'local',
        enabled: true,
        baseUrl: provider.url,
        label: getProviderLabel(provider.name)
      });
    }
  } else {
    console.log(chalk.yellow('\nNo local providers found.'));
    console.log(
      chalk.dim(
        'Make sure Ollama, LM Studio, vLLM, or Jan is running on standard ports.'
      )
    );
  }

  // Ask about remote local providers
  const { hasRemoteLocal } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'hasRemoteLocal',
      message: 'Do you have local LLMs on another machine?',
      default: false
    }
  ]);

  if (hasRemoteLocal) {
    let addAnother = true;

    while (addAnother) {
      const { remoteInput, remoteToken } = await inquirer.prompt([
        {
          type: 'input',
          name: 'remoteInput',
          message: 'Remote IP address (or full URL):',
          validate: input => {
            const v = (input || '').trim();
            if (!v) return 'Please enter an IP, hostname, or URL';
            if (v.startsWith('http://') || v.startsWith('https://')) {
              try { new URL(v); return true; } catch { return 'Invalid URL'; }
            }
            // Basic IP/hostname sanity check — allow letters, digits, dots, dashes
            if (!/^[A-Za-z0-9.\-]+$/.test(v)) return 'Invalid IP or hostname';
            return true;
          }
        },
        {
          type: 'input',
          name: 'remoteToken',
          message: 'API token (optional, press Enter to skip):'
        }
      ]);

      const input      = (remoteInput as string).trim();
      const isFullUrl  = input.startsWith('http://') || input.startsWith('https://');
      const token      = (remoteToken || undefined) as string | undefined;
      let finalUrl: string | null = null;
      let finalName    = '';

      if (isFullUrl) {
        // Backwards-compatible: user gave a full URL — probe directly
        spinner.start('Probing remote endpoint');
        const result = await probeCustomEndpoint(input, token);
        spinner.stop();

        if (result.online) {
          console.log(chalk.green(`\n✓ Connected: ${result.models.length} models available\n`));
          finalUrl  = input;
          finalName = result.name;
        } else {
          console.log(chalk.red(`\n✗ Failed to connect: ${result.error}\n`));
        }
      } else {
        // IP/hostname → scan the common inference ports
        spinner.start(`Scanning ${input} on ${REMOTE_SCAN_PORTS.length} common ports`);
        const hits = await scanRemoteIp(input, token);
        spinner.stop();

        if (hits.length > 0) {
          console.log(chalk.green(`\n✓ Found ${hits.length} service(s) at ${input}:\n`));
          for (const h of hits) {
            console.log(
              chalk.cyan(`  :${h.port} — ${h.softwareLabel}`) +
                chalk.dim(` (${h.models.length} models, ${h.latencyMs}ms)`)
            );
          }
          console.log('');

          const choices = [
            ...hits.map(h => ({
              name: `:${h.port} — ${h.softwareLabel} (${h.models.length} models)`,
              value: String(h.port)
            })),
            new inquirer.Separator(),
            { name: 'Enter a custom port', value: '__custom__' }
          ];

          const { pickedPort } = await inquirer.prompt([
            {
              type: 'list',
              name: 'pickedPort',
              message: 'Which endpoint do you want to use?',
              choices
            }
          ]);

          let chosenPort: number | null = null;
          if (pickedPort === '__custom__') {
            const { customPort } = await inquirer.prompt([
              {
                type: 'input',
                name: 'customPort',
                message: 'Custom port:',
                validate: v => {
                  const n = Number(v);
                  return Number.isInteger(n) && n > 0 && n < 65536
                    ? true
                    : 'Port must be an integer between 1 and 65535';
                }
              }
            ]);
            chosenPort = Number(customPort);
          } else {
            chosenPort = Number(pickedPort);
          }

          const candidateUrl = `http://${input}:${chosenPort}`;
          spinner.start(`Probing ${candidateUrl}`);
          const probe = await probeCustomEndpoint(candidateUrl, token);
          spinner.stop();

          if (probe.online) {
            console.log(chalk.green(`\n✓ Connected: ${probe.models.length} models available\n`));
            finalUrl  = candidateUrl;
            finalName = probe.name || input;
          } else {
            console.log(chalk.red(`\n✗ Failed to connect to ${candidateUrl}: ${probe.error}\n`));
          }
        } else {
          console.log(chalk.yellow(`\nNo services detected at ${input} on common ports.\n`));
          const { tryCustom } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'tryCustom',
              message: 'Try a custom port manually?',
              default: false
            }
          ]);

          if (tryCustom) {
            const { customPort } = await inquirer.prompt([
              {
                type: 'input',
                name: 'customPort',
                message: 'Custom port:',
                validate: v => {
                  const n = Number(v);
                  return Number.isInteger(n) && n > 0 && n < 65536
                    ? true
                    : 'Port must be an integer between 1 and 65535';
                }
              }
            ]);
            const candidateUrl = `http://${input}:${Number(customPort)}`;
            spinner.start(`Probing ${candidateUrl}`);
            const probe = await probeCustomEndpoint(candidateUrl, token);
            spinner.stop();

            if (probe.online) {
              console.log(chalk.green(`\n✓ Connected: ${probe.models.length} models available\n`));
              finalUrl  = candidateUrl;
              finalName = probe.name || input;
            } else {
              console.log(chalk.red(`\n✗ Failed to connect: ${probe.error}\n`));
            }
          }
        }
      }

      if (finalUrl) {
        const { confirmAdd, label } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmAdd',
            message: 'Add this provider?',
            default: true
          },
          {
            type: 'input',
            name: 'label',
            message: 'Label for this provider:',
            default: finalName,
            when: answers => answers.confirmAdd
          }
        ]);

        if (confirmAdd) {
          upsertProvider({
            name: finalName,
            kind: 'local',
            enabled: true,
            baseUrl: finalUrl,
            apiKey: token,
            label
          });
          console.log(chalk.green('✓ Provider added\n'));
        }
      }

      const { continueAdding } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAdding',
          message: 'Add another remote endpoint?',
          default: false
        }
      ]);

      addAnother = continueAdding;
    }
  }

  // Cloud providers
  console.log(chalk.bold('\nCloud Providers (optional)'));
  console.log(
    chalk.dim(
      'Add API keys for cloud providers as fallback when local models are unavailable.'
    )
  );

  const { addCloud } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addCloud',
      message: 'Add cloud providers?',
      default: false
    }
  ]);

  if (addCloud) {
    const cloudProviders: Array<{
      name: string;
      label: string;
      keyName: string;
    }> = [
      { name: 'anthropic', label: 'Anthropic (Claude)', keyName: 'ANTHROPIC_API_KEY' },
      { name: 'openai', label: 'OpenAI (GPT)', keyName: 'OPENAI_API_KEY' },
      { name: 'groq', label: 'Groq', keyName: 'GROQ_API_KEY' },
      { name: 'gemini', label: 'Google Gemini', keyName: 'GEMINI_API_KEY' },
      { name: 'grok', label: 'xAI Grok', keyName: 'GROK_API_KEY' }
    ];

    const { selectedProviders } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedProviders',
        message: 'Select cloud providers:',
        choices: cloudProviders.map(p => ({ name: p.label, value: p.name }))
      }
    ]);

    // Normalize to array for consistent handling
    const providerList = Array.isArray(selectedProviders) ? selectedProviders : [selectedProviders];

    for (const providerName of providerList) {
      const provider = cloudProviders.find(p => p.name === providerName)!;

      let keyConfirmed = false;
      while (!keyConfirmed) {
        const { apiKey } = await inquirer.prompt([
          {
            type: 'password',
            name: 'apiKey',
            mask: '*',
            message: `${provider.label} API key:`,
            validate: input => (input.trim() ? true : 'API key is required')
          }
        ]);

        // Quick validation: test the key before saving
        const { confirmKey } = await inquirer.prompt([
          {
            type: 'list',
            name: 'confirmKey',
            message: `Save this key for ${provider.label}?`,
            choices: [
              { name: 'Yes — save and continue', value: 'save' },
              { name: 'Re-enter — I made a typo', value: 'retry' },
              { name: 'Skip — don\'t add this provider', value: 'skip' }
            ]
          }
        ]);

        if (confirmKey === 'save') {
          upsertProvider({
            name: provider.name,
            kind: 'cloud',
            enabled: true,
            apiKey,
            label: provider.label
          });
          console.log(chalk.green(`✓ ${provider.label} added\n`));
          keyConfirmed = true;
        } else if (confirmKey === 'skip') {
          console.log(chalk.dim(`  Skipped ${provider.label}\n`));
          keyConfirmed = true;
        }
        // 'retry' → loop again
      }
    }

  }

  // Proxy API Key (optional)
  console.log(chalk.bold('\nProxy Security (optional)'));
  console.log(chalk.dim('Set an API key to require authentication for all /v1/* endpoints'));

  const { setProxyKey } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setProxyKey',
      message: 'Set a proxy API key?',
      default: false
    }
  ]);

  if (setProxyKey) {
    const { proxyApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'proxyApiKey',
        mask: '*',
        message: 'Proxy API key (or press Enter to skip):',
        default: ''
      }
    ]);

    if (proxyApiKey.trim()) {
      saveConfig({
        ...loadConfig(),
        proxyApiKey: proxyApiKey.trim()
      });
      console.log(chalk.green('✓ Proxy API key configured\n'));
    } else {
      console.log(chalk.dim('  Skipped — no proxy auth\n'));
    }
  }

  // Rate limiting (optional)
  const { setRateLimit } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setRateLimit',
      message: 'Configure rate limiting?',
      default: false
    }
  ]);

  if (setRateLimit) {
    const { rateLimitPerMinute } = await inquirer.prompt([
      {
        type: 'number',
        name: 'rateLimitPerMinute',
        message: 'Requests per minute:',
        default: 60,
        validate: input => {
          const n = Number(input);
          return Number.isInteger(n) && n > 0 ? true : 'Must be a positive integer';
        }
      }
    ]);

    saveConfig({
      ...loadConfig(),
      rateLimitPerMinute
    });
    console.log(chalk.green(`✓ Rate limit set to ${rateLimitPerMinute} req/min\n`));
  }

  // Detect and reconfigure AI apps
  console.log(chalk.bold('\nAI App Detection'));
  console.log(chalk.dim('Scan for AI apps and reconfigure them to use 360Router'));

  const detectedApps = await scanApps();
  if (detectedApps.length > 0) {
    console.log(chalk.green(`\n✓ Found ${detectedApps.length} AI app(s) on this machine:\n`));
    for (const app of detectedApps) {
      console.log(`  ${chalk.bold(app.name)}`);
      console.log(chalk.gray(`    Currently pointing to: ${app.currentEndpoint ?? 'unknown'}`));
    }

    const { reconfigure } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reconfigure',
        message: `Reconfigure these apps to route through 360Router (localhost:3600)?`,
        default: true,
      },
    ]);

    if (reconfigure) {
      for (const app of detectedApps) {
        const success = reconfigureApp(app);
        if (success) {
          console.log(chalk.green(`  ✓ ${app.name} → localhost:3600`));
        } else {
          console.log(chalk.yellow(`  ⚠ ${app.name} — could not reconfigure automatically`));
          console.log(
            chalk.gray(`    Change API endpoint to http://localhost:3600 in ${app.name} settings`)
          );
        }
      }
    }
  } else {
    console.log(chalk.dim('\nNo AI apps detected (OpenClaw, Continue.dev, LM Studio)'));
  }

  // Show managed keys CTA
  console.log(
    boxen(
      chalk.bold('Need managed API keys?') +
        '\n\n' +
        chalk.dim('Get pre-configured cloud access without managing keys.\n') +
        chalk.blue('https://360ops.ai') +
        chalk.dim(' — from $3.99/mo'),
      {
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: 'blue'
      }
    )
  );

  // 360ops System connect (Spartan / Atlas)
  await connect360ops();

  // Done
  console.log(chalk.green.bold('\n✓ Setup complete!'));
  console.log(chalk.dim('\nNext steps:'));
  console.log(chalk.cyan('  360router serve') + chalk.dim('  — Start the proxy server'));
  console.log(chalk.cyan('  360router status') + chalk.dim('  — Check provider health'));
  console.log(
    chalk.cyan('  360router route "Hello"') + chalk.dim('  — Test routing\n')
  );
}
