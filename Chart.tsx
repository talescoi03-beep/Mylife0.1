// Single-series column chart: thin columns with rounded tops on one baseline,
// recessive gridlines, value shown for the selected / latest column, and a
// table view so nothing depends on seeing the chart.
import { useId, useState } from 'react';

export interface Datum { key: string; label: string; value: number; detail?: string }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

export function ColumnChart({ data, title, how, unit = '', max, color = 'accent', format }: {
  data: Datum[]; title: string; how: string; unit?: string; max?: number; color?: 'accent' | 'harvest';
  format?: (v: number) => string;
}) {
  const id = useId();
  const [sel, setSel] = useState<number | null>(null);
  const fmt = format ?? ((v: number) => `${Math.round(v * 10) / 10}${unit}`);
  const W = 320;
  const H = 150;
  const padL = 30;
  const padB = 22;
  const top = 8;
  const top_ = max ?? niceMax(Math.max(...data.map((d) => d.value), 0));
  const band = (W - padL) / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => H - padB - (Math.max(0, v) / top_) * (H - padB - top);
  const active = sel ?? data.length - 1;
  const labelEvery = Math.ceil(data.length / 6);
  const empty = data.every((d) => d.value === 0);

  return (
    <figure className="chart-card" style={{ margin: 0 }} aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{title}</h3>
      <p className="how">{how}</p>
      {empty ? (
        <p className="small muted" style={{ margin: '8px 0 4px' }}>Nothing recorded in this period yet.</p>
      ) : (
        <>
          <div className="small" aria-live="polite" style={{ minHeight: 22, color: 'var(--ink-2)' }}>
            {data[active] && <><strong className="num">{fmt(data[active].value)}</strong> <span className="muted">· {data[active].detail ?? data[active].label}</span></>}
          </div>
          <div className="chart">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${data.map((d) => `${d.label}: ${fmt(d.value)}`).join('; ')}`}>
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line className="gridline" x1={padL} x2={W} y1={y(top_ * f)} y2={y(top_ * f)} strokeWidth={1} />
                  <text x={padL - 6} y={y(top_ * f) + 3.5} textAnchor="end">{Math.round(top_ * f * 10) / 10}</text>
                </g>
              ))}
              {data.map((d, i) => {
                const cx = padL + band * i + band / 2;
                const h = H - padB - y(d.value);
                const r = Math.min(4, h);
                const x0 = cx - bw / 2;
                const yb = H - padB;
                const path = h <= 0 ? '' : `M${x0},${yb} V${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} H${x0 + bw - r} Q${x0 + bw},${yb - h} ${x0 + bw},${yb - h + r} V${yb} Z`;
                return (
                  <g key={d.key}>
                    {h > 0
                      ? <path d={path} className={`bar-mark ${color === 'harvest' ? 'alt' : ''}`} opacity={i === active ? 1 : 0.55} />
                      : <rect x={x0} y={yb - 1} width={bw} height={1} className="bar-mark zero" />}
                    {i % labelEvery === (data.length - 1) % labelEvery && <text x={cx} y={H - 6} textAnchor="middle">{d.label}</text>}
                    <rect x={padL + band * i} y={0} width={band} height={H} fill="transparent" style={{ cursor: 'pointer' }}
                      onPointerEnter={() => setSel(i)} onClick={() => setSel(i)} />
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
      <details className="mt-s">
        <summary className="tiny muted" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>Show as table</summary>
        <table className="small" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <tbody>{data.map((d) => (
            <tr key={d.key} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '6px 0' }}>{d.detail ?? d.label}</td><td className="num right">{fmt(d.value)}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Horizontal bars for comparing a handful of named items (e.g. life areas). */
export function BarList({ rows, title, how, format }: { rows: { label: string; value: number; detail?: string }[]; title: string; how: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fmt = format ?? ((v: number) => String(v));
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      <p className="how">{how}</p>
      {rows.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nothing recorded in this period yet.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div className="stat-line small"><span>{r.label}</span><span className="num muted">{fmt(r.value)}{r.detail ? ` · ${r.detail}` : ''}</span></div>
            <div className="bar" style={{ height: 8, marginTop: 4 }}><i style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
