#!/usr/bin/env node
// Two-step build:
//   1. esbuild bundles client/sidebar.ts → dist/devtools-client.js  (browser IIFE)
//   2. tsc compiles src/                 → dist/                    (Node ESM)

import { build } from 'esbuild'
import { execSync } from 'child_process'
import { mkdirSync } from 'fs'

mkdirSync('dist', { recursive: true })

// ── Step 1: client bundle ────────────────────────────────────────────────────

await build({
  entryPoints: ['client/sidebar.ts'],
  bundle: true,
  outfile: 'dist/devtools-client.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  minify: false,
  define: {
    // Replaced at build time; server injects the actual port when serving
    '__DEVTOOLS_PORT__': '4999',
  },
})

console.log('  client bundle  →  dist/devtools-client.js')

// ── Step 2: server TypeScript ────────────────────────────────────────────────

execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' })
console.log('  server bundle  →  dist/index.js')
