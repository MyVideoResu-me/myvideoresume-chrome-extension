/**
 * Compile one TypeScript module (and its imports) to CommonJS with esbuild
 * and require it — lets `node --test` exercise the app's pure modules
 * without a TS runtime. Path aliases (@shared/*) come from app/tsconfig.json.
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ext-tests-"));

function loadTs(relPath) {
  const entry = path.join(ROOT, relPath);
  const outfile = path.join(OUT_DIR, relPath.replace(/[\\/]/g, "__").replace(/\.tsx?$/, ".cjs"));
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: ["node20"],
    outfile,
    logLevel: "error",
    jsx: "automatic",
    jsxImportSource: "preact",
    tsconfig: path.join(ROOT, "app", "tsconfig.json"),
  });
  return require(outfile);
}

module.exports = { loadTs, ROOT };
