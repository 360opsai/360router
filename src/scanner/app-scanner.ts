/**
 * App scanner and reconfigurator
 * Detects AI apps, presents a checkbox list, rewires selected ones to 360Router.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type ConfigMethod = 'auto' | 'instructions';

export interface DetectedApp {
  name: string;
  category: 'chat' | 'code' | 'webui' | 'agent';
  description: string;
  configPath: string | null;
  currentEndpoint: string | null;
  canReconfigure: boolean;
  method: ConfigMethod;
  instructions?: string;
}

const ROUTER_URL   = 'http://localhost:3600';
const ROUTER_V1    = 'http://localhost:3600/v1';

const appdata      = process.env.APPDATA      ?? join(homedir(), 'AppData', 'Roaming');
const localappdata = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
const vscodeUser   = join(appdata, 'Code', 'User');
const cursorUser   = join(appdata, 'Cursor', 'User');

// ─── App definitions ──────────────────────────────────────────────────────────

interface AppDef {
  name: string;
  category: 'chat' | 'code' | 'webui' | 'agent';
  description: string;
  method: ConfigMethod;
  instructions?: string;
  paths: string[];
  read?: (content: string) => string | null;
  write?: (content: string) => string;
}

const APP_DEFS: AppDef[] = [
  // ── Chat clients ────────────────────────────────────────────────────────────
  {
    name: 'OpenClaw',
    category: 'chat',
    description: 'AI chat client with multi-model support',
    method: 'auto',
    paths: [join(homedir(), '.openclaw', 'openclaw.json')],
    read: (c) => {
      const j = JSON.parse(c);
      const providers = j.models?.providers;
      if (providers && typeof providers === 'object') {
        const first = Object.values(providers)[0] as any;
        return first?.baseUrl ?? first?.apiEndpoint ?? null;
      }
      return j.apiEndpoint ?? j.baseUrl ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      if (j.models?.providers && typeof j.models.providers === 'object') {
        for (const key of Object.keys(j.models.providers)) {
          const p = j.models.providers[key];
          if (p && typeof p === 'object') {
            if (p.baseUrl    !== undefined) p.baseUrl    = ROUTER_URL;
            if (p.apiEndpoint !== undefined) p.apiEndpoint = ROUTER_URL;
          }
        }
      }
      if (j.apiEndpoint !== undefined) j.apiEndpoint = ROUTER_URL;
      if (j.baseUrl     !== undefined) j.baseUrl     = ROUTER_URL;
      return JSON.stringify(j, null, 2);
    },
  },

  {
    name: 'Chatbox',
    category: 'chat',
    description: 'Desktop AI client supporting multiple providers',
    method: 'auto',
    paths: [
      join(appdata, 'Chatbox', 'chatbox.json'),
      join(homedir(), 'Library', 'Application Support', 'Chatbox', 'chatbox.json'),
      join(homedir(), '.config', 'Chatbox', 'chatbox.json'),
    ],
    read: (c) => {
      const j = JSON.parse(c);
      return j.apiEndpoint ?? j.ollamaHost ?? j.openaiHost ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      if (j.apiEndpoint !== undefined) j.apiEndpoint = ROUTER_V1;
      if (j.ollamaHost  !== undefined) j.ollamaHost  = ROUTER_URL;
      if (j.openaiHost  !== undefined) j.openaiHost  = ROUTER_V1;
      return JSON.stringify(j, null, 2);
    },
  },

  {
    name: 'Jan',
    category: 'chat',
    description: 'Open-source local-first AI assistant',
    method: 'auto',
    paths: [
      join(homedir(), 'jan', 'settings', 'settings.json'),
      join(homedir(), '.config', 'jan', 'settings', 'settings.json'),
      join(homedir(), 'Library', 'Application Support', 'jan', 'settings', 'settings.json'),
    ],
    read: (c) => {
      const j = JSON.parse(c);
      return j.apiEndpoint ?? j.openai?.baseUrl ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      if (j.apiEndpoint !== undefined) j.apiEndpoint = ROUTER_V1;
      if (j.openai?.baseUrl !== undefined) j.openai.baseUrl = ROUTER_V1;
      return JSON.stringify(j, null, 2);
    },
  },

  {
    name: 'Msty',
    category: 'chat',
    description: 'Privacy-first AI chat with local model support',
    method: 'instructions',
    paths: [
      join(appdata, 'msty', 'config.json'),
      join(homedir(), 'Library', 'Application Support', 'msty', 'config.json'),
    ],
    instructions: `In Msty → Settings → Providers → add a new provider:
  Type:     OpenAI Compatible
  Base URL: ${ROUTER_V1}
  API Key:  (leave blank or use any value)`,
  },

  {
    name: 'GPT4All',
    category: 'chat',
    description: 'Run any large language model locally',
    method: 'auto',
    paths: [
      join(localappdata, 'nomic.ai', 'GPT4All', 'settings.ini'),
      join(homedir(), 'Library', 'Application Support', 'nomic.ai', 'GPT4All', 'settings.ini'),
      join(homedir(), '.config', 'nomic.ai', 'GPT4All', 'settings.ini'),
    ],
    read: (c) => {
      const m = c.match(/serverUrl\s*=\s*(.+)/);
      return m ? m[1].trim() : null;
    },
    write: (c) => c.replace(
      /serverUrl\s*=\s*.+/,
      `serverUrl = ${ROUTER_URL}`
    ),
  },

  // ── Code assistants ──────────────────────────────────────────────────────────
  {
    name: 'Continue.dev',
    category: 'code',
    description: 'Open-source AI code assistant for VS Code / JetBrains',
    method: 'auto',
    paths: [
      join(homedir(), '.continue', 'config.json'),
      join(homedir(), 'Library', 'Application Support', 'Continue', 'config.json'),
      join(appdata, 'Continue', 'config.json'),
    ],
    read: (c) => {
      const j = JSON.parse(c);
      return j.models?.[0]?.apiBase ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      if (j.models) {
        j.models = j.models.map((m: any) => ({ ...m, apiBase: ROUTER_V1 }));
      }
      return JSON.stringify(j, null, 2);
    },
  },

  {
    name: 'VS Code (Ollama extension)',
    category: 'code',
    description: 'VS Code settings for Ollama/AI extensions',
    method: 'auto',
    paths: [
      join(vscodeUser, 'settings.json'),
    ],
    read: (c) => {
      const j = JSON.parse(c);
      return j['ollama.url'] ?? j['ollama.apiBase'] ?? j['continue.apiBase'] ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      if (j['ollama.url']     !== undefined) j['ollama.url']     = ROUTER_URL;
      if (j['ollama.apiBase'] !== undefined) j['ollama.apiBase'] = ROUTER_V1;
      if (j['continue.apiBase'] !== undefined) j['continue.apiBase'] = ROUTER_V1;
      return JSON.stringify(j, null, 2);
    },
  },

  {
    name: 'Cursor',
    category: 'code',
    description: 'AI-first code editor',
    method: 'auto',
    paths: [
      join(cursorUser, 'settings.json'),
    ],
    read: (c) => {
      const j = JSON.parse(c);
      return j['ollama.url'] ?? j['cursor.aiApiBase'] ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      if (j['ollama.url']       !== undefined) j['ollama.url']       = ROUTER_URL;
      if (j['cursor.aiApiBase'] !== undefined) j['cursor.aiApiBase'] = ROUTER_V1;
      return JSON.stringify(j, null, 2);
    },
  },

  {
    name: 'LM Studio',
    category: 'code',
    description: 'Run and serve local LLMs with an OpenAI-compatible server',
    method: 'auto',
    paths: [
      join(homedir(), '.lmstudio', 'config.json'),
      join(homedir(), 'Library', 'Application Support', 'LM Studio', 'config.json'),
      join(appdata, 'LM Studio', 'config.json'),
    ],
    read: (c) => {
      const j = JSON.parse(c);
      return j.serverUrl ?? null;
    },
    write: (c) => {
      const j = JSON.parse(c);
      j.serverUrl = ROUTER_URL;
      return JSON.stringify(j, null, 2);
    },
  },

  // ── Web UIs ──────────────────────────────────────────────────────────────────
  {
    name: 'Open WebUI',
    category: 'webui',
    description: 'Feature-rich web interface for Ollama (formerly Ollama WebUI)',
    method: 'instructions',
    paths: [
      join(homedir(), '.open-webui', '.env'),
      join(homedir(), 'open-webui', '.env'),
    ],
    read: (c) => {
      const m = c.match(/OPENAI_API_BASE_URL\s*=\s*(.+)/);
      return m ? m[1].trim() : null;
    },
    write: (c) => {
      if (c.includes('OPENAI_API_BASE_URL=')) {
        return c.replace(/OPENAI_API_BASE_URL=.+/, `OPENAI_API_BASE_URL=${ROUTER_V1}`);
      }
      return c + `\nOPENAI_API_BASE_URL=${ROUTER_V1}\nOPENAI_API_KEY=360router\n`;
    },
    instructions: `Set these environment variables before starting Open WebUI:
  OPENAI_API_BASE_URL=${ROUTER_V1}
  OPENAI_API_KEY=360router

  Docker: add to your docker run / compose env block.
  pip:    set in your shell before running: open-webui serve`,
  },

  {
    name: 'AnythingLLM',
    category: 'webui',
    description: 'All-in-one AI app with RAG, agents, and multi-user support',
    method: 'instructions',
    paths: [
      join(appdata, 'anythingllm-desktop', 'storage', '.env'),
      join(homedir(), '.config', 'anythingllm-desktop', 'storage', '.env'),
    ],
    instructions: `In AnythingLLM → Settings → LLM Preference:
  Provider:  Generic OpenAI
  Base URL:  ${ROUTER_V1}
  API Key:   360router
  Model:     (leave blank — 360router picks automatically)`,
  },

  {
    name: 'SillyTavern',
    category: 'agent',
    description: 'Advanced AI roleplay and chat frontend',
    method: 'auto',
    paths: [
      join(homedir(), 'SillyTavern', 'config.yaml'),
      join(homedir(), 'Documents', 'SillyTavern', 'config.yaml'),
    ],
    read: (c) => {
      const m = c.match(/extra_proxy_url\s*:\s*(.+)/);
      return m ? m[1].trim() : null;
    },
    write: (c) => {
      if (c.includes('extra_proxy_url:')) {
        return c.replace(/extra_proxy_url\s*:.+/, `extra_proxy_url: ${ROUTER_V1}`);
      }
      return c + `\nextra_proxy_url: ${ROUTER_V1}\n`;
    },
  },

  {
    name: 'LibreChat',
    category: 'agent',
    description: 'Open-source ChatGPT-style interface supporting many providers',
    method: 'instructions',
    paths: [
      join(homedir(), 'LibreChat', '.env'),
      join(process.cwd(), '.env'),
    ],
    instructions: `In your LibreChat .env file, set:
  OPENAI_API_BASE_URL=${ROUTER_V1}
  OPENAI_API_KEY=360router

  Then restart LibreChat (npm run backend).`,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scanApps(): Promise<DetectedApp[]> {
  const results: DetectedApp[] = [];

  for (const def of APP_DEFS) {
    let foundPath: string | null = null;
    let currentEndpoint: string | null = null;
    let canReconfigure = false;

    for (const p of def.paths) {
      if (existsSync(p)) {
        foundPath = p;
        if (def.read) {
          try {
            currentEndpoint = def.read(readFileSync(p, 'utf-8'));
            canReconfigure = true;
          } catch { canReconfigure = false; }
        } else {
          // instructions-only — detected but not auto-configured
          canReconfigure = false;
        }
        break;
      }
    }

    // Override: instructions-only apps are always "not auto-configurable"
    if (def.method === 'instructions') canReconfigure = false;

    if (foundPath) {
      results.push({
        name:            def.name,
        category:        def.category,
        description:     def.description,
        configPath:      foundPath,
        currentEndpoint,
        canReconfigure,
        method:          def.method,
        instructions:    def.instructions,
      });
    }
  }

  return results;
}

export function reconfigureApp(app: DetectedApp): boolean {
  if (!app.configPath || !app.canReconfigure) return false;
  const def = APP_DEFS.find(d => d.name === app.name);
  if (!def?.write) return false;

  try {
    const content = readFileSync(app.configPath, 'utf-8');
    writeFileSync(app.configPath + '.360router.bak', content);
    writeFileSync(app.configPath, def.write(content));
    return true;
  } catch { return false; }
}

export function restoreApp(app: DetectedApp): boolean {
  const backup = (app.configPath ?? '') + '.360router.bak';
  if (!existsSync(backup)) return false;
  try {
    writeFileSync(app.configPath!, readFileSync(backup, 'utf-8'));
    return true;
  } catch { return false; }
}

export function isAlreadyConfigured(app: DetectedApp): boolean {
  const ep = app.currentEndpoint ?? '';
  return ep.includes('localhost:3600') || ep.includes('127.0.0.1:3600');
}
