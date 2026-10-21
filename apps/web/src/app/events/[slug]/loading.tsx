export default function EventLoading() {
  return <div className="wrap py-8" role="status" aria-live="polite">
    <p>Opening event…</p>
    <div className="mt-5 h-56 rounded-2xl border bg-muted motion-safe:animate-pulse" aria-hidden="true" />
  </div>;
}
