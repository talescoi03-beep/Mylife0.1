// Tiny history-based router (no dependency). Paths like /plan/goal/<id>.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') window.addEventListener('popstate', emit);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  const depth = Number((history.state as any)?.d ?? 0);
  if (opts.replace) history.replaceState({ d: depth }, '', to);
  else history.pushState({ d: depth + 1 }, '', to);
  window.scrollTo(0, 0);
  emit();
}

/** Goes back within the app, or to `fallback` when the page was opened directly. */
export function back(fallback = '/') {
  if (Number((history.state as any)?.d ?? 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

const snapshot = () => location.pathname + location.search;
export function useLocation() {
  const href = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    snapshot,
    snapshot,
  );
  const url = new URL(href, 'http://local');
  return { path: url.pathname.replace(/\/+$/, '') || '/', query: url.searchParams };
}

/** Matches "/plan/goal/:id" against a path, returning params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, replace, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
    />
  );
}
