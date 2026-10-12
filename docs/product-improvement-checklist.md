# Product Improvement Verification Checklist

## Implemented and locally verified

- [x] Sign in, My Account profile visibility, and persisted light/dark theme preference.
- [x] Validated mobile phone format and persistence in My Account preferences.
- [x] Permanent account deletion (`POST /users/me/delete`) with literal confirmation and organizer/attendee obligation safety blocks.
- [x] My Tickets booking and ticket visibility with QR code admission and verified payment status; attendee refund request is recorded as an approval request, not a provider refund.
- [x] Organizer event edit, publish, and cancellation flows (including SOLDOUT status support).
- [x] Organizer refund request approval/rejection UI with local tab filtering, missing-status tolerance, and reconciliation messaging; browser tests make no provider calls.
- [x] Account deactivation confirmation can be cancelled; active organizer work conflict is surfaced without signing the user out.
- [x] Public venue address/map visibility and event venue location; directions links use coordinates when available and an encoded address fallback otherwise.
- [x] Organizer event creation 4-step wizard with category loading retry, inline venue creation with coordinates, and validated media submission (`POST /events/upload-image`).
- [x] Clear role separation with dedicated Attendee and Organizer navigation bars, and instant role switching ("Organizer Hub" / "Attendee Mode").
- [x] Header authentication state displays user greeting (`Hi, {name}`) and verified OAuth callback session.

The UI E2E cases use Playwright route mocks and isolated local test fixtures. All tests make zero unauthorized provider calls.

## Remaining verification

- [ ] Verify the exact Render staging deployment commit and the staging database target using authorized Render access.
- [ ] Inspect staging migration status; do not apply migrations until the database target is confirmed and separately authorized.
- [ ] Verify the deployed refund approval workflow end-to-end with controlled test-mode payment fixtures; no real payment or refund.
- [ ] Verify staging category dropdown and venue/event behavior after the intended deployment.
- [ ] Verify Vercel frontend deployment and its configured API URL.

No migrations, database writes, deployments, production access, or live payment/refund actions were performed for these local browser tests.
