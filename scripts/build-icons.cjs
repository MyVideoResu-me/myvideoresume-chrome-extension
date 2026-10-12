/**
 * Rasterize the hired.video brand mark into every PNG slot the project needs:
 *   - Chrome extension toolbar/store icons (icon{16,32,48,128}.png)
 *   - Chrome extension side-panel footer mark (imgs/brand-mark.png)
 *   - Frontend PWA icons (pwa-{64,192,512}, apple-touch-icon-180, maskable-512)
 *
 * Source of truth: hired.video/frontend/public/favicon.svg.
 * Re-run after editing that SVG: `npm run build:icons` from this folder.
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_PUBLIC = path.join(REPO_ROOT, 'hired.video', 'frontend', 'public');
const SOURCE_SVG = path.join(FRONTEND_PUBLIC, 'favicon.svg');

const EXT_ROOT = path.resolve(__dirname, '..');
const EXT_ICONS_DIR = path.join(EXT_ROOT, 'icons');
const EXT_IMGS_DIR = path.join(EXT_ROOT, 'imgs');

const EXT_ICON_SIZES = [16, 32, 48, 128];

// PWA icons live in the frontend repo; (filename, size, options)
const PWA_TARGETS = [
  { file: 'pwa-64x64.png', size: 64 },
  { file: 'pwa-192x192.png', size: 192 },
  { file: 'pwa-512x512.png', size: 512 },
  { file: 'apple-touch-icon-180x180.png', size: 180, background: '#ffffff' },
  // Maskable icons need a fully filled safe zone (inner ~80%) so the icon
  // survives platform-specific shape masks. We pad the mark inside a white
  // rounded square instead of letting the OS clip the strokes.
  { file: 'maskable-icon-512x512.png', size: 512, maskable: true },
];

async function rasterize(svgBuffer, size, opts = {}) {
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  if (opts.maskable) {
    // Render the mark inside the inner 80% of the canvas, on a solid white tile.
    const inner = Math.round(size * 0.8);
    const offset = Math.round((size - inner) / 2);
    const mark = await sharp(svgBuffer, { density: 1024 })
      .resize(inner, inner, { fit: 'contain', background: transparent })
      .png()
      .toBuffer();
    return sharp({
      create: { width: size, height: size, channels: 4, background: '#ffffff' },
    })
      .composite([{ input: mark, top: offset, left: offset }])
      .png()
      .toBuffer();
  }
  const background = opts.background
    ? opts.background
    : transparent;
  return sharp(svgBuffer, { density: 1024 })
    .resize(size, size, { fit: 'contain', background })
    .flatten(opts.background ? { background: opts.background } : false)
    .png()
    .toBuffer();
}

async function writePng(target, buffer) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  console.log(`wrote ${target}`);
}

async function main() {
  if (!fs.existsSync(SOURCE_SVG)) {
    throw new Error(`Source SVG not found: ${SOURCE_SVG}`);
  }
  const svg = fs.readFileSync(SOURCE_SVG);

  // Chrome extension toolbar/store icons
  for (const size of EXT_ICON_SIZES) {
    const buf = await rasterize(svg, size);
    await writePng(path.join(EXT_ICONS_DIR, `icon${size}.png`), buf);
  }

  // Side-panel footer mark
  const footer = await rasterize(svg, 64);
  await writePng(path.join(EXT_IMGS_DIR, 'brand-mark.png'), footer);

  // Frontend PWA assets
  for (const target of PWA_TARGETS) {
    const buf = await rasterize(svg, target.size, target);
    await writePng(path.join(FRONTEND_PUBLIC, target.file), buf);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
