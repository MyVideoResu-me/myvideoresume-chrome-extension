# hiredvideo-chrome-extension

Chrome extension for the hired.video platform.

## Build locally

### Linux/macOS

```bash
./scripts/build.sh --clean
```

### Windows PowerShell

```powershell
.\scripts\build.ps1 -Clean
```

Both commands create a package named:

- hiredvideo-chrome-extension-<manifest-version>.zip

## Automated publish and deploy

Release automation is handled by:

- .github/workflows/chrome-extension-release.yml

Behavior:

- Pull requests touching this extension run package validation/build.
- Pushes to main touching this extension produce a versioned artifact.
- Tag pushes matching chrome-ext-v*.*.* create a GitHub release asset and publish to Chrome Web Store.
- Manual runs can upload only, or upload + submit for review.

## Required GitHub Actions secrets

Set these repository secrets:

- CHROME_EXTENSION_ID
- CHROME_CLIENT_ID
- CHROME_CLIENT_SECRET
- CHROME_REFRESH_TOKEN

## Manual workflow dispatch options

From Actions -> Chrome Extension Release:

- publish = true uploads package to Chrome Web Store.
- submit_for_review = true also calls publish in Chrome Web Store after upload.