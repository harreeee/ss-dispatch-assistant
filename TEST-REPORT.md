# v1.2 local verification - 2026-09-10

## Executed

- Node.js v22.16.0: 61 automated tests passed, 0 failed (`npm test`).
- JavaScript/module syntax checks passed for lib/, api/, app.js, sw.js and ops/.
- `node ops/build.mjs` succeeded; static output is an explicit frontend-only allowlist.
- 11 browser UI checks passed in installed Chromium via Python Playwright, using offline local HTML/CSS/JS and synthetic API responses.
- Checked 390px phone, 320px narrow phone, 1440px desktop; no horizontal page overflow in the checked screens.
- Verified date switching sends selected date, tomorrow tasks remain scheduled, drivers screen excludes task IDs, Not started filter, driver search, and API error clears healthy counts.
- Verified unconfigured push button is disabled. No JavaScript page errors in those UI checks.
- Reviewed phone overview and driver screenshots manually.

## Scope and limitations

- The agent-browser executable was unavailable. A local dev server started, but managed Chromium blocked localhost navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). Browser policy was not altered. UI verification instead rendered the local artifact offline, with fetch stubbed. This is NOT an end-to-end live deployment test.
- No real Onfleet API key was available to this build environment. Tests use fixtures/mocked transport, including pagination and error cases.
- Google Sheet OAuth/data integration and Supabase SQL/RLS were NOT executed against live services. Source credentials, schema and field mapping still need setup and readback verification.
- Phone push was NOT delivered to an iPhone/Android during these tests. Only deterministic alert/receipt planning, validation and configuration UI were tested. Service-worker install, VAPID and background delivery require a real HTTPS deployment/device test.
- The web-push package version is pinned to 3.6.7. Network restrictions prevented npm installation and a dependency lockfile was NOT fabricated. Vercel must successfully install it and the operator should commit the resolved package-lock.json after validation.
- No code was deployed to the user's Vercel project or committed to GitHub in this session. No paid plan, database or background job was created/activated.

## Required acceptance before operational use

Compare an actual current-day pickup at cutoff, a future-day assigned pickup, an active on-time driver, a legitimately stationary driver and an offline/GPS-stale driver against Onfleet. Confirm the expected task IDs and Sheet date/time mapping. Keep normal dispatch monitoring running in parallel.

For phone delivery, configure private state and VAPID, enable the minute monitor, subscribe the Home Screen app, lock the phone and receive the test. Then verify a controlled overdue-Start alert and that it stops after the correct task is started. Check monitor heartbeat and service logs. Do not manipulate live customer orders merely to test.
