/**
 * 360Router — Source Protection Pipeline
 *
 * Obfuscates the CJS bundle before pkg compiles it into a binary.
 * The bundle contains the moat algorithms (PMI/MI scorer, Rubik's
 * Cube dispatch, adaptive classifier, semantic PII, quality gate,
 * optimizer) in a single file — obfuscating the bundle protects all
 * of them at once.
 *
 * Config is TUNED for a long-running CLI / server process:
 *   - controlFlowFlattening: OFF (too slow for hot paths)
 *   - deadCodeInjection: OFF (bloats bundle)
 *   - debugProtection: OFF (crashes in some Node versions)
 *   - stringArray + splitStrings + renaming: ON (protects constants + names)
 *
 * This gives strong protection without making the proxy slow.
 */

import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TARGET = 'dist-cjs/main.cjs';

if (!existsSync(TARGET)) {
  console.error(`[obfuscate] Target not found: ${TARGET}`);
  console.error('[obfuscate] Run `npm run build:cjs` first.');
  process.exit(1);
}

const OBFUSCATION_CONFIG = {
  // Output
  compact: true,
  target: 'node',

  // Identifier renaming
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,        // NEVER rename globals — breaks require/etc.
  renameProperties: false,     // NEVER rename properties — breaks express/SDKs

  // String protection (moat: hides algorithm constants, prompts, thresholds)
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersType: 'function',
  splitStrings: true,
  splitStringsChunkLength: 10,
  unicodeEscapeSequence: false,

  // Numeric protection
  numbersToExpressions: true,

  // Structural — OFF for runtime performance
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  selfDefending: false,        // Node doesn't benefit from this
  simplify: true,

  // Don't break async/await
  transformObjectKeys: false,
};

console.log(`[obfuscate] Reading ${TARGET}...`);
const source = readFileSync(TARGET, 'utf8');
const sizeBefore = source.length;

console.log(`[obfuscate] Obfuscating ${(sizeBefore / 1024).toFixed(1)} KB...`);
const start = Date.now();
const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATION_CONFIG);
const obfuscated = result.getObfuscatedCode();
const sizeAfter = obfuscated.length;
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

writeFileSync(TARGET, obfuscated);

console.log(`[obfuscate] ✓ Done in ${elapsed}s`);
console.log(`[obfuscate]   Size: ${(sizeBefore / 1024).toFixed(1)} KB → ${(sizeAfter / 1024).toFixed(1)} KB (${(((sizeAfter - sizeBefore) / sizeBefore) * 100).toFixed(0)}%)`);
console.log('[obfuscate]   Next: npm run pkg:all');
