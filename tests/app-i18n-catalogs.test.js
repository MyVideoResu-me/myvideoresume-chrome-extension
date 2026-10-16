/**
 * The unified app's _locales catalogs: es + fr carry exactly en's keys,
 * every message is non-empty, `{placeholders}` match en per key, no `$`
 * (Chrome treats it as a substitution marker), and every key the source
 * references exists.
 *
 * Run: node --test tests/app-i18n-catalogs.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.resolve(__dirname, "..", "app");
const LANGS = ["en", "es", "fr"];
const read = (lang) => JSON.parse(fs.readFileSync(path.join(APP, "_locales", lang, "messages.json"), "utf8"));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("app locale catalogs", () => {
  const en = read("en");

  for (const lang of LANGS) {
    it(`${lang}: valid Chrome keys, non-empty, no $`, () => {
      const cat = read(lang);
      for (const [key, value] of Object.entries(cat)) {
        assert.match(key, /^[A-Za-z0-9_@]+$/, `${lang}.${key} key`);
        assert.ok(value.message && value.message.trim(), `${lang}.${key} empty`);
        assert.ok(!value.message.includes("$"), `${lang}.${key} contains $`);
      }
    });
  }

  for (const lang of ["es", "fr"]) {
    it(`${lang}: same keys and placeholders as en`, () => {
      const cat = read(lang);
      assert.deepEqual(Object.keys(cat).sort(), Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        assert.deepEqual(placeholders(cat[key].message), placeholders(en[key].message), `${lang}.${key} placeholders`);
      }
    });
  }

  it("manifest messages exist", () => {
    const manifest = fs.readFileSync(path.join(APP, "manifest.json"), "utf8");
    for (const m of manifest.matchAll(/__MSG_(\w+)__/g)) assert.ok(en[m[1]], `manifest key ${m[1]}`);
  });

  it("every literal key the source passes to t() exists in en", () => {
    const missing = new Set();
    for (const file of sourceFiles(path.join(APP, "src"))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) if (!en[m[1]]) missing.add(m[1]);
    }
    assert.deepEqual([...missing], []);
  });
});
