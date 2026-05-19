/**
 * 360ops Native AI Engine
 *
 * Built-in inference server powered by llama.cpp.
 * No Ollama. No Python. No Docker. One install.
 *
 * Usage:
 *   import { ensureEngine, getEngineUrl, isEngineRunning } from './engine/index.js';
 *   await ensureEngine();  // downloads + starts on first run
 *   // classifier and providers can now use getEngineUrl()
 */

export { getEngineDir, getServerBinaryPath, getModelPath, isEngineInstalled, isServerInstalled, isModelInstalled, installEngine, installServer, installModel } from './download.js';
export { startEngine, stopEngine, getEnginePort, getEngineUrl, isEngineRunning, checkEngineHealth } from './manager.js';

import { isEngineInstalled, installEngine } from './download.js';
import { startEngine, isEngineRunning, getEngineUrl } from './manager.js';

/**
 * Ensure the native engine is installed and running.
 * Called by `360router serve` before starting the proxy.
 *
 * Returns the internal URL if engine is ready, null if not available.
 * NEVER blocks the proxy from starting — if engine fails, classification
 * falls back to configured providers or keyword heuristic.
 */
export async function ensureEngine(
  onProgress?: (msg: string) => void,
): Promise<string | null> {
  // Install if needed (first run only)
  if (!isEngineInstalled()) {
    try {
      await installEngine(onProgress);
    } catch (err: any) {
      onProgress?.(`Engine install failed: ${err.message}. Using configured providers.`);
      return null;
    }
  }

  // Start if not running
  if (!isEngineRunning()) {
    onProgress?.('Starting inference engine...');
    const started = await startEngine();
    if (!started) {
      onProgress?.('Engine start failed. Using configured providers.');
      return null;
    }
    onProgress?.('Engine ready ✓');
  }

  return getEngineUrl();
}
