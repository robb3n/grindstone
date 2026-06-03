#!/usr/bin/env node
// Release gate (spec §8, CWE-215) — runs after the PRODUCTION esbuild and fails
// the build if any dev-only marker survived into main.js. This is the hard
// backstop behind "dev/prod build separation": if DCE ever stops stripping the
// `if (__GS_DEV__){}` branches, the dev pubkey / bypass would ship — and a
// cracked dev token would unlock production. Catch it here, not in the wild.
import { readFileSync } from 'fs';

const js = readFileSync('main.js', 'utf8');

// Derive the dev public key straight from source (no drift if keys rotate):
// it's the literal pushed inside the __GS_DEV__ branch of trustedPubkeysHex().
const keysSrc = readFileSync('src/license/keys.ts', 'utf8');
const devPubkey = keysSrc.match(/keys\.push\(\s*'([0-9a-fA-F]{64})'/)?.[1];

const forbidden = [];
if (devPubkey && js.includes(devPubkey)) forbidden.push('dev public key (DCE failed to strip the __GS_DEV__ branch)');
if (js.includes('__GS_DEV__')) forbidden.push('__GS_DEV__ flag identifier (define/DCE failed)');

if (forbidden.length) {
  console.error('\n✗ RELEASE GATE FAILED — dev markers leaked into main.js:');
  for (const f of forbidden) console.error(`    • ${f}`);
  console.error('\nThe production bundle must not contain dev licensing material. Aborting.\n');
  process.exit(1);
}

console.log('✓ release gate passed — no dev licensing markers in main.js');
