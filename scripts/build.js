#!/usr/bin/env node

/**
 * hired.video Chrome Extension - Build Script
 *
 * Assembles two Chrome extensions (jobseeker + recruiter) from the
 * shared/ directory plus each extension's own files.
 *
 * Usage:
 *   node scripts/build.js              # build both
 *   node scripts/build.js jobseeker    # build only jobseeker
 *   node scripts/build.js recruiter    # build only recruiter
 *
 * Output:
 *   dist/jobseeker/   — ready to load unpacked or zip
 *   dist/recruiter/   — ready to load unpacked or zip
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SHARED_DIR = path.join(ROOT, 'shared');
const DIST_DIR = path.join(ROOT, 'dist');

// TypeScript content scripts under shared/ are bundled by esbuild so they
// can import from the cross-project shared TS modules at
// ../hired.video/shared/*. The bundled output is plain IIFE JS — no
// module system needed, which matches Chrome MV3 content_script loading.
const TS_ENTRYPOINTS = {
  'content-script-jobs.js': path.join(SHARED_DIR, 'content-script-jobs.ts'),
  'content-script-autofill.js': path.join(SHARED_DIR, 'content-script-autofill.ts'),
};

const EXTENSIONS = {
  jobseeker: {
    src: path.join(ROOT, 'jobseeker'),
    dist: path.join(DIST_DIR, 'jobseeker'),
    // Service worker = shared base + extension-specific (concatenated)
    serviceWorkerFiles: ['service-worker-base.js', 'service-worker.js'],
  },
  recruiter: {
    src: path.join(ROOT, 'recruiter'),
    dist: path.join(DIST_DIR, 'recruiter'),
    serviceWorkerFiles: ['service-worker-base.js', 'service-worker.js'],
  },
};

// Files/dirs in shared/ that should NOT be copied directly (handled specially)
const SKIP_IN_SHARED = new Set([
  'service-worker-base.js', // concatenated into service-worker.js
  'web-ext-config.cjs',     // dev-only, not part of the extension
  // TS content scripts — bundled by esbuild, not copied raw.
  'content-script-jobs.ts',
  'content-script-autofill.ts',
  // Legacy JS versions that are superseded by the TS bundle. The build
  // emits the bundled output AT the same filename so the manifest keeps
  // working; the raw JS originals stay in git as the migration backstop
  // but do NOT ship.
  'content-script-jobs.js',
  'content-script-autofill.js',
]);

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function buildExtension(name) {
  const config = EXTENSIONS[name];
  console.log(`\n--- Building ${name} ---`);

  // 1. Clean dist
  cleanDir(config.dist);

  // 2. Copy shared/ into dist (except skipped files)
  console.log('  Copying shared/ ...');
  for (const entry of fs.readdirSync(SHARED_DIR)) {
    if (SKIP_IN_SHARED.has(entry)) continue;
    const src = path.join(SHARED_DIR, entry);
    const dest = path.join(config.dist, entry);
    copyRecursive(src, dest);
  }

  // 3. Copy extension-specific files into dist (overwrites shared if same name)
  console.log(`  Copying ${name}/ ...`);
  for (const entry of fs.readdirSync(config.src)) {
    // Skip service-worker.js — we'll concatenate it
    if (entry === 'service-worker.js') continue;
    const src = path.join(config.src, entry);
    const dest = path.join(config.dist, entry);
    copyRecursive(src, dest);
  }

  // 3b. Bundle TypeScript content scripts via esbuild. Each entry is
  //     bundled to a single IIFE-wrapped JS file so Chrome can load it
  //     directly from manifest.json (no module resolution at runtime).
  console.log('  Bundling TS content scripts (esbuild) ...');
  for (const [outName, entryPath] of Object.entries(TS_ENTRYPOINTS)) {
    if (!fs.existsSync(entryPath)) {
      console.warn(`    WARNING: TS entry not found: ${entryPath} — skipping`);
      continue;
    }
    esbuild.buildSync({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      target: ['chrome116'],
      platform: 'browser',
      outfile: path.join(config.dist, outName),
      sourcemap: false,
      logLevel: 'warning',
      // Chrome content scripts ship as a single file — no loader, no
      // runtime module resolution. Everything must inline.
      legalComments: 'none',
    });
  }

  // 4. Concatenate service worker files
  console.log('  Building service-worker.js ...');
  const swParts = config.serviceWorkerFiles.map((file) => {
    // First look in extension-specific dir, then shared
    const extPath = path.join(config.src, file);
    const sharedPath = path.join(SHARED_DIR, file);
    const filePath = fs.existsSync(extPath) ? extPath : sharedPath;
    if (!fs.existsSync(filePath)) {
      console.warn(`    WARNING: ${file} not found in ${name}/ or shared/`);
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  });
  fs.writeFileSync(
    path.join(config.dist, 'service-worker.js'),
    swParts.join('\n\n// ---- Extension-specific handlers below ----\n\n'),
    'utf-8'
  );

  // 5. Verify manifest exists
  const manifestPath = path.join(config.dist, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`  ERROR: manifest.json not found in dist/${name}/`);
    process.exit(1);
  }

  // 6. List output
  const files = listFiles(config.dist, config.dist);
  console.log(`  Output: ${files.length} files in dist/${name}/`);
  for (const f of files) {
    const size = fs.statSync(path.join(config.dist, f)).size;
    const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
    console.log(`    ${f} (${sizeStr})`);
  }
}

function listFiles(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const relPath = path.relative(base, fullPath);
    if (fs.statSync(fullPath).isDirectory()) {
      results.push(...listFiles(fullPath, base));
    } else {
      results.push(relPath);
    }
  }
  return results.sort();
}

// ---- Main ---------------------------------------------------------------

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--')); // 'jobseeker', 'recruiter', or undefined (both)
const isWatch = flags.has('--watch');

if (target && !EXTENSIONS[target]) {
  console.error(`Unknown target: ${target}`);
  console.error('Usage: node scripts/build.js [jobseeker|recruiter] [--watch]');
  process.exit(1);
}

const targets = target ? [target] : Object.keys(EXTENSIONS);

for (const t of targets) {
  buildExtension(t);
}

console.log('\nBuild complete.');

if (isWatch) {
  // Dev loop: rebuild whenever the shared/ dir or the selected extension's
  // own src dir changes. web-ext's --source-dir watcher picks up the
  // resulting dist/ changes and reloads the extension in Chrome.
  //
  // We debounce by 150ms because fs.watch fires multiple events per save
  // on many editors (separate events for mtime + content), and our build
  // takes ~200ms — without debounce every save triggers a build storm.
  console.log('\nWatching for changes... (Ctrl-C to stop)');
  const watched = new Set([SHARED_DIR, ...targets.map((t) => EXTENSIONS[t].src)]);
  let pending = null;
  const rebuild = () => {
    pending = null;
    for (const t of targets) {
      try {
        buildExtension(t);
      } catch (err) {
        console.error(`Build failed for ${t}:`, err.message);
      }
    }
    console.log('Rebuild complete. Watching...');
  };
  for (const dir of watched) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      // Ignore editor temp files (vim swap, JetBrains ___jb_tmp___, etc.)
      if (/(^|\/|\\)\.|___jb_|~$|\.swp$/.test(filename)) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(rebuild, 150);
    });
  }
}
