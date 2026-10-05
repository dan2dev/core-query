import { defineConfig } from 'tsup'

// Both builds run concurrently, so the ESM clean must spare the IIFE file.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/server.ts'],
    format: 'esm',
    target: 'es2020',
    dts: true,
    clean: ['!core-query.global.js'],
  },
  {
    entry: { 'core-query': 'src/global.ts' },
    format: 'iife',
    target: 'es2020',
    minify: true,
  },
])
