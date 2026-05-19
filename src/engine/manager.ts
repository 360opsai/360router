/**
 * 360ops Native Engine Manager
 *
 * Manages the lifecycle of the built-in llama-server process.
 * Starts on `360router serve`, stops on exit. Runs on an internal
 * port (9741) that's never exposed to the user.
 *
 * The classifier and any "local" routing can use this engine
 * without requiring Ollama or any external dependency.
 */

import { spawn, type ChildProcess } from 'child_process';
import { getServerBinaryPath, getModelPath, isEngineInstalled } from './download.js';

const INTERNAL_PORT = 9741;
const STARTUP_TIMEOUT = 15000; // 15s for model load

let serverProcess: ChildProcess | null = null;
let isRunning = false;

export function getEnginePort(): number {
  return INTERNAL_PORT;
}

export function getEngineUrl(): string {
  return `http://127.0.0.1:${INTERNAL_PORT}`;
}

export function isEngineRunning(): boolean {
  return isRunning;
}

/**
 * Start the built-in llama-server
 *
 * Loads the classifier model and listens on internal port.
 * Resolves when the server is ready to accept requests.
 */
export async function startEngine(): Promise<boolean> {
  if (isRunning) return true;

  if (!isEngineInstalled()) {
    console.log('  [engine] Not installed. Run: 360router init');
    return false;
  }

  const binaryPath = getServerBinaryPath();
  const modelPath = getModelPath();

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('  [engine] Startup timeout — falling back to configured providers');
      resolve(false);
    }, STARTUP_TIMEOUT);

    try {
      serverProcess = spawn(binaryPath, [
        '--model', modelPath,
        '--port', String(INTERNAL_PORT),
        '--host', '127.0.0.1',      // internal only — never exposed
        '--ctx-size', '2048',        // small context for classification
        '--n-predict', '128',        // classifier outputs are tiny
        '--threads', '2',            // don't hog CPU
        '--no-mmap',                 // avoid mmap issues on some platforms
        '--log-disable',             // quiet
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      serverProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString();
        // llama-server prints "listening on ..." when ready
        if (line.includes('listening') || line.includes('HTTP server')) {
          isRunning = true;
          clearTimeout(timeout);
          resolve(true);
        }
      });

      serverProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString();
        if (line.includes('listening') || line.includes('HTTP server')) {
          isRunning = true;
          clearTimeout(timeout);
          resolve(true);
        }
      });

      serverProcess.on('error', (err) => {
        console.log(`  [engine] Failed to start: ${err.message}`);
        clearTimeout(timeout);
        isRunning = false;
        resolve(false);
      });

      serverProcess.on('exit', (code) => {
        isRunning = false;
        serverProcess = null;
        if (code !== 0 && code !== null) {
          console.log(`  [engine] Exited with code ${code}`);
        }
      });

    } catch (err: any) {
      clearTimeout(timeout);
      console.log(`  [engine] Spawn error: ${err.message}`);
      resolve(false);
    }
  });
}

/**
 * Stop the built-in engine
 */
export function stopEngine(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
    isRunning = false;
  }
}

/**
 * Health check — is the engine responding?
 */
export async function checkEngineHealth(): Promise<boolean> {
  if (!isRunning) return false;

  try {
    const res = await fetch(`${getEngineUrl()}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Cleanup on process exit
process.on('exit', stopEngine);
process.on('SIGINT', () => { stopEngine(); process.exit(0); });
process.on('SIGTERM', () => { stopEngine(); process.exit(0); });
