# EventPoint low-traffic compute fixes — 30 October 2026

## The missed cause

The 28 October changes removed empty minute-by-minute booking queries and made `/health` database-free, but did not eliminate frequent database wake-ups. Older logging used Express's router-relative `req.path`, so a request for `/api/health` appeared as `/health`.

After capturing the original request path, production logs showed `/api/health` requests at 14:01:18 and 14:05:29 UTC on 30 October. That endpoint still queried PostgreSQL. Requests this frequent can prevent Neon's five-minute idle suspension. This was the key gap in the previous fix, not evidence that the unused staging branch was consuming the allowance.

## Changes

- The existing monitored `/api/health` URL is now database-free liveness, before maintenance middleware, alongside `/health` and both `/health/live` aliases.
- Full database/Redis readiness remains available at `/api/health/ready`, including HTTP 503 when PostgreSQL is unavailable. Use readiness for deliberate diagnostics, not continuous uptime pings.
- System controls are cached for 30 minutes instead of 60 seconds. A bounded process snapshot also avoids repeated database reads when Redis is unavailable or evicts a value. Admin writes replace both caches immediately; active browsers retain their 15-second refresh cadence.
- Notification, admin badge and maintenance polling pauses after two minutes without interaction or while hidden, and resumes immediately on returning/interacting. Manual refresh and normal actions remain available.
- Links use a shared wrapper disabling speculative Next.js prefetch. A real untouched homepage had caused four event-detail pages to load without clicks. Normal click navigation, browser history, refs and accessibility remain intact.
- Request logs retain the full original path but omit query strings, allowing future monitor paths to be identified without logging query tokens.

Booking hold duration, payment verification, ticket issuance, transactional stock release, startup recovery and the 30-minute recovery scan are unchanged. No data, branch, payment provider or user-facing feature was removed. A sleeping database wakes automatically when a real request needs it.

## Evidence and limits

The first deployed polling fix was observed in a real anonymous production browser for seven minutes: after the last poll at about 109 seconds, no further browser API requests were made for the remaining five minutes; there were no browser JavaScript errors. Neon nevertheless remained active, leading to discovery of the separate `/api/health` monitor requests above. This distinguishes browser-idle evidence from database-idle evidence.

Local verification includes real PostgreSQL integration tests (33 passed; external providers mocked), 27 browser regression tests (fixture API, including idle/hidden/resume behavior), API unit tests covering booking/payment/expiry and health semantics, and web/API type and lint checks. An initial integration attempt failed because local Docker was stopped; after starting Docker, the complete integration run passed against a disposable local database. Production data was not reset.

## Budget calculation, not a guarantee

CU-hours are compute size multiplied by active clock-hours. At 0.25 CU, remaining active all month costs about 180 CU-hours over 30 days, even with almost no visitors. Frequent health checks can therefore exhaust the free allowance.

With five active minutes for each 30-minute recovery scan, the otherwise-idle scheduler budget is approximately:

`48 scans/day × 5/60 hours × 0.25 CU × 30 days = 30 CU-hours/month`

This estimate assumes minimum compute, successful scans and no other wake-ups. Real visits, checkouts, deployments, diagnostic queries, longer sessions, retries and autoscaling add usage. The fixes target well below 100 CU-hours for a lightly used site; they do not impose a destructive hard cap or guarantee a fixed bill for arbitrary traffic. At minimum compute, 100 CU-hours represents 400 active clock-hours. Measure the actual change in usage over ordinary days after the fix, rather than treating tests or cumulative consumption as a monthly forecast.

Previously consumed compute is not refunded. The period shown by the project API resets on 1 November 2026 at 00:00 UTC (05:30 IST).

References: [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero), [Next.js 14 Link prefetch](https://nextjs.org/docs/14/app/api-reference/components/link#prefetch).
