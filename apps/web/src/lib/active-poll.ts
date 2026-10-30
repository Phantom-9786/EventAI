// A forgotten foreground tab must not keep the API/database awake all day.
// User actions and returning to the tab resume updates immediately.
export function pollWhileActive(refresh: () => void, intervalMs: number): () => void {
  const idleMs = 2 * 60_000;
  let lastActivity = Date.now();
  const visible = () => document.visibilityState === 'visible';
  const onActivity = () => {
    const wasIdle = Date.now() - lastActivity >= idleMs;
    lastActivity = Date.now();
    if (wasIdle && visible()) refresh();
  };
  const onReturn = () => {
    if (!visible()) return;
    lastActivity = Date.now();
    refresh();
  };
  const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
  for (const event of events) window.addEventListener(event, onActivity, { passive: true });
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);
  const timer = window.setInterval(() => {
    if (visible() && Date.now() - lastActivity < idleMs) refresh();
  }, intervalMs);
  return () => {
    window.clearInterval(timer);
    for (const event of events) window.removeEventListener(event, onActivity);
    window.removeEventListener('focus', onReturn);
    document.removeEventListener('visibilitychange', onReturn);
  };
}
