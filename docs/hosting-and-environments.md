# EventPoint hosting and environments

## Live resource mapping (28 October 2026)

The public site is https://eventpoint.dev, deployed on Vercel. Its existing API address is https://eventai-api-staging.onrender.com/api. That hostname is a legacy integration address, not an indication that public traffic is a test deployment. Do not replace the hostname in source without provisioning and verifying a replacement, updating Vercel environment values, and checking OAuth/payment callbacks.

Neon project `eventpoint` (project ID `purple-butterfly-69663394`) has:

| Branch | ID | Role |
| --- | --- | --- |
| production | br-tiny-shadow-b4zjcvb5 | Existing live-data branch, now the default; previously named staging. |
| staging | br-lively-meadow-b4avy45a | Archived old branch; previously named production. Keep idle until explicitly needed. |

Renaming did not copy/delete data, change endpoint hostnames or reset quotas. Both branches share the project's compute allowance. The old production branch recorded about seven minutes of active runtime and 0.036 CU-hours; that proves it ran briefly, not that it served the public application. The archived branch is not a continuously synchronized copy of live data. For meaningful new testing, create or refresh an isolated branch from current production through a deliberate workflow.

## Liveness versus readiness

- `/api/health/live` (also `/health/live` and the legacy monitor URL `/health`) returns the API process status. It performs no PostgreSQL, Redis, authentication, maintenance-settings or external-provider calls. It is registered before maintenance middleware and is not cached. `/health` previously included dependency checks; clients needing that information must use `/api/health`.
- `/api/health` is a readiness/dependency diagnostic. It queries PostgreSQL and Redis. Do not use it for frequent keep-alive traffic if the database should sleep.
- The API Docker HEALTHCHECK uses the liveness endpoint. Render logs on 28 October showed regular inbound `/health` requests roughly every five minutes. Keeping that legacy route as liveness means the existing monitor no longer triggers database or maintenance-settings queries. The monitor provider/account itself has not been identified.

A lightweight HTTP request can reach the API without waking PostgreSQL. It does not remove the hosting platform's free-tier restart/spin-down behavior or guarantee zero cold starts. Render's free service can spin down after 15 minutes without inbound traffic; keeping the API process active still consumes Render instance hours. Booking reconciliation can wake PostgreSQL independently.

## Booking expiry and database sleep

The expiry job releases stock held by abandoned, unpaid checkouts. It is not an uptime job. Do not disable expiry or treat it as a replacement for a liveness check.

The timer runs every minute but normally makes no query while waiting. It loads up to 200 outstanding holds ordered by expiry, expires due holds using the existing transactional compare-and-set, then remembers the next deadline. New reservations committed through this process bring the deadline forward. Startup reconciles immediately; batches of 200 and failed items retry on the next minute. A 30-minute recovery query discovers holds created outside the current process. User booking reads retain lazy expiry.

This is deliberately bounded recovery for the current single API instance. It is not a distributed queue: before horizontally scaling the API, use a shared durable expiry schedule or accept the documented external-process recovery delay. Reducing polling does not guarantee a particular Neon usage reduction; real traffic, other monitors and autoscaling also affect CU-hours.

Free Neon currently includes 100 CU-hours per project per month. At a constant 0.25 CU, a 30-day always-active database uses 180 CU-hours. Letting the database suspend between real work is therefore necessary to fit that always-on workload into a free allowance. Renaming branches does not reduce compute usage.

## Brand compatibility

User-facing text, email names, logs and documentation use EventPoint. Existing `@eventai/*` workspace identifiers, database names, cookie/storage keys, repository URL, Cloudinary asset paths and deployed service hostnames remain compatibility identifiers. Renaming those blindly would risk broken imports, lost sessions, inaccessible media or disconnected deployments; they are not the public product name.

References: https://neon.com/docs/introduction/plans, https://neon.com/docs/introduction/scale-to-zero, https://render.com/docs/free.
