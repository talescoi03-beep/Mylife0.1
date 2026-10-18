import { useState } from 'react';
import { updateSettings, useRows, useSettings, useStore, useToday } from '../app/context';
import { logGoalEvent } from '../app/actions';
import { STARTER_AREAS, addExamples, areaIdFor, createStarterAreas } from '../data/starter';
import { deviceTimeZone, weekdayName } from '../lib/dates';
import { navigate } from '../lib/router';
import { AutoText, Field, SeminarNote, Toggle, toast } from '../ui/kit';
import { IconCheck } from '../ui/icons';

const STEPS = 5;

export function Onboarding() {
  const store = useStore();
  const s = useSettings();
  const today = useToday();
  const areas = useRows('areas');
  const [step, setStepState] = useState(Math.min(s.onboarding?.step ?? 0, STEPS - 1));
  const [picked, setPicked] = useState<string[]>(() => {
    const existing = STARTER_AREAS.filter((a) => areas.some((x) => x.id === areaIdFor(store.userId, a.key))).map((a) => a.key);
    return existing.length ? existing : STARTER_AREAS.filter((a) => !a.optional).map((a) => a.key);
  });
  const [custom, setCustom] = useState('');
  const [reminder, setReminder] = useState(s.reminder_text ?? '');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalWhy, setGoalWhy] = useState('');
  const [examples, setExamples] = useState(false);

  const setStep = (n: number) => {
    setStepState(n);
    updateSettings(store, { onboarding: { ...s.onboarding, step: n } });
    window.scrollTo(0, 0);
  };
  const skip = () => {
    updateSettings(store, { onboarding: { ...s.onboarding, step, skipped: true }, timezone: s.timezone ?? deviceTimeZone() });
    navigate('/', { replace: true });
  };
  const finish = () => {
    if (reminder.trim()) updateSettings(store, { reminder_text: reminder.trim() });
    if (goalTitle.trim()) {
      const g = store.create('goals', { title: goalTitle.trim(), why: goalWhy.trim() || null, horizon: '1y' });
      logGoalEvent(store, g.id, 'created', 'Goal written down');
    }
    if (examples) addExamples(store, today, s.week_starts_on);
    updateSettings(store, { onboarding: { step: STEPS, done: true, skipped: false }, timezone: s.timezone ?? deviceTimeZone() });
    toast('You’re set. Start with today’s top three.');
    navigate('/', { replace: true });
  };

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--safe-top) + 28px)' }}>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">Step {step + 1} of {STEPS}</span>
        <button className="link-btn" onClick={skip}>Skip for now</button>
      </div>

      {step === 0 && (
        <section>
          <h1 className="page-title mt">Welcome to My Life</h1>
          <div className="prose mt" style={{ color: 'var(--ink-2)' }}>
            <p>This is a place to decide what you want from your life, why it matters, who you need to become — and what to do today.</p>
            <p>Its approach comes from a Jim Rohn seminar. Ideas from the seminar are marked and paraphrased; the rest are ordinary planning tools. The app isn’t affiliated with him.</p>
            <p>Missed days are part of it. When things slip, you reflect and restart — no guilt.</p>
          </div>
          <SeminarNote>For things to change for you, you have to change. Work on yourself, and the results follow.</SeminarNote>
          <button className="btn block mt" onClick={() => setStep(1)}>Get started</button>
        </section>
      )}

      {step === 1 && (
        <section>
          <h1 className="page-title mt">Your life areas</h1>
          <p className="page-sub">Pick the parts of life you want to plan. You can rename, hide or add more later — use only what helps.</p>
          <div className="list mt">
            {STARTER_AREAS.map((a) => {
              const on = picked.includes(a.key);
              return (
                <button key={a.key} className="row" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((k) => k !== a.key) : [...picked, a.key])}>
                  <span className={`check ${on ? 'on' : ''}`} style={{ margin: '-8px -4px -8px -10px' }}><span className="ring"><IconCheck /></span></span>
                  <span className="row-main"><span className="row-title">{a.icon} {a.name}</span>{a.optional && <span className="row-meta">Optional</span>}</span>
                </button>
              );
            })}
          </div>
          <form className="inline mt" onSubmit={(e) => {
            e.preventDefault();
            if (!custom.trim()) return;
            store.create('areas', { name: custom.trim(), sort: 100 + areas.length });
            setCustom('');
            toast('Area added');
          }}>
            <input className="input" placeholder="Add your own area" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn secondary" style={{ flex: '0 0 auto' }} disabled={!custom.trim()}>Add</button>
          </form>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setStep(0)}>Back</button>
            <button className="btn" onClick={() => { createStarterAreas(store, picked); setStep(2); }}>Continue</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1 className="page-title mt">Time and money</h1>
          <p className="page-sub">So “today” ends at your midnight, and amounts show in your currencies.</p>
          <div className="form mt">
            <Field label="Time zone" hint="Change it any time in Settings.">
              <input className="input" readOnly value={s.timezone ?? deviceTimeZone()} />
            </Field>
            <Field label="Week starts on">
              <select className="select" value={s.week_starts_on} onChange={(e) => updateSettings(store, { week_starts_on: Number(e.target.value) })}>
                {[6, 0, 1].map((d) => <option key={d} value={d}>{weekdayName(d)}</option>)}
              </select>
            </Field>
            <Field label="Main currency">
              <select className="select" value={s.default_currency} onChange={(e) => updateSettings(store, { default_currency: e.target.value })}>
                {(s.currencies ?? ['USD', 'IQD']).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn" onClick={() => { updateSettings(store, { timezone: s.timezone ?? deviceTimeZone() }); setStep(3); }}>Continue</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1 className="page-title mt">What do you want, and why?</h1>
          <p className="page-sub">Optional — you can do this later in Plan.</p>
          <div className="form mt">
            <Field label="One thing you want in the next year"><input className="input" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="Be specific" /></Field>
            <Field label="Why it matters to you"><AutoText serif value={goalWhy} onChange={(e) => setGoalWhy(e.target.value)} minRows={2} /></Field>
            <Field label="A line to read every morning" hint="Your own words. It appears at the top of Today.">
              <AutoText serif value={reminder} onChange={(e) => setReminder(e.target.value)} minRows={2} />
            </Field>
          </div>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setStep(2)}>Back</button>
            <button className="btn" onClick={() => setStep(4)}>Continue</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h1 className="page-title mt">Want some examples?</h1>
          <p className="page-sub">See how the pieces fit: a gym routine, trading study, a game-development project, reading and family time. Each is labelled “Example” and can be removed in one tap from Settings.</p>
          <div className="card mt"><Toggle label="Add example content" checked={examples} onChange={setExamples} /></div>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setStep(3)}>Back</button>
            <button className="btn" onClick={finish}>Finish</button>
          </div>
        </section>
      )}
    </div>
  );
}
