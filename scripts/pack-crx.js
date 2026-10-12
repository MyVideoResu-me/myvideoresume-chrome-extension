#!/usr/bin/env node

/**
 * hired.video Chrome Extension — CRX3 Packager
 *
 * Packs the built dist/<target> directory into a signed .crx file.
 * Generates a private key on first run (stored as <target>.pem).
 *
 * Usage:
 *   node scripts/pack-crx.js              # pack both
 *   node scripts/pack-crx.js jobseeker    # pack only jobseeker
 *   node scripts/pack-crx.js recruiter    # pack only recruiter
 *
 * Output:
 *   dist/jobseeker.crx   (+ jobseeker.pem on first run)
 *   dist/recruiter.crx   (+ recruiter.pem on first run)
 */

const fs = require('fs');
const path = require('path');
const crx3 = require('crx3');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const TARGETS = ['jobseeker', 'recruiter'];

async function packExtension(target) {
  const extDir = path.join(DIST_DIR, target);
  const crxPath = path.join(DIST_DIR, `${target}.crx`);
  const keyPath = path.join(ROOT, `${target}.pem`);

  if (!fs.existsSync(extDir)) {
    console.error(`dist/${target}/ not found — run "npm run build:${target}" first.`);
    process.exit(1);
  }

  console.log(`\nPacking ${target} → dist/${target}.crx`);

  const opts = {
    crxPath,
  };

  // Reuse existing key for stable extension ID, or let crx3 generate one
  if (fs.existsSync(keyPath)) {
    opts.keyPath = keyPath;
    console.log(`  Using existing key: ${target}.pem`);
  } else {
    opts.keyPath = keyPath; // crx3 writes the key here on first run
    console.log(`  Generating new key → ${target}.pem`);
  }

  // Collect all files in the dist directory
  const files = collectFiles(extDir);
  console.log(`  ${files.length} files to pack`);

  await crx3(
    files.map((f) => path.join(extDir, f)),
    {
      keyPath: opts.keyPath,
      crxPath: opts.crxPath,
    }
  );

  const stat = fs.statSync(crxPath);
  const sizeKB = (stat.size / 1024).toFixed(1);
  console.log(`  Created: dist/${target}.crx (${sizeKB} KB)`);
}

function collectFiles(dir, base) {
  base = base || dir;
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const relPath = path.relative(base, fullPath);
    if (fs.statSync(fullPath).isDirectory()) {
      results.push(...collectFiles(fullPath, base));
    } else {
      results.push(relPath);
    }
  }
  return results.sort();
}

// ---- Main ---------------------------------------------------------------

async function main() {
  const target = process.argv[2];

  if (target && !TARGETS.includes(target)) {
    console.error(`Unknown target: ${target}`);
    console.error('Usage: node scripts/pack-crx.js [jobseeker|recruiter]');
    process.exit(1);
  }

  const targets = target ? [target] : TARGETS;

  for (const t of targets) {
    await packExtension(t);
  }

  console.log('\nCRX packaging complete.');
}

main().catch((err) => {
  console.error('Pack failed:', err);
  process.exit(1);
});
