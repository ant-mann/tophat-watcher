# Top Hat Companion

Top Hat Companion is a local Node.js + Playwright app that watches your Top Hat courses for live unanswered questions, alerts you quickly, and opens the right question when you need it.

The project is designed to be simple for everyday use:

- sign in once
- choose your courses from a local dashboard
- start watching in the background
- get sound, notification, and browser focus when a question appears

It does not answer questions for you and it never submits anything automatically.

## What It Does

Top Hat Companion has two parts:

1. A local dashboard
2. A Playwright-based watcher

The dashboard opens in your browser and gives you plain-language controls:

- `Connect Top Hat`
- `Refresh Courses`
- `Start Watching`
- `Stop Watching`
- `Acknowledge Alert`
- `Test Alert`

The watcher signs into Top Hat using a persistent browser profile, checks selected courses in the background, and raises an aggressive alert when a new unanswered question appears.

## Current Behavior

The current watcher is optimized for lower steady RAM use:

- one hidden background browser session
- one reusable polling page
- sequential checks across enabled courses
- visible browser opened only when needed for a real alert

That means it is lighter than keeping one warm hidden page per course, while still staying browser-driven and reliable.

## Safety Rules

This app is intentionally limited.

It will:

- detect new unanswered Top Hat questions
- raise a repeating alert sound
- show a desktop notification
- open or focus the relevant Top Hat page
- focus the answer field when possible

It will not:

- type an answer
- click `Submit`
- click `Resubmit`
- mark work complete for you

## Requirements

- Node.js 18+
- A Top Hat account

Platform support:

- Windows: supported
- WSL: supported, with handoff into native Windows execution
- macOS: supported through Playwright + Chrome
- Linux: best effort

## Installation

Clone the repo and install dependencies:

```bash
npm install
```

That is the only step. The `postinstall` script automatically downloads the Chrome browser that Playwright needs, so you do not have to install or configure it separately.

## Running The App

Start the companion:

```bash
npm start
```

That launches the local app entrypoint:

- starts the dashboard server
- opens the dashboard in your browser
- keeps the companion alive until you stop it

## First-Time Setup

1. Run `npm start`
2. Click `Connect Top Hat`
3. Sign into Top Hat in the browser window that opens
4. Return to the dashboard
5. Click `Refresh Courses`
6. Leave enabled the courses you want monitored
7. Click `Start Watching`

Course selection saves automatically when you toggle a course on or off.

## Daily Use

Typical workflow:

1. Start the companion with `npm start`
2. Open the dashboard if it is not already open
3. Click `Start Watching`
4. Leave it running in the background
5. When an alert fires, answer the Top Hat question manually
6. Click `Acknowledge Alert` to stop the repeating alert for the current item

## What Happens On An Alert

When the watcher detects a new unanswered question:

1. The hidden watcher records the alert immediately
2. A repeating sound and desktop notification fire
3. The app opens or focuses Top Hat
4. It navigates to the correct course
5. It tries to focus the answer input box

After you acknowledge the alert, the app returns to the lighter background watcher mode.

## Commands

The available scripts are:

```bash
npm start
npm test
npm run tophat:app
npm run tophat:login
npm run tophat:watch
npm run tophat:ack
```

What they do:

- `npm start`: normal dashboard app entrypoint
- `npm run tophat:app`: same as `npm start`
- `npm run tophat:login`: legacy CLI login flow
- `npm run tophat:watch`: legacy CLI watcher flow
- `npm run tophat:ack`: acknowledge the active alert in the legacy CLI flow
- `npm test`: run the Node test suite

## Configuration

The modern app flow stores settings internally and manages them through the dashboard.

Stored settings include:

- selected courses
- watcher state
- authentication/profile readiness
- active alerts

Legacy config import still exists through:

- [config/tophat.json](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/config/tophat.json)

That file is treated as a first-run import source, not the primary day-to-day control surface.

## Runtime Storage

Common runtime locations:

- browser profile
- app settings
- alert state

Path behavior differs by platform:

- Native Windows: repo-local `.data/` and `.profiles/`
- WSL: state under Linux home, browser profile under Windows user data
- macOS/Linux: local app-managed paths based on the runtime path resolver

Key path logic lives in:

- [src/runtime-paths.mjs](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/src/runtime-paths.mjs)

## Architecture Overview

Main parts of the project:

- [scripts/tophat-companion.mjs](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/scripts/tophat-companion.mjs)
  - app entrypoint
  - dashboard startup
  - shutdown handling
  - WSL-to-Windows handoff trigger
- [src/dashboard-server.mjs](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/src/dashboard-server.mjs)
  - local HTTP server
  - API endpoints for UI actions
  - static file serving
- [src/companion-controller.mjs](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/src/companion-controller.mjs)
  - dashboard-to-watcher orchestration
  - settings and runtime state
- [src/tophat-watcher-core.mjs](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/src/tophat-watcher-core.mjs)
  - login flow
  - course discovery
  - background polling
  - alert detection
  - question handoff
- [public/index.html](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/public/index.html)
  - dashboard UI shell
- [public/app.js](/mnt/c/Users/chimn/OneDrive/Desktop/tophat/public/app.js)
  - dashboard interactions and status polling

## API Endpoints

The local dashboard server exposes:

- `GET /api/status`
- `POST /api/login/start`
- `POST /api/courses/discover`
- `POST /api/courses/save`
- `POST /api/watcher/start`
- `POST /api/watcher/stop`
- `POST /api/alerts/acknowledge`
- `POST /api/alerts/test`

These are local app endpoints, not public hosted APIs.

## Testing

Run the full test suite:

```bash
npm test
```

The tests cover:

- settings persistence
- dashboard API behavior
- discovery normalization
- watcher lifecycle
- platform runtime behavior
- login flow
- alert queue/state behavior
- lower-RAM single-page watcher behavior

The test suite lives under:

- `test/`

## Troubleshooting

### Top Hat browser opens but login is stuck

If you are in WSL, the app should hand off to native Windows execution. Start the app with:

```bash
npm start
```

and use the Windows-opened browser flow rather than a Linux-rendered browser window.

### `Start Watching` fails with a persistent-context error

This usually means a profile/session conflict. The watcher now releases an existing login/discovery session before starting a watch session, but if you still hit trouble:

- stop the watcher
- close any leftover Top Hat windows opened by the app
- start again from the dashboard

### Courses do not appear after `Refresh Courses`

Make sure:

- you are signed into Top Hat
- the correct account is signed in
- the courses are visible from the Top Hat course lobby

### Alerts fire but do not focus the answer box

The app uses heuristic selectors to find the visible response field. If Top Hat changes its DOM, focus may miss until the selector logic is updated.

### Linux notifications or sound do not work

Linux support is best effort. The app falls back gracefully, but native notification/audio tools may need to be installed on your system.

## Development Notes

This project currently favors:

- reliable question detection
- low-friction onboarding
- lower steady RAM usage
- safe manual answering

It does not currently attempt:

- API scraping without a browser
- answer generation
- automatic submission

## License

No license file is currently included in this repository. Add one before publishing for wider reuse if you want explicit open-source terms.
