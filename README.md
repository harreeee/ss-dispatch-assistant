# S&S Dispatch Assistant v1.1

Live Onfleet driver monitoring for S&S dispatch.

## Required Vercel environment variable

- `ONFLEET_API_KEY`

## Driver status logic

- ONLINE/OFFLINE comes from Onfleet worker `onDuty`.
- LATE if Onfleet worker/task `delayTime` is positive, or a task is already past `completeBefore`.
- AT RISK if Onfleet predicts completion/arrival after the deadline, or within 10 minutes of it.
- ON TIME otherwise.
- A driver's displayed status is the worst status among currently assigned/active tasks.

## Next step

Connect the 2026 UPCOMING DELIVERIES Google Sheet for date-based Missing / Late / At Risk / On Time order checks.
