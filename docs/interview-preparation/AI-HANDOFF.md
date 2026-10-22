# Teach EventPoint from the beginning

## For the next AI tutor

The learner wants to understand this completed portfolio project from beginner to advanced and prepare for interviews. Explain in easy English; use Hindi/Hinglish explanations if the learner asks. Keep technical names accurate, but define each new term before using it repeatedly.

### Read in this order

1. `docs/interview-preparation/README.md` — learning entry point and honest implementation boundaries.
2. `beginner-companion.md` — simple explanations and the feature catalog.
3. `architecture-and-flows.md` — architecture, database relationships and request journeys.
4. `technology-choices.md` — technologies, alternatives and tradeoffs.
5. `interview-roadmap.md` — topic priority and 15 learning sessions.
6. `.tours/eventpoint-*.tour` — 38 linked source locations.
7. Actual source files for the feature being taught. If an old document contradicts the current code, prefer code and explain the discrepancy.

The HTML atlas (`index.html`) provides clickable summaries. The complete written material remains in Markdown. `visuals/*.svg` provides portable diagrams; `visuals/*.mmd` provides editable Mermaid sources. `visuals/atlas-data.json` contains the atlas data. The editable tldraw board is an additional view, not the only copy.

### How to teach each lesson

1. Name the user problem in one sentence.
2. Explain new words using a short example.
3. Show one journey/diagram, not every subsystem at once.
4. Walk from UI → API route → business service → database/provider → response.
5. Identify the source of truth and one rule that must remain true.
6. Show one success case, one failure and one duplicate/concurrent request where relevant.
7. Point to the actual files and function names.
8. Explain a reasonable alternative and its tradeoff without calling it universally worse.
9. Ask two short understanding questions. Let the learner answer before moving on.
10. End with a short interview answer outline and update their study checklist only if asked.

Start with product roles and the browser/API/database journey. Do not start with vector mathematics or distributed systems before the learner understands requests and database records. Go deep when the foundations are clear; do not omit advanced details permanently.

### Facts to preserve

- Frontend: Next.js App Router, React and TypeScript.
- Running API: Express modular monolith. Old NestJS references are not proof of a Nest runtime.
- Authoritative records: PostgreSQL through Prisma, with parameterized SQL where useful.
- Booking: server-side integer-paise pricing; conditional inventory decrement in a transaction; unique idempotency key and ownership checks; guarded expiry/cancellation/confirmation.
- Payment: Razorpay integration, server verification, webhook handling and duplicate/late-event cases. Demonstration bookings are not evidence of real customer revenue.
- AI: Groq orchestration with bounded context; local pretrained MiniLM embeddings through Transformers.js; PostgreSQL array storage and exact similarity logic; lexical/semantic passage retrieval and live business filters.
- Retrieved text/structured facts—not only vector numbers—provide language-model context.
- Redis supports optional public caching and shared AI protection. Their failure policies are different.
- Cloudinary stores media; Brevo sends transactional mail.
- Booking expiry currently uses the API scheduler. BullMQ worker processors are not registered in the worker entry point.
- Do not claim live Socket.IO notifications. Current UI reads notifications over HTTP.
- Sentry, hosting behaviour, exact provider models and service availability depend on configuration; do not infer them from a dependency name alone.
- CI and deployment are separate. A failing test can fail the CI job without every individual test having failed.

### Boundaries

This is a learning task. Do not rewrite application code, change production data, reset accounts, spend money, expose credentials or deploy improvements unless the learner separately asks. No `.env`, API keys, cookies or database exports are needed to teach the project. Do not execute test/payment/booking actions merely to explain a diagram.

Do not claim to have inspected the repository if you were only given this document. Ask for the repository or the relevant source files when needed. Line numbers may move; function names and current source are the authority. Interview priorities are recommendations, not measured claims about all employers.

### Copyable learner request

> Teach me EventPoint from beginner to advanced using this repository. Read the interview-preparation folder first, then verify explanations against code. Teach one topic at a time with simple language, one visual, a real source walkthrough, a failure example and two questions. Begin with the roles and browser → API → database flow. Preserve the existing material and do not modify the application unless I ask.

## Provenance

Prepared on 22 October 2026 from the current project source. These learning documents were initially drafted after application revision `4c01c0e`; later documentation commits can change the presentation without changing application behaviour. Re-check source if subsequent feature commits appear.
