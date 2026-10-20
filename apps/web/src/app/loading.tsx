export default function Loading() {
  return (
    <div className="wrap py-10" role="status" aria-live="polite" aria-label="Loading page">
      <p className="text-sm font-medium text-foreground">Loading…</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map(key => (
          <div key={key} className="h-48 rounded-2xl border border-border bg-muted motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
