# EventPoint local UI integration

## Scope and safety

Approved reference: .local/eventpoint-sites (localhost:3030). Integrated application: apps/web (localhost:3000), Express API localhost:4000, existing local PostgreSQL and Redis. No commits, pushes, deployments, production writes, or environment-file changes. This is an in-progress integration, not confirmation that every prototype concept has shipped.

Before edits, all 28 pre-existing modified/untracked files were copied into a timestamped temporary baseline. Twenty remain byte-identical; eight are intentionally extended for integration. No original files are missing. No reference-board images are staged.

## Integrated in this pass

- Account menu and role-aware attendee/organizer switch; Admin appears only for authenticated admins. Existing page and API authorization retained.
- Collapsible workspace navigation with persisted preference, accessible labels, keyboard focus, mobile horizontal navigation and reduced-motion support. No development-only coverage/state screens or role impersonation dropdown.
- Neutral charcoal dark surfaces and restrained transitions.
- Attendee dashboard backed by real bookings, upcoming plans and existing browser saved-event storage. Clearly states when aggregates cover only the loaded booking page.
- Organizer attendee roster: owned event selection, pagination, search of displayed page and CSV export of displayed rows; spreadsheet formula escaping included. Existing scanner remains the actual check-in mechanism.
- Organizer analytics: actual backend revenue, bookings, ticket and event status totals, with no invented historical charts.
- Organizer venue list and creation form using existing authenticated venue APIs.
- Clickable organizer metrics and admin tab navigation. AI suggestion links prefill the real input without automatically sending a request; AI requests have a 30-second timeout.
- Notification refresh, visible refresh errors and authenticated clear-read endpoint. Clear-read deletes only the requesting user's already-read records, preserving unread notifications.
- Actual calendar (.ics) download from ticket details. Removed the pre-existing fake Wallet success state. Wallet button is unavailable until issuer setup exists; user confirmed issuer setup is not available.

## Verification and limitations

Frontend type-check, lint and optimized build checked during this pass. API type-check passes. API lint exits successfully with 504 warnings and no errors. Full Jest run reports 40 suites / 768 tests passing, but keeps open handles after reporting results; process was interrupted after results, so this is not a clean test-process exit. Targeted notifications tests exit normally with 49 passing.

Final combined Playwright run against the optimized localhost build: 19/19 passing. Browser tests use mocked API responses to test authorization, loading timeouts, workspace navigation, notifications and responsive behavior. Separately, read-only real local API checks with existing safe .test accounts returned 200 for admin stats, organizer stats/events, bookings, notifications and current-user endpoints. Those read-only checks used locally signed test sessions and do not verify password login or account lifecycle writes.

Local API launcher under .local/eventpoint-sites/local-api.cjs refuses non-local database/cache hosts, disables email/payment/media/OAuth/AI credentials in that process, and starts no cleanup or refund scheduler. It does not edit any env file. Consequently live external integrations are not verified by that launcher. It is a temporary local development aid, not a deployment mechanism.

## Outstanding before declaring the whole redesign complete

- Compare every real app screen against the approved reference, including event discovery/detail/checkout, attendee booking detail/calendar/profile, and all admin tabs. Existing routes are retained; not every reference layout has been ported.
- Implement announcement drafts/delivery, coupons, event lineup/amenities, verified-attendee reviews and other concepts that lack data models, validation, ownership checks, moderation and tests. No sample-only prototype action should be described as integrated functionality.
- Saved events currently use the pre-existing browser storage implementation; server persistence/account synchronization and complete saved-event discovery beyond a search result page still need implementation.
- Finish end-to-end tests with local-only writes for event/application/moderation/venue creation, ticketing and notification delivery. Do not use real payments, refunds or emails; never reinitiate the existing pending refund.
- Test Cloudinary persistence, AI responses, safe email delivery suppression and Razorpay TEST credentials separately under controlled configuration. Google/Apple Wallet requires issuer configuration (confirmed unavailable).
- Investigate existing Jest open handles before calling CI entirely clean.
- Preserve current HTTPS deployment configuration. Do not deploy this locally compiled localhost API build. Deployment requires a fresh reviewed build with the established HTTPS API setting and explicit approval.

## Approved preview correction — 19 October 2026

The 3030 preview is the visual source of truth. Its stylesheet was copied and scoped into apps/web/src/app/approved-preview.css, with variables namespaced so existing Tailwind/auth/forms keep their semantics. The original reference remains local and intact except for the requested My Dashboard label/navigation change. No new visual direction was introduced.

Ported the reference header/footer, home hero, event cards/discovery/detail, attendee overview and organizer/admin overview composition into React while retaining real API data. My Dashboard remains visible on smaller viewports and opens the applicable workspace. Removed the hamburger-style primary dashboard entry. The approved heading/font/spacing/card classes are reused directly; development-only banner, role selector and coverage/state links are not part of the real app.

Visual contract checked at 1440px: workspace 1376px, sidebar 235px, DM Sans body font, 86px header, 22px statistic tile padding and 32px dashboard heading. 20 browser tests passed, including auth/role restrictions, sidebar persistence, responsive layout, notifications and the visual contract. Nine additional real-local public route checks across 1440/768/390px reported no horizontal overflow or browser page errors. Frontend type-check/lint and local optimized build passed.

Real content is deliberately different from sample content: counts, event names, chart values and missing-image fallbacks reflect local API records. Some seeded cover URLs point to absent files; do not claim those images are recovered. Existing real workflows and backend safeguards remain in place. Not every legacy form or administrative subtab has had a screenshot-by-screenshot visual comparison; the checks above describe exactly what was verified.

## Requested AI and navigation refinements — 19 October 2026

Implemented natural-language home discovery through the existing AI endpoint, using only actual published catalog event cards. Errors and maintenance remain explicit; requests time out. The full AI page now has a viewport-sized conversation and a fixed-in-layout composer, with messages scrolling internally. Event chat opens alongside the current event and supplies its published details, ticket options, FAQs and policies as context. Missing or unpublished event context is rejected.

Saved events now render within `/overview?view=saved`, including pagination, refresh, removal and unavailable-event handling. Existing browser storage remains the persistence source; cross-device/account synchronization is not implemented. Organizer actions distinguish new users, existing applications and approved organizers. Icon spacing and the existing gradient brand wordmark were adjusted.

The specifically requested account was granted ADMIN in the verified localhost PostgreSQL database only. Reload or sign in again to refresh the displayed role. No production account, deployment configuration or environment file was changed.

The local launcher now allows the configured AI provider while keeping email/payment/OAuth/media credentials disabled and schedulers off. Two real read-only AI requests succeeded: natural-language event matching returned a real event card, and event-specific chat answered the selected event's cancellation policy while remaining on the event URL. Desktop and 390px mobile composer bounds were inspected. These checks do not verify external payments, email or wallet integration.

Verification for these refinements: combined protected-route/workspace Playwright run 28/28 passing; targeted AI service/Express tests 36/36 passing; frontend and API type-checks passed; explicit browser test-file type-check passed; frontend lint and production build passed. Targeted API lint had zero errors and two existing explicit-any warnings. Browser tests mostly mock API responses; one event-chat test loads a published event from the real local API and mocks only the AI reply. Separate real provider checks are described above.

Final preservation check: all 51 files in the initial working-state snapshot remain present. Forty are byte-identical; eleven were intentionally updated for this request and its documentation/tests. No unexpected original-file changes. Index remains empty; no commit, push or deployment.

## Search routing, chat workspace and attendee navigation — 19 October 2026

Home search now routes a simple matching category, supported synonym or small typo to filtered Discover, retaining the selected city. A detailed request or unknown category opens the AI page and sends the request once. This supersedes the earlier inline home-result design. Category matching uses the actual API category list and does not invent category slugs.

Event chat has an expand/minimize overlay that keeps the same conversation, event context and URL. Escape minimizes first; keyboard focus stays within the expanded dialog. The full AI page and expanded chat include inspiration actions that initiate real catalog queries, subtle surface depth and message transitions. Composer remains visible; reduced-motion preferences disable added animations.

Event galleries use the requested large image plus fully filled thumbnail layout. Duplicate URLs and failed images are omitted; actual event image URLs are retained. No unrelated sample images were inserted.

Removed duplicate admin section tabs; the workspace sidebar remains the section navigation. Organizer analytics moved near the top of the sidebar and has a visible overview shortcut. Public top navigation remains available for public destinations.

Separated `/bookings` (existing booking details, status filters and actions) from `/tickets` (direct digital passes and booking selector). A booking links directly to its passes. Tickets and calendar load all booking pages using authenticated read requests. `/calendar` shows confirmed bookings on their actual dates, supports previous/next month and Today, and links to tickets. This is an internal calendar; external calendar synchronization has not been added.

The explicitly confirmed localhost account tarunkumarsahu2551@gmail.com now has an approved organizer profile while retaining ADMIN. Only the localhost database was used. Read-only signed local session checks returned 200 for organizer profile/stats and admin stats, and the real organizer dashboard rendered its analytics shortcut. These checks do not verify password login or real transactional actions.

Verification: combined Playwright auth/workspace run passed 33/33 tests with mocked transactional data; an added pure search-classification test and focused rechecks followed. Frontend type-check, lint and production build passed. Desktop and mobile AI composer bounds were inspected, with no horizontal overflow at 390px; real event gallery had zero broken image elements. No payment, refund, email, production deployment, commit or push was performed.

## Compact layouts, reliable event cards and organization settings — 19 October 2026

AI inspiration controls now fit a 1280×650 screen without their own scrollbar. Header/chips are more compact, preserving message space and the visible composer. Verified event cards render before supporting prose. The API resolves exact catalog title/slug references when the model omits its EVENTS trailer, hydrates only published upcoming records, and removes redundant recommendation list items. A real local AI request returned 10 event cards successfully; this does not guarantee provider uptime or authorize invented event data.

All 10 existing local sample events received additional category-related illustrative image URLs, explicitly labelled as sample gallery photos in development. Original image arrays were backed up under the ignored local preview folder before appending. Production records and environment settings were not changed. Existing failed cover URLs are still omitted by the gallery rather than misrepresented as recovered media.

Event descriptions, venue and policies remain on one page. Section navigation now highlights the active section, includes icons, stays accessible while scrolling, and honors reduced-motion preferences. Font sizes and form typography were aligned with the shared styles.

Venue pages now show paginated clickable event cards scoped to the exact venue ID. The validated public search filter uses a bound SQL parameter and retains the published-only visibility rule. The initial live check found a PostgreSQL text/UUID cast mismatch; this was corrected and the final actual venue/API/browser checks passed.

Calendar uses a compact month grid with selected-date plans beside it on desktop and stacked on narrow screens. Plans link to their event page and separately to tickets. It continues to display actual confirmed bookings; no booking/payment was created to populate a preview.

Added /organizer/settings for organization name, description, website and phone. Personal profile remains /account with its existing verified-email handling. Profile updates use an authenticated PATCH /organizers/me route, strict field validation, and ownership-scoped lookup; role, verification and user ID fields cannot be changed through it. Browser save verification used mocked API responses, and backend authorization/whitelist tests used mocks, so no real profile fields were altered by these tests. Admin navigation now puts Team & access near the bottom and Audit logs last.

Final verification: 39/39 combined Playwright checks, 132/132 targeted API tests across five suites, frontend/API/test-file type-checks, frontend lint and production build passed. Browser checks include compact AI/calendar bounds, selectable local gallery thumbnails, persistent event sections, venue-only results and event links, organization settings, navigation and auth restrictions. Original working-state snapshot contains no missing files; only requested files and tests were changed. No staging, commit, push or deployment.

## Centered AI, concise venue/admin pages and local booking fixtures — 19 October 2026

AI recommendations now use a dedicated compact card component: four columns on wide desktop, three on medium desktop and two on small screens. Conversation content is centered with recommendation shortcuts above it, rather than using a right sidebar. Empty conversation greeting is centered too. Cards retain event links, photos, category, city/date and price.

Venue pages no longer reserve a large empty cover area. The map is 150px high and the venue summary is compact, bringing the event list near the first viewport. Fixed an existing Leaflet server-rendering window-reference error by dynamically loading the browser-only map client. Venue browser checks now assert no page errors.

Removed repeated System Controls and Team & Access section headings, added section-specific page descriptions, simplified maintenance copy and aligned admin heading, body, label and button typography. No maintenance switch was changed.

Added three idempotently named localhost-only preview bookings for tarunkumarsahu2551@gmail.com on existing Spice & Stone, Echoes in the Valley and DevPulse sample events. There are four VALID preview tickets (one/two/one). Dedicated inactive ticket types are labelled LOCAL PREVIEW — test pass only. They do not consume existing sellable stock. Booking totals and booking item prices are zero; no payment record was created and no payment/refund/email workflow was invoked. The inactive type catalog price matches the existing active price to avoid distorting public event pricing. Booking/ticket identifiers are recorded in the ignored local preview folder. These fixtures must not be copied to production.

Calendar initially opens the nearest upcoming confirmed booking month, making the local preview plans visible without navigating forward through months. Read-only real-account checks confirmed three bookings, four successful QR responses, visible calendar plans and digital passes.

Verification: 41/41 combined Playwright checks passed; five focused checks passed after the map-loading correction. Frontend type-check, test-file type-check, frontend lint and production build passed (no lint warnings in the final run). No commit, push, deployment, env-file change or production data write.
