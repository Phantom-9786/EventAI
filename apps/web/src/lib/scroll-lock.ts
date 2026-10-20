// Overlapping dialogs can close in either order. Restore scrolling only after
// the final overlay closes, rather than restoring another overlay's "hidden".
let locks = 0;
let originalOverflow = '';

export function lockPageScroll(): () => void {
  if (locks++ === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = originalOverflow;
  };
}
