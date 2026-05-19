/**
 * Local provider scanner
 * Probes common localhost ports for Ollama, LM Studio, vLLM, Jan, and other OpenAI-compatible servers
 */

export interface ScanResult {
  name: string;
  url: string;
  online: boolean;
  models: string[];
  latencyMs: number;
  error?: string;
}

interface LocalProvider {
  name: string;
  port: number;
  label: string;
}

const KNOWN_PROVIDERS: LocalProvider[] = [
  { name: 'ollama', port: 11434, label: 'Ollama' },
  { name: 'lmstudio', port: 1234, label: 'LM Studio' },
  { name: 'vllm', port: 8000, label: 'vLLM' },
  { name: 'jan', port: 1337, label: 'Jan' }
];

/**
 * Ports scanned when the user provides an IP/hostname instead of a full URL.
 * Order matters: earlier entries are considered "more likely" when labelling.
 */
export const REMOTE_SCAN_PORTS: Array<{ port: number; label: string }> = [
  { port: 11434, label: 'Ollama' },
  { port: 1234,  label: 'LM Studio' },
  { port: 1337,  label: 'Jan' },
  { port: 8000,  label: 'vLLM' },
  { port: 18789, label: '360ops agent' },
  { port: 8080,  label: 'OpenAI-compatible (8080)' },
  { port: 3000,  label: 'OpenAI-compatible (3000)' }
];

const TIMEOUT_MS = 3000;

/**
 * Probe a single endpoint for models
 */
async function probeEndpoint(url: string, name: string): Promise<ScanResult> {
  const start = Date.now();
  const result: ScanResult = {
    name,
    url,
    online: false,
    models: [],
    latencyMs: 0
  };

  try {
    // Try Ollama-specific endpoint first
    if (name === 'ollama') {
      const response = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });

      if (response.ok) {
        const data = await response.json();
        result.online = true;
        result.latencyMs = Date.now() - start;
        result.models = (data.models || []).map((m: any) => m.name);
        return result;
      }
    }

    // Try OpenAI-compatible endpoint
    const response = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (response.ok) {
      const data = await response.json();
      result.online = true;
      result.latencyMs = Date.now() - start;
      result.models = (data.data || []).map((m: any) => m.id);
    }
  } catch (error: any) {
    result.error = error.message;
  }

  if (!result.online) {
    result.latencyMs = Date.now() - start;
  }

  return result;
}

/**
 * Scan localhost for known providers
 */
export async function scanLocalProviders(): Promise<ScanResult[]> {
  const probes = KNOWN_PROVIDERS.map(provider =>
    probeEndpoint(`http://localhost:${provider.port}`, provider.name)
  );

  return Promise.all(probes);
}

/**
 * Probe a custom remote endpoint
 */
export async function probeCustomEndpoint(
  url: string,
  apiKey?: string
): Promise<ScanResult> {
  const name = new URL(url).hostname;
  const start = Date.now();
  const result: ScanResult = {
    name,
    url,
    online: false,
    models: [],
    latencyMs: 0
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Try Ollama API first
    let response = await fetch(`${url}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (response.ok) {
      const data = await response.json();
      result.online = true;
      result.latencyMs = Date.now() - start;
      result.models = (data.models || []).map((m: any) => m.name);
      return result;
    }

    // Try OpenAI-compatible endpoint
    response = await fetch(`${url}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (response.ok) {
      const data = await response.json();
      result.online = true;
      result.latencyMs = Date.now() - start;
      result.models = (data.data || []).map((m: any) => m.id);
    }
  } catch (error: any) {
    result.error = error.message;
  }

  if (!result.online) {
    result.latencyMs = Date.now() - start;
  }

  return result;
}

/**
 * Result of scanning a single IP across {@link REMOTE_SCAN_PORTS}.
 */
export interface RemoteScanHit extends ScanResult {
  port: number;
  softwareLabel: string;
}

/**
 * Scan a single IP/hostname across the common inference-server ports
 * defined in {@link REMOTE_SCAN_PORTS}. Returns only reachable hits,
 * ordered by the port table (most common first).
 */
export async function scanRemoteIp(
  ip: string,
  apiKey?: string
): Promise<RemoteScanHit[]> {
  const probes = REMOTE_SCAN_PORTS.map(async ({ port, label }) => {
    const url = `http://${ip}:${port}`;
    const res = await probeCustomEndpoint(url, apiKey);
    return { ...res, port, softwareLabel: label };
  });

  const results = await Promise.all(probes);
  return results.filter(r => r.online);
}

/**
 * Get display label for a known provider
 */
export function getProviderLabel(name: string): string {
  const provider = KNOWN_PROVIDERS.find(p => p.name === name);
  return provider ? provider.label : name;
}

/**
 * Get default URL for a known provider
 */
export function getDefaultUrl(name: string): string {
  const provider = KNOWN_PROVIDERS.find(p => p.name === name);
  return provider ? `http://localhost:${provider.port}` : '';
}
