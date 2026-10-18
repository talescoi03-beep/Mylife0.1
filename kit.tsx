// Shared UI primitives.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { back as goBack } from '../lib/router';
import { IconBack, IconCheck, IconX } from './icons';

// ---------- toast with optional undo ----------

interface ToastItem { id: number; text: string; kind: 'info' | 'win'; action?: { label: string; run: () => void } }
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());

export function toast(text: string, opts: { action?: ToastItem['action']; kind?: ToastItem['kind']; ms?: number } = {}) {
  const item: ToastItem = { id: ++toastSeq, text, kind: opts.kind ?? 'info', action: opts.action };
  toasts = [...toasts.slice(-2), item];
  emitToasts();
  setTimeout(() => dismissToast(item.id), opts.ms ?? (opts.action ? 6000 : 3200));
}
function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

export function Toasts() {
  const list = useSyncExternalStore((cb) => { toastListeners.add(cb); return () => toastListeners.delete(cb); }, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'win' ? 'win' : ''}`}>
          <span>{t.text}</span>
          {t.action && (
            <button onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- confirm dialog ----------

interface ConfirmReq {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this word to enable the button. */
  typeToConfirm?: string;
  resolve: (ok: boolean) => void;
}
let confirmReq: ConfirmReq | null = null;
const confirmListeners = new Set<() => void>();

export function confirm(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmReq = { ...opts, resolve };
    confirmListeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const req = useSyncExternalStore((cb) => { confirmListeners.add(cb); return () => confirmListeners.delete(cb); }, () => confirmReq);
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [req]);
  if (!req) return null;
  const close = (ok: boolean) => {
    req.resolve(ok);
    confirmReq = null;
    confirmListeners.forEach((l) => l());
  };
  const blocked = req.typeToConfirm ? typed.trim().toLowerCase() !== req.typeToConfirm.toLowerCase() : false;
  return (
    <Sheet open title={req.title} onClose={() => close(false)} role="alertdialog">
      {req.body && <div className="prose" style={{ color: 'var(--ink-2)' }}>{req.body}</div>}
      {req.typeToConfirm && (
        <label className="field mt">
          <span>Type “{req.typeToConfirm}” to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" />
        </label>
      )}
      <div className="btn-row">
        <button className="btn secondary" onClick={() => close(false)}>Cancel</button>
        <button className={`btn ${req.danger ? 'danger' : ''}`} disabled={blocked} onClick={() => close(true)}>{req.confirmLabel}</button>
      </div>
    </Sheet>
  );
}

// ---------- sheet ----------

export function Sheet({ open, onClose, title, children, role = 'dialog' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), textarea, select, button');
      (first ?? ref.current)?.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role={role} aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- check button ----------

export function Check({ on, onToggle, label, priority = 0, variant }: {
  on: boolean; onToggle: () => void; label: string; priority?: number; variant?: 'minimum' | 'rest';
}) {
  const [pop, setPop] = useState(false);
  return (
    <button
      className={`check ${on ? 'on' : ''} ${pop ? 'pop' : ''} ${priority >= 2 && !on ? `p${priority}` : ''} ${variant === 'minimum' ? 'min' : ''} ${variant === 'rest' ? 'rest' : ''}`}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) { setPop(true); setTimeout(() => setPop(false), 400); }
        onToggle();
      }}
    >
      <span className="ring"><IconCheck /></span>
    </button>
  );
}

// ---------- layout helpers ----------

export function PageHead({ title, sub, backTo, actions }: { title: ReactNode; sub?: ReactNode; backTo?: string; actions?: ReactNode }) {
  return (
    <>
      {backTo && (
        <button className="back" onClick={() => goBack(backTo)}><IconBack size={20} />Back</button>
      )}
      <header className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="inline" style={{ flex: '0 0 auto', gap: 4 }}>{actions}</div>}
      </header>
    </>
  );
}

export function Section({ title, count, action, note, children, id }: {
  title: ReactNode; count?: number; action?: ReactNode; note?: ReactNode; children: ReactNode; id?: string;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-h">
        <h2 id={id}>{title}{count != null && <span className="count">{count}</span>}</h2>
        {action}
      </div>
      {note && <p className="section-note">{note}</p>}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

export function Progress({ pct, harvest }: { pct: number | null; harvest?: boolean }) {
  return (
    <div className={`bar ${harvest ? 'harvest' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <i style={{ width: `${pct ?? 0}%` }} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Chips<T extends string | number>({ values, options, onChange, label, multi = true }: {
  values: T[]; options: { value: T; label: string }[]; onChange: (v: T[]) => void; label: string; multi?: boolean;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button key={String(o.value)} type="button" className="chip" aria-pressed={on}
            onClick={() => onChange(multi ? (on ? values.filter((v) => v !== o.value) : [...values, o.value]) : [o.value])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Textarea that grows with its content. */
export function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { serif?: boolean; minRows?: number }) {
  const { serif, minRows = 3, className, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 2, minRows * 27 + 24)}px`;
  }, [props.value, minRows]);
  return <textarea ref={ref} className={`textarea ${serif ? 'serif' : ''} ${className ?? ''}`} rows={minRows} {...rest} />;
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        <span style={{ display: 'block' }}>{label}</span>
        {hint && <span className="tiny muted">{hint}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * Marks paraphrased ideas from the Jim Rohn seminar transcript, so they are never
 * confused with the app's own features. Not quotations; not affiliated.
 */
export function SeminarNote({ children }: { children: ReactNode }) {
  return (
    <aside className="seminar">
      {children}
      <span className="src">Idea from the Jim Rohn seminar, paraphrased</span>
    </aside>
  );
}

/** Number input that keeps a string while typing and reports numbers or null. */
export function NumberInput({ value, onChange, placeholder, step = 'any', id, ...rest }: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; id?: string;
  'aria-label'?: string; min?: number;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if ((text === '' ? null : Number(text)) !== value) setText(value == null ? '' : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input id={id} className="input num" inputMode="decimal" step={step} placeholder={placeholder} value={text} {...rest}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.');
        setText(t);
        if (t.trim() === '') onChange(null);
        else if (!Number.isNaN(Number(t))) onChange(Number(t));
      }} />
  );
}
