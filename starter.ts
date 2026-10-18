// Starter life areas and optional example content (always marked as examples
// and removable in one tap from Settings).
import { addDays, type ISODate } from '../lib/dates';
import { stableId } from '../lib/ids';
import type { Store } from './store';

export const STARTER_AREAS: { key: string; name: string; icon: string; optional?: boolean }[] = [
  { key: 'health', name: 'Health and fitness', icon: '🏃' },
  { key: 'work', name: 'Work and trading', icon: '📈' },
  { key: 'money', name: 'Money', icon: '💰' },
  { key: 'family', name: 'Family and relationships', icon: '👨‍👩‍👧' },
  { key: 'growth', name: 'Personal development and learning', icon: '📚' },
  { key: 'projects', name: 'Projects and business', icon: '🛠️' },
  { key: 'faith', name: 'Faith or spirituality', icon: '🕊️', optional: true },
  { key: 'fun', name: 'Fun, travel and experiences', icon: '🧭' },
  { key: 'home', name: 'Home and daily responsibilities', icon: '🏠' },
];

export function areaIdFor(userId: string, key: string) {
  return stableId('starter_area', userId, key);
}

export function createStarterAreas(store: Store, keys: string[]) {
  STARTER_AREAS.forEach((a, i) => {
    if (!keys.includes(a.key)) return;
    const id = areaIdFor(store.userId, a.key);
    if (!store.get('areas', id)) store.create('areas', { id, name: a.name, icon: a.icon, sort: i });
  });
}

/** Adds clearly labelled example content linked to the starter areas that exist. */
export function addExamples(store: Store, today: ISODate, weekStartsOn: number) {
  const area = (key: string) => store.get('areas', areaIdFor(store.userId, key))?.id ?? null;
  const ex = { is_example: true };

  // Health: a gym routine habit.
  store.create('habits', {
    ...ex, title: 'Gym session', area_id: area('health'), schedule: 'weekly', weekly_target: 3,
    minimum_version: '15 minutes of bodyweight exercises at home', why: 'Energy for work and family', start_date: today,
  });

  // Work & trading: study habit + goal.
  const trading = store.create('goals', {
    ...ex, title: 'Build a written trading plan', area_id: area('work'), category: 'economic', horizon: 'quarter',
    description: 'A one-page plan with entry, exit and risk rules I actually follow.',
    why: 'Stop making impulsive trades; protect savings.', who_benefits: 'Me and my family',
    progress_mode: 'milestones', become: 'Patient, disciplined, honest about losses',
    next_action: 'Review last month’s trades and list three mistakes',
    obstacles: [{ obstacle: 'Skipping study when markets are quiet', response: 'Study 20 minutes before opening any chart' }],
    celebration: 'Dinner out with family',
  });
  ['Review last month’s trades', 'Write risk rules', 'Paper-trade the plan for 4 weeks'].forEach((title, i) =>
    store.create('milestones', { ...ex, goal_id: trading.id, title, sort: i }));
  store.create('habits', {
    ...ex, title: 'Trading study', area_id: area('work'), goal_id: trading.id, kind: 'measure', unit: 'min', daily_target: 30,
    schedule: 'weekdays', weekdays: [0, 1, 2, 3, 4], minimum_version: 'Read one page of my trading journal', start_date: today,
  });

  // Projects: a game-development project.
  const game = store.create('goals', {
    ...ex, title: 'Release a small game', area_id: area('projects'), category: 'personal', horizon: '1y',
    description: 'A finished, playable game published on one store.',
    why: 'Prove to myself I can finish what I start.', progress_mode: 'milestones',
    become: 'Someone who ships — finishing over polishing', celebration: 'Weekend trip',
  });
  const proto = store.create('milestones', { ...ex, goal_id: game.id, kind: 'project', title: 'Playable prototype', sort: 0 });
  store.create('milestones', { ...ex, goal_id: game.id, title: 'Art and sound pass', sort: 1 });
  store.create('milestones', { ...ex, goal_id: game.id, title: 'Publish', sort: 2 });
  store.create('tasks', { ...ex, title: 'Sketch the core game loop on paper', goal_id: game.id, milestone_id: proto.id, area_id: area('projects'), due_date: today, priority: 2 });

  // Learning: reading.
  const book = store.create('learning_items', {
    ...ex, kind: 'book', title: 'A book on habits', area_id: area('growth'), progress_unit: 'pages', progress_current: 40, progress_total: 280,
    key_ideas: 'Small actions repeated daily compound.', application: 'Attach reading to my morning coffee.',
  });
  store.create('habits', { ...ex, title: 'Read', area_id: area('growth'), learning_id: book.id, kind: 'measure', unit: 'pages', daily_target: 10, minimum_version: 'One page', start_date: today });

  // Family time.
  void weekStartsOn;
  store.create('tasks', {
    ...ex, title: 'Plan a family outing', area_id: area('family'), due_date: addDays(today, 3),
    recurrence: { freq: 'weekly', interval: 1 },
  });
  store.create('people', { ...ex, name: 'Example: Mum', relation: 'Family', contact_every_days: 7 });
}
