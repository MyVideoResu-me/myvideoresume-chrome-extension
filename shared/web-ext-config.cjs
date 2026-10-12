const path = require('path');

module.exports = {
  sourceDir: __dirname,
  artifactsDir: path.join(__dirname, 'web-ext-artifacts'),
  ignoreFiles: [
    'scripts/**',
    'web-ext-config.cjs',
    'web-ext-artifacts/**',
    '.web-ext-profile/**',
    '.git/**',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'node_modules/**',
    'README.md',
    '*.zip',
  ],
  run: {
    target: ['chromium'],
    chromiumBinary: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromiumProfile: path.join(__dirname, '.web-ext-profile'),
    keepProfileChanges: true,
    profileCreateIfMissing: true,
    startUrl: ['https://www.linkedin.com/jobs/'],
  },
};
