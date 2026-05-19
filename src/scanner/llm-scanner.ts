/**
 * LLM port scanner
 * Probes IPs and ports to discover LLM API servers
 */

export const KNOWN_LLM_PORTS = [
  { port: 11434, name: 'Ollama', software: 'ollama' },
  { port: 18789, name: 'OpenClaw', software: 'openclaw' },
  { port: 1234, name: 'LM Studio', software: 'lmstudio' },
  { port: 1337, name: 'Jan.ai', software: 'jan' },
  { port: 8000, name: 'vLLM', software: 'vllm' },
  { port: 8080, name: 'OpenAI-compat', software: 'custom' },
  { port: 3000, name: 'Custom server', software: 'custom' },
];

export interface PortScanResult {
  port: number;
  name: string;
  software: string;
  alive: boolean;
  models: string[];
  latencyMs: number;
}

export async function scanIP(ip: string, token?: string): Promise<PortScanResult[]> {
  const results = await Promise.all(
    KNOWN_LLM_PORTS.map(async ({ port, name, software }) => {
      const start = Date.now();
      const url = `http://${ip}:${port}`;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      // Try OpenAI-compatible /v1/models
      try {
        const res = await fetch(`${url}/v1/models`, {
          headers,
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (data.data ?? []).map((m: any) => m.id);
          return { port, name, software, alive: true, models, latencyMs: Date.now() - start };
        }
      } catch {
        /* try next */
      }

      // Try Ollama native /api/tags
      try {
        const res = await fetch(`${url}/api/tags`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const models = (data.models ?? []).map((m: any) => m.name);
          return {
            port,
            name: 'Ollama',
            software: 'ollama',
            alive: true,
            models,
            latencyMs: Date.now() - start,
          };
        }
      } catch {
        /* nothing */
      }

      return { port, name, software, alive: false, models: [], latencyMs: Date.now() - start };
    })
  );

  return results.filter(r => r.alive);
}

export async function scanLocalhost(): Promise<PortScanResult[]> {
  return scanIP('localhost');
}
