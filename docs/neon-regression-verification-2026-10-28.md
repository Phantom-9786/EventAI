# Neon optimization: regression verification

Verified on 28 October 2026. This records observed results, not a guarantee that every possible interaction is bug-free.

## Actual deployed booking checks

Two user-completed Razorpay **test-mode** payments (INR 499 and INR 649) were independently checked against Razorpay and the production Neon database. Both payments were captured; both bookings were confirmed with one valid ticket each. Both remained confirmed with valid tickets after their original reservation deadlines.

A third reservation was deliberately left unpaid:

| Evidence | Observed result (UTC) |
| --- | --- |
| Reservation created | 06:13:59 |
| Stored expiry deadline | 06:23:59 |
| Render scheduler log | 06:24:18: booking expired and stock released |
| Database after expiry | EXPIRED; zero tickets issued |
| Ticket-type availability | 28 while held, then 29 after automatic release |

The release happened automatically about 19 seconds after the deadline. No booking-read endpoint or cancellation was invoked to trigger lazy expiry during this check. Database inspection used read-only SQL. Payment and booking identifiers are omitted from this public report.

Production consistency queries found zero overdue unpaid holds beyond a two-minute grace period, zero invalid inventory counts, zero confirmed bookings with an incorrect issued-ticket count, and zero valid/used tickets attached to expired, cancelled or refunded bookings at the time of inspection.

## Automated and browser checks

| Check | Result | Boundary |
| --- | --- | --- |
| API unit tests | 44 suites, 836 tests passed | Includes mocked dependencies |
| PostgreSQL integration tests | 4 suites, 33 tests passed | Real isolated local PostgreSQL; external providers mocked |
| Browser regression tests | 26 passed | Fixture-backed API, not real external providers |
| Live public website smoke checks | 20 checks across desktop and mobile | Anonymous public pages and protected-route sign-in gates |
| Live public API | Health, discovery, categories, venues and details returned HTTP 200 | Point-in-time checks |
| Live page errors/overflow | No JavaScript page errors or horizontal overflow in checked pages | Does not cover every content combination |

The integration suite exercised authentication, booking concurrency/idempotency, expiry and payment lifecycle guards, organizer/admin workflows, and event search. Fourteen migrations were applied to a disposable local test database. No production reset or test migration was performed.

Browser fixtures were updated to match the current interface, approval requirements, upload configuration contract, account menu and separate bookings/tickets destinations. These changes correct stale test expectations rather than weakening application rules.

## Other issue found during verification

A live AI search returned four matching event cards but generated wording claiming there was one event. A narrow safeguard now rejects explicit English result-count claims that contradict both the returned-card count and total count, retaining the existing factual introduction and verified cards. Four regression cases cover incorrect counts, a correct count and a legitimate single-event recommendation. This does not claim to eliminate all possible model inaccuracies.

## What the compute optimization preserves

- Liveness routes (`/health`, `/health/live`, `/api/health/live`) do not query Neon. `/api/health` remains dependency readiness and does query the database.
- The scheduler can tick in memory without querying the database every minute while idle.
- New reservations retain a stored expiry deadline and inform the next known expiry check.
- Startup recovery and a 30-minute recovery scan remain available for missed work. They supplement normal expiry scheduling.
- Payment verification, ticket issuance and stock release remain database-backed. The live checks above demonstrate paid confirmation and automatic unpaid expiry on the deployed single-server setup.

## Limits of this verification

Actual provider webhook delivery was not observed in these fresh checkout checks. Signed client-side payment verification and actual Razorpay capture were verified; webhook handlers were exercised in integration tests with provider responses mocked. Real refund transfers, email delivery, Google consent and physical camera operation were not freshly tested.

Authenticated admin/organizer browser flows were checked with fixtures and real-database integration tests, not a signed-in production browser session. Active testing itself wakes Neon, so this audit does not establish a clean idle consumption baseline.

Removing unnecessary database polling reduces avoidable compute use. Staying below 100 CU-hours for an entire future month depends on real traffic, compute size and active time; it cannot be guaranteed from these tests. Compare Neon billing after a normal idle period. The previous monthly allowance already consumed is not restored by the change.

Conclusion: no booking, payment or reservation-expiry regression was found in the verified flows. The live unpaid-reservation test confirms that saving idle compute did not remove automatic stock release.
