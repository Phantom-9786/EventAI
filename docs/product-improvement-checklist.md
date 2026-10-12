# Product Improvement Verification Checklist

## Implemented and locally verified

- [x] Sign in, My Account profile visibility, and persisted light/dark theme preference.
- [x] My Tickets booking and ticket visibility; attendee refund request is recorded as an approval request, not a provider refund.
- [x] Organizer event edit, publish, and cancellation flows.
- [x] Organizer refund request approval/rejection UI with intercepted API responses; browser tests make no provider calls.
- [x] Account deactivation confirmation can be cancelled; active organizer work conflict is surfaced without signing the user out.
- [x] Public venue address/map visibility and event venue location; directions links use coordinates when available and an encoded address fallback otherwise.
- [x] Organizer event creation category loading retry and media submission.

The UI E2E cases use Playwright route mocks. Venue and event detail E2E use a local fixture API, so neither suite depends on nor writes to staging. Refund E2E verifies UI/API request behavior only; the backend provider flow remains covered by API unit tests and has not been exercised against Razorpay in this continuation.

## Remaining verification

- [ ] Verify the exact Render staging deployment commit and the staging database target using authorized Render access.
- [ ] Inspect staging migration status; do not apply migrations until the database target is confirmed and separately authorized.
- [ ] Verify the deployed refund approval workflow end-to-end with controlled test-mode payment fixtures; no real payment or refund.
- [ ] Verify staging category dropdown and venue/event behavior after the intended deployment.
- [ ] Verify Vercel frontend deployment and its configured API URL.

No migrations, database writes, deployments, production access, or live payment/refund actions were performed for these local browser tests.
