/**
 * App scanner and reconfigurator
 * Detects AI apps and updates their configs to point to 360Router
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface DetectedApp {
  name: string;
  configPath: string;
  currentEndpoint: string | null;
  canReconfigure: boolean;
}

const ROUTER_URL = 'http://localhost:3600';

// Known AI apps and their config locations
const APP_CONFIGS = [
  {
    name: 'OpenClaw',
    paths: [join(homedir(), '.openclaw', 'openclaw.json')],
    read: (content: string) => {
      const json = JSON.parse(content);
      // Nested provider structure first (OpenClaw's real format)
      const providers = json.models?.providers;
      if (providers && typeof providers === 'object') {
        const first = Object.values(providers)[0] as any;
        return first?.baseUrl ?? first?.apiEndpoint ?? null;
      }
      // Fall back to flat structure
      return json.apiEndpoint ?? json.baseUrl ?? null;
    },
    write: (content: string) => {
      const json = JSON.parse(content);
      // Update nested provider structure — preserve every other field
      if (json.models?.providers && typeof json.models.providers === 'object') {
        for (const key of Object.keys(json.models.providers)) {
          const p = json.models.providers[key];
          if (p && typeof p === 'object') {
            if (p.baseUrl !== undefined) p.baseUrl = ROUTER_URL;
            if (p.apiEndpoint !== undefined) p.apiEndpoint = ROUTER_URL;
          }
        }
      }
      // Also update flat structure if present
      if (json.apiEndpoint !== undefined) json.apiEndpoint = ROUTER_URL;
      if (json.baseUrl !== undefined) json.baseUrl = ROUTER_URL;
      return JSON.stringify(json, null, 2);
    },
  },
  {
    name: 'Continue.dev',
    paths: [
      join(homedir(), '.continue', 'config.json'),
      join(homedir(), 'Library', 'Application Support', 'Continue', 'config.json'),
      join(process.env.APPDATA ?? '', 'Continue', 'config.json'),
    ],
    read: (content: string) => {
      const json = JSON.parse(content);
      return json.models?.[0]?.apiBase ?? null;
    },
    write: (content: string) => {
      const json = JSON.parse(content);
      if (json.models) {
        json.models = json.models.map((m: any) => ({
          ...m,
          apiBase: ROUTER_URL + '/v1',
        }));
      }
      return JSON.stringify(json, null, 2);
    },
  },
  {
    name: 'LM Studio',
    paths: [join(homedir(), '.lmstudio', 'config.json')],
    read: (content: string) => {
      const json = JSON.parse(content);
      return json.serverUrl ?? null;
    },
    write: (content: string) => {
      const json = JSON.parse(content);
      json.serverUrl = ROUTER_URL;
      return JSON.stringify(json, null, 2);
    },
  },
];

export async function scanApps(): Promise<DetectedApp[]> {
  const detected: DetectedApp[] = [];

  for (const app of APP_CONFIGS) {
    for (const configPath of app.paths) {
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8');
          const currentEndpoint = app.read(content);
          detected.push({
            name: app.name,
            configPath,
            currentEndpoint,
            canReconfigure: true,
          });
        } catch {
          detected.push({
            name: app.name,
            configPath,
            currentEndpoint: null,
            canReconfigure: false,
          });
        }
        break; // found config for this app, stop checking other paths
      }
    }
  }

  return detected;
}

export function reconfigureApp(app: DetectedApp): boolean {
  const appConfig = APP_CONFIGS.find(a => a.name === app.name);
  if (!appConfig || !app.canReconfigure) return false;

  try {
    const content = readFileSync(app.configPath, 'utf-8');

    // Backup original
    writeFileSync(app.configPath + '.360router.bak', content);

    // Write updated config
    const updated = appConfig.write(content);
    writeFileSync(app.configPath, updated);

    return true;
  } catch {
    return false;
  }
}

export function restoreApp(app: DetectedApp): boolean {
  const backupPath = app.configPath + '.360router.bak';
  if (!existsSync(backupPath)) return false;

  try {
    const backup = readFileSync(backupPath, 'utf-8');
    writeFileSync(app.configPath, backup);
    return true;
  } catch {
    return false;
  }
}
