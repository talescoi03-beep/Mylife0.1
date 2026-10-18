import type { Goal, Milestone } from '../data/schema';

export interface GoalProgress {
  /** 0–100, or null when there is nothing to measure yet */
  pct: number | null;
  /** How the number was calculated, in plain words */
  basis: string;
}

/**
 * Progress comes only from what the goal itself measures: a number you update,
 * milestones you tick off, or your own assessment. Finishing unrelated tasks
 * never moves it.
 */
export function goalProgress(g: Goal, milestones: Milestone[]): GoalProgress {
  if (g.status === 'completed') return { pct: 100, basis: 'Marked complete' };
  if (g.progress_mode === 'numeric') {
    const start = Number(g.start_value ?? 0);
    const target = g.target_value;
    const current = g.current_value ?? start;
    const unit = g.unit ? ` ${g.unit}` : '';
    if (target == null || target === start) return { pct: null, basis: 'Numeric: set a target to measure progress' };
    const pct = Math.round(((current - start) / (target - start)) * 100);
    return {
      pct: Math.max(0, Math.min(100, pct)),
      basis: `Numeric: ${fmtNum(current)}${unit} toward ${fmtNum(target)}${unit}${start ? ` (started at ${fmtNum(start)})` : ''}`,
    };
  }
  if (g.progress_mode === 'milestones') {
    const ms = milestones.filter((m) => m.goal_id === g.id && !m.deleted_at);
    if (!ms.length) return { pct: null, basis: 'Milestones: add milestones to measure progress' };
    const done = ms.filter((m) => m.done).length;
    return { pct: Math.round((done / ms.length) * 100), basis: `Milestones: ${done} of ${ms.length} complete` };
  }
  if (g.manual_progress == null) return { pct: null, basis: 'Your assessment: not set yet' };
  return { pct: g.manual_progress, basis: `Your assessment: ${g.manual_progress}%` };
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export const CATEGORY_LABEL = {
  economic: 'Economic',
  things: 'Things I want',
  personal: 'Personal development',
} as const;

export const CATEGORY_HINT = {
  economic: 'Income, savings, business results',
  things: 'Things you want to have or experience',
  personal: 'Skills and qualities — who you become',
} as const;

export const HORIZON_LABEL = {
  '10y': '10 years',
  '5y': '5 years',
  '3y': '3 years',
  '1y': 'This year',
  quarter: 'This quarter',
  month: 'This month',
  week: 'This week',
  flexible: 'Flexible',
} as const;

export const HORIZON_ORDER = ['10y', '5y', '3y', '1y', 'quarter', 'month', 'week', 'flexible'] as const;
export const LONG_RANGE = new Set(['10y', '5y', '3y']);
