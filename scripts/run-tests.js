#!/usr/bin/env node
/**
 * Run every tests/*.test.js with node's test runner. Node 20 (CI) has no
 * glob support in `node --test`, and Windows treats a bare directory
 * argument as a module path — so list the files explicitly.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS = path.resolve(__dirname, '..', 'tests');
const files = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.js')).map((f) => path.join(TESTS, f));
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
