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
 *   node scripts/release.js recruiter    # zip only recruiter
 *   node scripts/release.js --build      # build then zip both
 *
 * Output:
 *   dist/app.zip   (manifest.json at root — uploadable to CWS)
 *   dist/recruiter.zip
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const TARGETS = ['app', 'recruiter'];

function zipDir(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (process.platform !== 'win32') {
    // CI (ubuntu) has no `powershell`: zip from inside the folder so
    // manifest.json lands at the ZIP root.
    execSync(`zip -qr '${zipPath}' .`, { cwd: srcDir, stdio: 'inherit' });
    return;
  }
  // Windows: the built-in bsdtar (System32, not Git Bash's GNU tar) writes
  // "/" separators. PowerShell's Compress-Archive writes "\", which the
  // Chrome Web Store rejects. Top-level names are passed so entries have
  // no "./" prefix and manifest.json sits at the ZIP root.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-cf', zipPath, '-C', srcDir, ...fs.readdirSync(srcDir)], { stdio: 'inherit' });
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
  console.error('Usage: node scripts/release.js [app|recruiter] [--build]');
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
