# hiredvideo-chrome-extension

> **License notice:** This code is source-available, **not** open source. No commercial use except by Sean Hogg. Using it, or any variation of it, requires you to open-source your entire product, and training AI on it requires you to open-source the model (weights, code and datasets). Credit is required. Read [LICENSE](LICENSE) and the [License section](#license--read-before-you-use-this-code) before using any of it.

Chrome extension for the hired.video platform.

## Targets

| Target | Folder | What it is |
|---|---|---|
| `app` | `app/` | **The one hired.video extension.** Lenses (Job seeker / Recruiter / Sales & social) over one engine: detect a job, profile or post → Create → Strengthen → Target → Promote. Side panel is Preact + TypeScript in `app/src/panel`, strings in `app/_locales/{en,es,fr}`. |
| `jobseeker` | `jobseeker/` | Legacy job-seeker listing — kept until the store moves to `app`. |
| `recruiter` | `recruiter/` | Legacy recruiter listing — kept until the store moves to `app`. |

`shared/` holds what every target uses (auth bridge, detectors, service-worker base, the autofill matcher, job-URL matching).

### Unified app layout (`app/src`)

- `panel/api/` — one typed client per API area; `http.ts` is the only `fetch` (JWT, silent refresh, error envelope).
- `panel/domain/` — data: lenses, actions, routes/steps, page entities, résumé documents.
- `panel/state/` — small stores (session, page detection, lens, pair, jobs, résumés, nav) + use cases (`job-capture.ts`).
- `panel/features/<flow>/` — one folder per screen: view + hook.
- `panel/ui/`, `panel/shell/` — presentational controls and the panel frame.
- `content/` — in-page pill, post detection, message-box filler.

A new lens or action is a data entry in `domain/lenses.ts` / `domain/actions.ts`; a new screen is a `features/` folder plus one line in `shell/App.tsx`'s registry.

The recruiter lens follows `HIRING_PERSONAS_ENABLED` in `hired.video/shared/user-roles.ts` — it appears only when the hiring side is on.

```bash
npm install
npm run build:app      # → dist/app (load unpacked)
npm run typecheck
npm test
```

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

**hired.video (unified app):** This extension turns the page you are viewing — a job posting, a professional profile, or a social post — into career material on hired.video: track the job, tailor your résumé and cover letter to it, fill its application form, and make a short video to promote yourself or a candidate. Messages and replies are typed into the site's own box; the user always presses Send.

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

### clipboardWrite (not requested)

The unified app copies text with `navigator.clipboard` from the side panel in response to a click, which needs no extra permission.

### alarms

Used to schedule a recurring background timer that silently refreshes the user's authentication token every 45 minutes, keeping the session active without requiring manual re-login.

### host_permissions (all URLs)

The extension needs access to all URLs because users browse jobs and source candidates across many different websites (LinkedIn, Indeed, Glassdoor, company career pages, etc.). The content scripts must run on any site to extract job listings, candidate profiles, and company information from the page the user is currently viewing.

## License — read before you use this code

Copyright (C) 2024-2026 Sean Hogg. All rights reserved except as granted in **[LICENSE](LICENSE)** (hired.video Noncommercial Share-Alike License 1.0).

**This is source-available, not open source.** Being able to see this code does not give you permission to use it. Read [LICENSE](LICENSE) in full before you copy, run, modify, deploy or train on any part of it. Doing any of those means you accept its terms. This summary is for convenience only; if it differs from [LICENSE](LICENSE), [LICENSE](LICENSE) controls.

### 1. No commercial use — except by Sean Hogg

Only Sean Hogg may use this software for a commercial purpose. Commercial purposes include:

- any use by, for or on behalf of a company or for-profit organization, including internal business use;
- any use in a product, service, site, app or platform that charges money, sells subscriptions, shows ads, takes fees or commissions, or earns revenue in any way;
- offering it, or any of its features, to others as a hosted, managed, embedded or white-label service;
- competing with any hired.video product or service.

Any other commercial use requires a **separate written license signed by Sean Hogg**.

### 2. Use it, and you must open-source everything

If you distribute this software or **any variation of it**, or let anyone use it over a network (a website, an API, an app backend, an embedded widget), you must publish the **complete source code of your entire product or service** that includes, imports, links to, calls, wraps or runs alongside it. That means all of it, not just the files you changed: back end, front end, database schemas, build and deployment code, and hosting configuration. It must be:

- public and free of charge, available no later than the day you ship or go live, and for at least three years afterward;
- licensed under these same terms, with no extra restrictions;
- clearly signposted to everyone who receives or uses your product.

Ports, translations and rewrites substantially based on this code count as variations.

### 3. AI training: train on it, and you must open-source the model

Using any part of this code to **pre-train, train, fine-tune, distill, evaluate or benchmark an AI model, or as retrieval/RAG/context material for one**, is a use under the license. If you do:

- the resulting model is a Covered Work. You must publish its **complete weights, architecture, configuration, tokenizer, training and inference code, and every dataset that contained this code**, under these same terms;
- the same applies to every model distilled, merged or fine-tuned from it, and to every agent, product or service that runs it;
- AI-generated code or text that reproduces, adapts or is substantially based on this code is also a Covered Work;
- training a model that is offered to anyone else, or used to earn revenue, is a commercial purpose and is **prohibited** without a written license from Sean Hogg.

### 4. Credit is required

- Keep every `Required Notice:` line and every copyright and license notice, unchanged, in every copy and every variation.
- Any product with a user interface must show **"Based on hired.video by Sean Hogg"** with a working link to https://hired.video, somewhere users can reach from every screen (a footer, an About page or a legal-notices page).
- Don't suggest that Sean Hogg or hired.video endorses you. No trademark rights are granted.

### 5. Breaking the terms ends your license immediately

Any violation ends all your rights under the license automatically and without notice. Your source-sharing obligations for anything you already shipped continue. Only Sean Hogg can reinstate a license, in writing.

**Commercial licensing:** contact Sean Hogg via https://hired.video.
