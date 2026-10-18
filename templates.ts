import type { JournalKind, Season } from '../data/schema';

export interface Prompt { key: string; q: string; hint?: string }

export const MORNING: Prompt[] = [
  { key: 'most', q: 'What matters most today?' },
  { key: 'action', q: 'What is one action that moves my life forward?', hint: 'You can add it as a task for today.' },
  { key: 'quality', q: 'What quality do I want to practise?', hint: 'e.g. patience, courage, focus' },
];

export const EVENING: Prompt[] = [
  { key: 'accomplished', q: 'What did I accomplish?' },
  { key: 'learned', q: 'What did I learn?', hint: 'You can save it to your idea notebook.' },
  { key: 'obstacle', q: 'What got in the way?' },
  { key: 'change', q: 'What will I change tomorrow?' },
  { key: 'grateful', q: 'What am I grateful for?' },
];

export const KIND_LABEL: Record<JournalKind, string> = {
  free: 'Journal',
  morning: 'Morning',
  evening: 'Evening review',
  weekly: 'Weekly review',
  monthly: 'Monthly review',
  season: 'Life season',
  fresh_start: 'Fresh start',
};

export const SEASONS: Record<Season, { name: string; meaning: string; prompts: Prompt[] }> = {
  winter: {
    name: 'Winter',
    meaning: 'Recovery. A hard stretch — something didn’t work, or life is heavy right now.',
    prompts: [
      { key: 'hard', q: 'What is hard right now?' },
      { key: 'stronger', q: 'How could this season make me stronger, wiser or more skilled?' },
      { key: 'small', q: 'What small thing can I still do, even now?' },
    ],
  },
  spring: {
    name: 'Spring',
    meaning: 'Beginning. A new opportunity or a fresh start is in front of you.',
    prompts: [
      { key: 'opportunity', q: 'What opportunity is in front of me?' },
      { key: 'plant', q: 'What do I want to plant now?' },
      { key: 'first', q: 'What is the first step this week?' },
    ],
  },
  summer: {
    name: 'Summer',
    meaning: 'Sustained effort. Things are growing and need steady care and protection.',
    prompts: [
      { key: 'protect', q: 'What needs protecting from distraction or neglect?' },
      { key: 'tend', q: 'What is growing that needs my steady attention?' },
      { key: 'weeds', q: 'What “weeds” keep creeping in, and how will I deal with them?' },
    ],
  },
  autumn: {
    name: 'Autumn',
    meaning: 'Reviewing results. Time to look honestly at what you have harvested.',
    prompts: [
      { key: 'harvest', q: 'What did I harvest from my effort?' },
      { key: 'own', q: 'What do I take full responsibility for — without excuses or complaint?' },
      { key: 'next', q: 'What will I plant differently next time?' },
    ],
  },
};

export function promptsFor(kind: JournalKind): Prompt[] {
  if (kind === 'morning') return MORNING;
  if (kind === 'evening') return EVENING;
  return [];
}

/** Plain-text summary of an entry (search, list previews, CSV). */
export function entryText(e: { body: string | null; answers: Record<string, string>; kind: JournalKind; season?: Season | null }): string {
  const parts: string[] = [];
  const prompts = e.kind === 'season' && e.season ? SEASONS[e.season].prompts : promptsFor(e.kind);
  for (const p of prompts) if (e.answers?.[p.key]) parts.push(`${p.q} ${e.answers[p.key]}`);
  for (const [k, v] of Object.entries(e.answers ?? {})) if (v && typeof v === 'string' && !prompts.some((p) => p.key === k)) parts.push(v);
  if (e.body) parts.push(e.body);
  return parts.join('\n');
}
