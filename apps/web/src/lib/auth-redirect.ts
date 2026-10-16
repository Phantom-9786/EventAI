/** Accept only local paths; URL normalization must never turn a return path into another origin. */
export function authReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\s]/.test(raw)) {
    return '/events';
  }
  return raw;
}
