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

## Chrome Web Store permission justifications

These are the justifications submitted to the Chrome Web Store for each
permission declared in `manifest.json`. Update them here whenever the
permission usage changes so we have a single source of truth for the next
review cycle.

### Single purpose

**Job Seeker:** This extension helps job seekers find jobs, track applications, and generate AI-tailored resumes using the hired.video platform.

**Recruiter:** This extension helps recruiters source candidates, extract professional profiles, and match them against open job requisitions using the hired.video platform.

### storage

Used to persist the user's authentication token (JWT) locally so they remain signed in across browser sessions without re-entering credentials. Also stores user-specific settings and preferences (e.g. recruiter pipeline configuration).

### activeTab

Used to access the content of the currently active tab when the user clicks the extension icon, allowing the extension to extract job listing details, candidate profiles, and company information from the page the user is viewing.

### sidePanel

The extension's entire UI is rendered in Chrome's side panel. It displays the dashboard, job/candidate tools, extraction results, and matching interface alongside the web page being viewed.

### scripting

Used to inject content scripts into tabs where the content script was not pre-loaded (e.g. tabs opened before the extension was installed). This allows the extension to extract job listing HTML and candidate profile data from the active page on demand.

### tabs

Used to (1) query the active tab to send messages to content scripts for extracting job, profile, and company data from the current page, (2) open hired.video pages (dashboard, pricing, resumes, login) in new tabs when the user clicks links in the side panel, and (3) reload hired.video tabs after authentication changes to keep login state in sync.

### alarms

Used to schedule a recurring background timer that silently refreshes the user's authentication token every 45 minutes, keeping the session active without requiring manual re-login.

### host_permissions (all URLs)

The extension needs access to all URLs because users browse jobs and source candidates across many different websites (LinkedIn, Indeed, Glassdoor, company career pages, etc.). The content scripts must run on any site to extract job listings, candidate profiles, and company information from the page the user is currently viewing.