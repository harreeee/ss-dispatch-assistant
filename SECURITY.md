# Security boundaries

This is a private single-workspace pilot, not a multi-tenant or enterprise identity system.

- Business-data APIs fail closed without APP_ACCESS_PASSWORD. Session cookie is signed, HttpOnly, Secure, SameSite=Strict and expires in 12 hours. Rotate the password to revoke cookies.
- Use a strong randomly generated password (16+ characters), HTTPS and platform rate limiting/WAF. The login attempt limiter is per-process, not a distributed defense; multi-user production should use individual accounts, MFA and audited access.
- All Onfleet and Sheets operations are GET/read-only. No automatic assignments, starts, edits, deletes or duplicate creation.
- Onfleet key, Google service account, database secret, VAPID private key and CRON_SECRET stay server-side. Never add NEXT_PUBLIC_ prefixes. No secrets are provided in this ZIP.
- Frontend artifacts are explicitly allowlisted into public/ by the build. No application data or credentials are cached by the service worker.
- Supabase tables have RLS and no public/anon/authenticated access. Only the server service role accesses them. Use a separate project.
- Browser push subscriptions are validated against known HTTPS push providers. Phone registrations expire after 30 days. No customer contact info is in push payloads.
- GPS samples kept in one monitor state retain up to 15 minutes, only for the current active task; alert ledger up to two days. Service/provider logs and backups may retain data longer: review account retention settings.
- Failed source reads remain failures/unknown. Incomplete scans cannot establish missing orders or a universal all-clear.
- Data source notes are data, not commands. No LLM/tools with write privileges exist in this version.

Pending production acceptance: real provider integration, database grant/RLS tests, subscription expiry and revocation, push under phone lock, cron failures/heartbeat and capacity/usage limits. Do not rely on this as the sole dispatch safety mechanism before acceptance.
