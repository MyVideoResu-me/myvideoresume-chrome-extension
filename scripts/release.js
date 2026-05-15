#!/usr/bin/env node

/**
 * hired.video Chrome Extension — Release Packager
 *
 * Reads the version from each extension's manifest.json and produces
 * the Chrome Web Store-ready ZIPs in dist/. Assumes `npm run build` has
 * already produced dist/<target>/ (or pass --build to run it first).
 *
 * Usage:
 *   node scripts/release.js              # zip both
 *   node scripts/release.js jobseeker    # zip only jobseeker
 *   node scripts/release.js recruiter    # zip only recruiter
 *   node scripts/release.js --build      # build then zip both
 *
 * Output:
 *   dist/jobseeker.zip   (manifest.json at root — uploadable to CWS)
 *   dist/recruiter.zip
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const TARGETS = ['jobseeker', 'recruiter'];

function zipDir(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  // PowerShell's Compress-Archive places the contents (not the parent
  // folder) at the ZIP root when the source pattern ends in /*.
  const ps = `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`;
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });
}

function release(target) {
  const srcDir = path.join(DIST_DIR, target);
  const zipPath = path.join(DIST_DIR, `${target}.zip`);
  const manifestPath = path.join(srcDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`dist/${target}/manifest.json not found — run "npm run build:${target}" first.`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`\nPacking ${target} v${manifest.version} → dist/${target}.zip`);

  zipDir(srcDir, zipPath);

  const stat = fs.statSync(zipPath);
  const sizeKB = (stat.size / 1024).toFixed(1);
  console.log(`  Created: dist/${target}.zip (${sizeKB} KB)`);
}

// ---- Main ---------------------------------------------------------------

const args = process.argv.slice(2);
const shouldBuild = args.includes('--build');
const target = args.find((a) => !a.startsWith('--'));

if (target && !TARGETS.includes(target)) {
  console.error(`Unknown target: ${target}`);
  console.error('Usage: node scripts/release.js [jobseeker|recruiter] [--build]');
  process.exit(1);
}

const targets = target ? [target] : TARGETS;

if (shouldBuild) {
  console.log('Building dist/ ...');
  execSync(`node ${path.join(__dirname, 'build.js')}${target ? ' ' + target : ''}`, {
    stdio: 'inherit',
    cwd: ROOT,
  });
}

for (const t of targets) {
  release(t);
}

console.log('\nRelease ZIPs ready. Upload to https://chrome.google.com/webstore/devconsole');
