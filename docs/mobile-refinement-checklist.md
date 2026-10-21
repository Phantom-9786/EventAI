# Mobile refinement checklist — 21 October 2026

## Latest review

| Requested change | Implementation |
| --- | --- |
| Bolder mobile EventPoint wordmark | Increased visible weight with a small stroke; desktop typography retained. |
| Homepage subtitle indentation | Narrow readable measure, consistent left edge, line height and wrapping. |
| Remove redundant mobile grid/list toggles | Hidden on phone widths; desktop controls retained. |
| Separate Clear filters from the result count | Bordered control in the right column, with a flexible count column. |
| Dance event makes the phone page wider | Constrained grid children, images and thumbnails; long unbroken descriptions wrap. |
| Different image aspect ratios | Cover crops within its frame; full-size dialog fits the image and provides zoom/fit controls. |
| Slow/unresponsive event navigation | Route loading feedback, request-level event fetch deduplication, and recommendations streamed separately from event details. |
| Oversized image downloads | Responsive Cloudinary sizes and automatic quality/format; full-resolution image retained for the enlarged gallery. The Dance cover measured 1,415,189 bytes originally versus 41,240 bytes at 640px in a direct check. |
| Venue events too narrow/tall | One event card per row on phones, consistent with Discover. |
| Bookings and saved events refresh alignment | Refresh actions placed beside their page headings. |
| Notification refresh/action layout | Refresh beside Notifications/unread count; mark/clear actions in a separate right-aligned row. |
| Attendee and scanner pages too inset | Removed extra inner container side padding on mobile. |
| Camera permission succeeds without a preview | Video stays mounted before stream attachment; cancelled/stale streams are stopped. |
| QR scanning browser compatibility | Native detector with dynamically loaded jsQR fallback; frame processing limited to avoid scanning every animation frame. |
| Category actions on separate lines | Three equal-height columns; button labels can wrap. |

## Previous review

- Search focus indicator stays around the search field, away from its icon/text.
- Clear filters clears unsent search/city/sort drafts as well as URL filters.
- Mobile home category labels wrap inside their boxes.
- Notification shortcut beside mobile Menu.
- Calendar month and Today controls share a row; compact day numbers and today border.
- Mobile refresh buttons use icons; organizer navigation retained.
- Admin category form fields stay within their container.
- System-control status badges are compact and centered; messages use taller textareas.
- Owner deletion/deactivation controls hidden; backend prevents owner account closure before ownership transfer.
- AI enforces its response schema, recovers rejected tool generations and follows the current message's language.
- Shared dialog scroll locking handles overlapping overlays.
- No developer-credit footer added.

## Verification and limits

- Web TypeScript and ESLint checks passed.
- Portable QR decoder successfully decoded a generated QR image.
- Live Dance page at a 390px viewport: page width 382px, cover width 350px; its long description wraps inside that width. Enlarged gallery and zoom remain contained.
- Live Discover: mobile grid/list buttons hidden; Clear filters clears an unsent draft; both desktop controls remain visible and list view changes the layout.
- Category actions fit one row at 320px and 390px. Bookings refresh sits alongside its heading. Notifications refresh shares the title row.
- Previous AI/account regression run: 66 passing tests.
- Real phone camera permission, preview and a physical QR ticket still require device testing. Do not mark an attendee checked in merely to test the UI.
- Render's free service can sleep and delay its first request. Route feedback and removal of duplicate/blocking requests improve app behavior but cannot eliminate that hosting delay.
- A full site audit is separate from these reported refinements.

QR fallback references: [MDN BarcodeDetector compatibility](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector), [jsQR usage](https://github.com/cozmo/jsQR).
