import { defineConfig } from 'tsup';

/**
 * CJS bundle config — for pkg binary compilation.
 * Bundles EVERYTHING inline (dependencies included) so pkg doesn't
 * need to resolve any require() calls at runtime. This is essential
 * because the obfuscator turns require('...') into computed strings
 * that pkg can't statically analyze.
 */
export default defineConfig({
  entry: ['src/cli/main.ts'],
  format: 'cjs',
  outDir: 'dist-cjs',
  clean: true,
  target: 'node20',
  noExternal: [/.*/],  // bundle all deps
  // Node built-ins are already external by default
  shims: false,
  splitting: false,
  minify: false,       // pkg's snapshot will do the compression
  sourcemap: false,
  dts: false,
});
