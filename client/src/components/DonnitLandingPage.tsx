import { useCallback, useEffect, useState } from "react";
import "../landing-handoff.css";

/* =========================================================
   Donnit Landing — App
   ========================================================= */

const APP_ROUTE = "#/app";
const DEMO_MAILTO =
  "mailto:hello@donnit.ai?subject=Book%20a%20Donnit%20demo&body=I%20want%20to%20see%20how%20Donnit%20can%20help%20my%20team.";
const CONTACT_MAILTO = "mailto:hello@donnit.ai";

/* ---------- icons ---------- */
const IconCheck = ({ size = 14, stroke = 2.5 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path className="check-path" d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconArrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 7h10m0 0L8 3m4 4L8 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconSend = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 7h9m0 0L7 3m4 4L7 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ---------- reveal hook ---------- */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    // Immediate pass: anything currently in viewport becomes visible right away
    const markVisible = () => {
      els.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight - 40 && r.bottom > 0) {
          el.classList.add('in');
        }
      });
    };
    markVisible();
    // Safety net — guarantee everything reveals after 1.2s no matter what
    const safety = setTimeout(() => {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
    }, 1200);
    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io?.unobserve(e.target);
          }
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
      els.forEach(el => { if (!el.classList.contains('in')) io?.observe(el); });
    }
    return () => {
      clearTimeout(safety);
      if (io) io.disconnect();
    };
  }, []);
}

/* ---------- Header ---------- */
function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    fn();
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);
  return (
    <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
      <div className="inner">
        <a href="#/" className="brand-mark">
          <span className="brand-icon"><IconCheck size={16} stroke={3} /></span>
          <span><span className="word">Donn</span><span className="it">it</span></span>
        </a>
        <nav className="nav-list">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#teams">Teams</a>
          <a href="#pricing">Pricing</a>
          <a href={CONTACT_MAILTO}>Changelog</a>
        </nav>
        <div className="nav-cta">
          <a href={APP_ROUTE} className="btn btn-ghost">Sign in</a>
          <a href={APP_ROUTE} className="btn btn-primary btn-arrow">
            Get Donnit free <IconArrow />
          </a>
        </div>
      </div>
    </header>
  );
}

/* ---------- Live Hero Task List ---------- */
function HeroTaskList() {
  // tasks autoplay-completing themselves to deliver "finishes itself" promise
  type HeroTask = {
    id: number;
    name: string;
    meta: string;
    urg: "high" | "med" | "low";
    tag: string;
    completed?: boolean;
  };
  const initial: HeroTask[] = [
    { id: 1, name: 'Review Q3 budget proposal', meta: 'From Marcus · Due 11:00am', urg: 'high', tag: 'High' },
    { id: 2, name: 'Send client brief — Sarah K.', meta: 'Assigned to Sarah · Due Thu', urg: 'med', tag: 'Med' },
    { id: 3, name: 'Reply to Anna re: pricing memo', meta: 'From inbox · Due today', urg: 'high', tag: 'High' },
    { id: 4, name: 'Confirm offsite venue', meta: 'Awaiting reply · 24h', urg: 'med', tag: 'Med' },
    { id: 5, name: 'Weekly standup prep', meta: 'Done 8:42am', urg: 'low', tag: 'Done', completed: true },
  ];
  const [tasks, setTasks] = useState(initial);
  const [progress, setProgress] = useState(20);

  const completeNext = useCallback(() => {
    setTasks(prev => {
      const idx = prev.findIndex(t => !t.completed);
      if (idx === -1) {
        // reset cycle after a beat
        setTimeout(() => {
          setTasks(initial);
          setProgress(20);
        }, 1800);
        return prev;
      }
      const next = prev.map((t, i) => i === idx ? { ...t, completed: true, tag: 'Done', meta: justNowMeta() } : t);
      const completedCount = next.filter(t => t.completed).length;
      setProgress(Math.round((completedCount / next.length) * 100));
      return next;
    });
  }, []);

  useEffect(() => {
    const t = setInterval(completeNext, 2400);
    return () => clearInterval(t);
  }, [completeNext]);

  const toggleTask = (id: number) => {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, completed: !t.completed, tag: !t.completed ? 'Done' : t.urg === 'high' ? 'High' : t.urg === 'med' ? 'Med' : 'Low' } : t);
      const completedCount = next.filter(t => t.completed).length;
      setProgress(Math.round((completedCount / next.length) * 100));
      return next;
    });
  };

  return (
    <div className="hero-window">
      <div className="window-chrome">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <span className="url">donnit.ai/today</span>
      </div>
      <div className="app-shell">
        <aside className="app-side">
          <div className="side-section">My work</div>
          <div className="side-item active">
            <span>Today</span>
            <span className="badge">{tasks.filter(t => !t.completed).length}</span>
          </div>
          <div className="side-item">This week</div>
          <div className="side-item">Inbox <span className="badge" style={{background:'var(--orange)', color:'#fff'}}>3</span></div>
          <div className="side-item">Waiting on</div>

          <div className="side-section">Team</div>
          <div className="side-item">Operations</div>
          <div className="side-item">Marketing</div>
          <div className="side-item">Manager log</div>
        </aside>
        <main className="app-main">
          <div className="day-header">
            <h3>Today — Tue, May 12</h3>
            <div className="meter">{tasks.filter(t => t.completed).length} of {tasks.length} done</div>
          </div>
          <div className="progress"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>

          <div className="day-divider">Due before noon</div>
          {tasks.slice(0,3).map(t => (
            <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t.id)} />
          ))}
          <div className="day-divider">Later today</div>
          {tasks.slice(3).map(t => (
            <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t.id)} />
          ))}
        </main>
      </div>
    </div>
  );
}

function justNowMeta() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  return `Done ${((h % 12) || 12)}:${m}${ap}`;
}

function TaskRow({ task, onToggle }: { task: { name: string; meta: string; urg: string; tag: string; completed?: boolean }; onToggle: () => void }) {
  const tagClass = task.completed ? 'tag-done' : task.urg === 'high' ? 'tag-high' : task.urg === 'med' ? 'tag-med' : 'tag-low';
  return (
    <div className={`task urg-${task.urg} ${task.completed ? 'completed' : ''}`}>
      <button className={`checkbox ${task.completed ? 'checked' : ''}`} onClick={onToggle} aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}>
        <IconCheck size={12} stroke={3} />
      </button>
      <div className="task-body">
        <span className="task-name">{task.name}</span>
        <span className="task-meta">{task.meta}</span>
      </div>
      <span className={`task-tag ${tagClass}`}>{task.tag}</span>
    </div>
  );
}

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-grid">
          <div className="hero-copy reveal">
            <span className="hero-eyebrow">
              <span className="pulse" />
              Workforce continuity, finally working
            </span>
            <h1 className="hero-headline">
              The to-do list that actually <span className="green">finishes itself.</span>
            </h1>
            <p className="hero-sub">
              Donnit captures every task from chat and email, hands it to the right person, and keeps a complete record of who did what — so when people change roles, go on leave, or move on, the work and the knowledge stay.
            </p>
            <div className="hero-cta">
              <a href={APP_ROUTE} className="btn btn-primary btn-arrow">Start free — no card <IconArrow /></a>
              <a href="#how" className="btn btn-ghost">Watch the 60-second tour →</a>
            </div>
            <div className="hero-meta">
              <span>Free for solo use</span>
              <span className="dot-sep" />
              <span>Slack &amp; Gmail in 2 clicks</span>
              <span className="dot-sep" />
              <span>Secure-by-design pilot</span>
            </div>
          </div>
          <div className="hero-visual reveal reveal-2" style={{ position: 'relative' }}>
            <HeroTaskList />
            <div className="float-card tl">
              <span className="green-dot" />
              <span><strong>Sarah</strong> accepted the brief — due Thu</span>
            </div>
            <div className="float-card br">
              <IconCheck size={14} stroke={3} />
              <span><strong>3 done</strong> in the last hour</span>
            </div>
          </div>
        </div>

        <div className="logo-bar">
          <div className="label">Built for teams who need work to survive handoffs</div>
          <div className="logo-row">
            {['◇ Northwave', '✱ Atlas Labs', '◎ Brightcap', '▲ Field & Co.', '✦ Helio', '◐ Postmark', '☼ Quint'].map(n => (
              <span className="lo" key={n}>{n}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Pain section: Scattered → Donnit ---------- */
const SCRAPS = [
  { src: 'Slack #ops', text: 'hey can you grab the Q3 numbers before the call?', cls: 'slack', from: { x: 4, y: 6, r: -4 } },
  { src: 'Email · Marcus', text: 'Need the deck reviewed by EOD please', cls: 'email', from: { x: 28, y: 0, r: 3 } },
  { src: 'DM · Anna', text: 'reminder: contract renewal June 12, 3 days notice', cls: 'dm', from: { x: 56, y: 8, r: -2 } },
  { src: 'Note to self', text: 'follow up with offsite venue — no reply yet', cls: 'note', from: { x: 80, y: 2, r: 4 } },
  { src: 'Slack #design', text: 'who owns the new onboarding copy?', cls: 'slack', from: { x: 12, y: 56, r: 2 } },
  { src: 'Email · Sarah K.', text: 'attached client brief — review when you can', cls: 'email', from: { x: 38, y: 60, r: -3 } },
  { src: 'DM · CEO', text: 'pls keep me on offsite venue thread', cls: 'dm', from: { x: 64, y: 64, r: 5 } },
];
function Pain() {
  const [mode, setMode] = useState('before'); // before | after
  // auto toggle
  useEffect(() => {
    const t = setInterval(() => setMode(m => m === 'before' ? 'after' : 'before'), 4200);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="block pain">
      <div className="container">
        <div className="block-head reveal">
          <div className="eyebrow">The problem</div>
          <h2>Work shouldn't <span className="green">disappear</span> into mental notes and Slack threads.</h2>
          <p>The average operator juggles 7 inboxes. Tasks arrive everywhere — and only the loud ones get done. Donnit pulls them all into one list, sorted by what actually matters: due date, then urgency.</p>
        </div>

        <div className="pain-toggle-wrap reveal">
          <div className="pain-toggle" role="tablist">
            <button className={mode === 'before' ? 'active' : ''} onClick={() => setMode('before')}>Without Donnit</button>
            <button className={mode === 'after' ? 'active' : ''} onClick={() => setMode('after')}>With Donnit</button>
          </div>
        </div>

        <div className="pain-stage reveal">
          {SCRAPS.map((s, i) => {
            const beforeStyle = {
              left: `${s.from.x}%`,
              top: `${s.from.y}%`,
              transform: `rotate(${s.from.r}deg)`,
              opacity: 1,
            };
            const afterStyle = {
              left: `50%`,
              top: `${20 + i * 32}px`,
              transform: `translateX(-50%) rotate(0deg) scale(0.96)`,
              opacity: i < 4 ? 1 : 0.0,
              maxWidth: 460,
              width: 'min(560px, 92%)',
            };
            return (
              <div
                key={i}
                className={`scrap ${s.cls}`}
                style={mode === 'before' ? beforeStyle : afterStyle}
              >
                <div className="src">{s.src}</div>
                <div>{s.text}</div>
              </div>
            );
          })}
          {mode === 'after' && (
            <div style={{
              position: 'absolute',
              top: 20 + 4 * 32,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '14px 18px',
              background: 'var(--green)',
              color: 'var(--charcoal)',
              borderRadius: 'var(--r-md)',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              animation: 'bubbleIn 240ms var(--ease) both',
            }}>
              <IconCheck size={14} stroke={3} /> 4 tasks captured · sorted · ready
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- Differentiators ---------- */
function Differentiators() {
  return (
    <section className="block" id="product">
      <div className="container">
        <div className="block-head reveal">
          <div className="eyebrow">What makes Donnit different</div>
          <h2>Four things no other task tool does. <span className="green">All of them, together.</span></h2>
          <p>Most task apps win the feature war and lose the usability war. Donnit is opinionated about exactly four things — and ruthless about leaving the rest out.</p>
        </div>

        <div className="diff-grid">
          <div className="diff-card reveal">
            <div className="num">01 — EMAIL TRIAGE</div>
            <h3>Your inbox assigns tasks. Donnit handles them.</h3>
            <p>Donnit reads your inbox, surfaces what's actually a task, and tees it up — accept, decline, or schedule. The other 80% stays in email, where it belongs.</p>
            <div className="diff-visual">
              <EmailTriageDemo />
            </div>
          </div>

          <div className="diff-card reveal reveal-2">
            <div className="num">02 — ACCEPT / DENY</div>
            <h3>Assignment with consent. Accountability without micromanagement.</h3>
            <p>Managers auto-assign; teammates see a request they can accept, decline, or push back on. The handshake creates a clean record — without making anyone the "no" person.</p>
            <div className="diff-visual" style={{ justifyContent: 'center' }}>
              <AcceptDenyDemo />
            </div>
          </div>

          <div className="diff-card reveal reveal-3">
            <div className="num">03 — RADICAL SIMPLICITY</div>
            <h3>One sort. One tap to complete. Zero tutorials.</h3>
            <p>Sort by due date, then urgency. That's the entire mental model. No views to configure, no statuses to design, no swimlanes to maintain. Open it, do the work, close it.</p>
            <div className="diff-visual">
              <SimplicityDemo />
            </div>
          </div>

          <div className="diff-card reveal reveal-4">
            <div className="num">04 — THE MANAGER LOG</div>
            <h3>Finally, a manager view worth looking at.</h3>
            <p>Every completion timestamped. Every assignee. Every note. Pulled into a calm, scannable log — not a dashboard with 40 widgets. Visibility without surveillance.</p>
            <div className="diff-visual">
              <ManagerLogDemo />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmailTriageDemo() {
  const items = [
    { from: 'Marcus L.', subj: 'Need Q3 deck reviewed by EOD', action: 'task', tag: 'High' },
    { from: 'Anna P.', subj: 'Lunch tomorrow?', action: 'skip' },
    { from: 'Stripe', subj: 'Invoice #1042 due in 3 days', action: 'task', tag: 'Med' },
    { from: 'Newsletter', subj: 'This week in design...', action: 'skip' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((e, i) => (
        <div key={i} className={`email-row ${e.action === 'skip' ? 'skipped' : ''}`}>
          <span className="from">{e.from}</span>
          <span className="subj">{e.subj}</span>
          <span className="arrow">{e.action === 'task' ? `→ ${e.tag}` : '— skip'}</span>
        </div>
      ))}
    </div>
  );
}

function AcceptDenyDemo() {
  const [state, setState] = useState('idle'); // idle | accepted | denied
  useEffect(() => {
    if (state !== 'idle') {
      const t = setTimeout(() => setState('idle'), 2200);
      return () => clearTimeout(t);
    }
  }, [state]);
  return (
    <div className="assign-card" style={{ width: '100%', maxWidth: 320 }}>
      <div className="from-line"><strong>Marcus</strong> wants you on this</div>
      <div className="task-line">"Review Q3 budget proposal — due 11:00am"</div>
      {state === 'idle' && (
        <div className="assign-actions">
          <button className="btn-accept" onClick={() => setState('accepted')}>Accept</button>
          <button className="btn-pushback" onClick={() => setState('denied')}>Push back</button>
        </div>
      )}
      {state === 'accepted' && (
        <div style={{ background: 'var(--green-pale)', color: 'var(--green-deeper)', padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconCheck size={12} stroke={3} /> Logged. Marcus will see it on his dashboard.
        </div>
      )}
      {state === 'denied' && (
        <div style={{ background: 'rgba(255,92,53,0.1)', color: '#C63D17', padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600 }}>
          Pushed back. Marcus is asked to suggest a new owner or time.
        </div>
      )}
    </div>
  );
}

function SimplicityDemo() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, width: '100%' }}>
      <div className="simp-stat">
        <div className="num"><span className="green">1</span> sort</div>
        <div className="lbl">vs. Asana's 7</div>
      </div>
      <div className="simp-stat" style={{ flex: 1 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>Avg. clicks to add a task</div>
        <div className="simp-bars">
          <div className="simp-bar" style={{ height: '70%' }}><span className="bar-lbl">Asana</span></div>
          <div className="simp-bar" style={{ height: '90%' }}><span className="bar-lbl">ClickUp</span></div>
          <div className="simp-bar" style={{ height: '55%' }}><span className="bar-lbl">Todoist</span></div>
          <div className="simp-bar us" style={{ height: '15%' }}><span className="bar-lbl">Donnit</span></div>
        </div>
      </div>
    </div>
  );
}

function ManagerLogDemo() {
  const rows = [
    { ts: '08:42', who: 'Sarah K.', what: 'Sent client brief', who2: 'Mar 12 · 2.1k chars' },
    { ts: '09:15', who: 'Devon', what: 'Closed onboarding spec', who2: 'Mar 12 · accepted' },
    { ts: '10:03', who: 'You', what: 'Reviewed Q3 deck', who2: 'Mar 12 · self-assigned' },
    { ts: '11:48', who: 'Anna', what: 'Confirmed venue', who2: 'Mar 12 · vendor reply' },
  ];
  return (
    <div>
      {rows.map((r, i) => (
        <div className="log-row" key={i}>
          <span className="ck"><IconCheck size={9} stroke={3.5} /></span>
          <span className="ts">{r.ts}</span>
          <span className="who">{r.who}</span>
          <span style={{ color: 'var(--charcoal-3)' }}>{r.what}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--charcoal-3)', fontSize: 10 }}>{r.who2}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Chat capture demo ---------- */
function ChatCapture() {
  type ChatDemoMessage =
    | { type: 'user' | 'typing' | 'bot'; text: string }
    | { type: 'task'; name: string; meta: string };
  const messages: ChatDemoMessage[] = [
    { type: 'typing', text: 'Remind me to call Marcus 3 days before his contract renewal on June 12' },
    { type: 'bot', text: 'Got it. Calendar parsed — reminding you Sat, June 9. Want me to draft a heads-up note for Marcus?' },
    { type: 'task', name: 'Call Marcus re: contract renewal', meta: 'Reminder: Sat, June 9 · 9:00am · Personal' },
  ];
  const [shown, setShown] = useState<ChatDemoMessage[]>([]);
  const [typedText, setTypedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
      while (!cancelled) {
        // reset
        setShown([]);
        setTypedText('');
        setIsTyping(true);
        await sleep(700);

        // type out the user message
        const firstMessage = messages[0];
        const full = firstMessage.type === 'typing' || firstMessage.type === 'user' || firstMessage.type === 'bot'
          ? firstMessage.text
          : '';
        for (let i = 1; i <= full.length; i++) {
          if (cancelled) return;
          setTypedText(full.slice(0, i));
          await sleep(28);
        }
        await sleep(400);
        if (cancelled) return;
        setIsTyping(false);
        setShown(s => [...s, { type: 'user', text: full }]);
        setTypedText('');
        await sleep(700);
        setShown(s => [...s, messages[1]]);
        await sleep(900);
        setShown(s => [...s, messages[2]]);
        await sleep(4500);
        setIsTyping(true);
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="block chat-section" id="how">
      <div className="container">
        <div className="chat-grid">
          <div className="reveal">
            <div className="eyebrow">How it works</div>
            <h2 className="display" style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', margin: '14px 0 18px' }}>
              Chat it in.<br />Donnit handles the rest.
            </h2>
            <p style={{ fontSize: 18, color: 'var(--charcoal-3)', margin: '0 0 28px', maxWidth: 480 }}>
              Type how you talk — we parse the dates, urgency, recipients, and follow-ups. No forms, no dropdowns, no learning curve. Works in the app, in Slack, or via SMS.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                ['Natural language dates', '"3 days before" → Saturday, June 9'],
                ['Smart recipients', 'Knows who Marcus is from your org'],
                ['Auto follow-up', 'Drafts the nudge so you don\'t forget'],
              ].map(([h, s]) => (
                <li key={h} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span style={{ width: 22, height: 22, background: 'var(--green)', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                    <IconCheck size={12} stroke={3} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--charcoal)', fontSize: 15 }}>{h}</div>
                    <div style={{ fontSize: 14, color: 'var(--charcoal-3)' }}>{s}</div>
                  </div>
                </li>
              ))}
            </ul>
            <a href={APP_ROUTE} className="btn btn-primary btn-arrow">Try chat capture <IconArrow /></a>
          </div>

          <div className="reveal reveal-2">
            <div className="chat-window">
              <div className="window-chrome">
                <span className="dot" /><span className="dot" /><span className="dot" />
                <span className="url">donnit.ai/chat</span>
              </div>
              <div className="chat-stream">
                {shown.map((m, i) => {
                  if (m.type === 'user') return <div key={i} className="bubble user">{m.text}</div>;
                  if (m.type === 'bot') return <div key={i} className="bubble bot">{m.text}</div>;
                  if (m.type === 'task') return (
                    <div key={i} className="parsed-task">
                      <div className="pt-name">{m.name}</div>
                      <div className="pt-meta">
                        <span>{m.meta}</span>
                        <span className="pill">Reminder set</span>
                      </div>
                    </div>
                  );
                  return null;
                })}
              </div>
              <div className="chat-input">
                <span className="field">
                  {typedText || (isTyping && shown.length === 0 ? '' : '')}
                  {isTyping && <span className="cursor" />}
                  {!isTyping && !typedText && shown.length > 0 && <span style={{ color: 'var(--charcoal-3)' }}>Type a task, reminder, or "give Marcus the..."</span>}
                </span>
                <button className="send"><IconSend /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Continuity ---------- */
function Continuity() {
  return (
    <section className="block continuity" id="continuity">
      <div className="container">
        <div className="block-head reveal">
          <div className="eyebrow">Workforce continuity</div>
          <h2>When people change roles, <span className="green">work doesn't get lost.</span></h2>
          <p>The average company loses 42 days of productivity every time someone leaves a role. Donnit captures the work, the context, and the decisions automatically — so a Tuesday handoff is as clean as a Monday standup.</p>
        </div>

        <div className="cont-grid">
          <div className="cont-points reveal">
            <div className="cont-point">
              <span className="ico"><IconCheck size={16} stroke={3} /></span>
              <div>
                <div className="num-lbl">01 — Auto-capture</div>
                <h4>Every email, chat, and decision becomes a record.</h4>
                <p>Donnit reads the threads your team is already having and turns the operational ones into structured tasks with full context attached. No one has to remember to write it down.</p>
              </div>
            </div>
            <div className="cont-point">
              <span className="ico"><IconCheck size={16} stroke={3} /></span>
              <div>
                <div className="num-lbl">02 — Living handoffs</div>
                <h4>Onboarding and offboarding in one click.</h4>
                <p>Reassign an entire role and Donnit transfers the open tasks, the threads, the vendor contacts, and the historical log — to whoever is taking over. No "tribal knowledge" lost in someone's inbox.</p>
              </div>
            </div>
            <div className="cont-point">
              <span className="ico"><IconCheck size={16} stroke={3} /></span>
              <div>
                <div className="num-lbl">03 — The audit log</div>
                <h4>A complete record. Always. For everyone.</h4>
                <p>Every completion, every accept/deny, every reassignment — timestamped and searchable. Compliance loves it. Managers trust it. New hires can read the last six months of decisions in an afternoon.</p>
              </div>
            </div>
          </div>

          <div className="reveal reveal-2">
            <div className="handoff-card">
              <div className="handoff-head">
                <span className="av">SK</span>
                <div>
                  <div className="who">Sarah Kim</div>
                  <div className="role">Operations · transitioning to Anna P.</div>
                </div>
                <span className="status">Handoff</span>
              </div>

              <div className="handoff-section">Transferring to Anna</div>
              <div className="handoff-row">
                <span className="ico-mini"><IconCheck size={10} stroke={3} /></span>
                <span className="label">14 open tasks across 4 projects</span>
                <span className="count">Q3-OPS</span>
              </div>
              <div className="handoff-row">
                <span className="ico-mini"><IconCheck size={10} stroke={3} /></span>
                <span className="label">Vendor list — 8 contacts &amp; renewal dates</span>
                <span className="count">8</span>
              </div>
              <div className="handoff-row">
                <span className="ico-mini"><IconCheck size={10} stroke={3} /></span>
                <span className="label">Decision log — last 90 days</span>
                <span className="count">126</span>
              </div>
              <div className="handoff-row">
                <span className="ico-mini"><IconCheck size={10} stroke={3} /></span>
                <span className="label">Email threads tagged "ops"</span>
                <span className="count">47</span>
              </div>

              <div className="handoff-cta">Confirm handoff to Anna →</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Personas ---------- */
function Personas() {
  const ps = [
    {
      ini: 'JL', a: 'avatar-1',
      who: 'Jordan, 34',
      role: 'Operations Manager · 40-person team',
      quote: '"I need to know what my team is actually working on — and I need tasks to stop disappearing into Slack threads."',
      needs: ['Manager log', 'Auto-assign', 'Slack integration', 'Urgency visibility'],
    },
    {
      ini: 'SK', a: 'avatar-2',
      who: 'Sam, 29',
      role: 'Senior Developer · IC contributor',
      quote: '"I want to add tasks by typing, not clicking through 5 dropdowns. And I want my emails to stop creating invisible work."',
      needs: ['Chat input', 'Email scanning', 'Fast UI', 'Accept / deny'],
    },
    {
      ini: 'RH', a: 'avatar-3',
      who: 'Rachel, 41',
      role: 'Founder · Solo + 3 contractors',
      quote: '"I\'m managing work and my personal life from the same brain. I need one tool for all of it."',
      needs: ['Annual reminders', 'Daily agenda', 'Personal + work', 'Simple log'],
    },
  ];
  return (
    <section className="block" id="teams" style={{ background: '#fff', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div className="container">
        <div className="block-head reveal">
          <div className="eyebrow">Built for three jobs, not one</div>
          <h2>One tool that <span className="green">works on Sunday night</span>, Monday morning, and the team standup at 11.</h2>
          <p>If a design works for Rachel on a Sunday night, it works for everyone during the work week. We test against three real users — not personas on a slide.</p>
        </div>
        <div className="persona-grid">
          {ps.map((p, i) => (
            <div className={`persona-card reveal reveal-${i+1}`} key={p.who}>
              <div className="persona-head">
                <div className={`persona-avatar ${p.a}`}>{p.ini}</div>
                <div>
                  <div className="who">{p.who}</div>
                  <div className="role">{p.role}</div>
                </div>
              </div>
              <p className="persona-quote">{p.quote}</p>
              <div className="persona-needs">
                {p.needs.map(n => <span className="need-pill" key={n}>{n}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Stats ---------- */
function Stats() {
  return (
    <section className="stats-bar">
      <div className="container">
        <div className="stats-grid">
          {[
            { num: '1', small: '', lbl: 'Place for tasks, context, and handoffs' },
            { num: '4', small: '', lbl: 'Sources already supported for task intake' },
            { num: '3.2', small: 's', lbl: 'Target time to capture a quick task' },
            { num: '100', small: '%', lbl: 'Focused on preserving role knowledge' },
          ].map((s, i) => (
            <div className="stat-item reveal" key={i} style={{ transitionDelay: `${i*60}ms` }}>
              <div className="stat-num">{s.num}<span className="small">{s.small}</span></div>
              <div className="stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing ---------- */
function Pricing() {
  return (
    <section className="block" id="pricing">
      <div className="container">
        <div className="block-head center reveal">
          <div className="eyebrow" style={{textAlign:'center'}}>Pricing</div>
          <h2>Free for solo. <span className="green">Fair</span> for teams.</h2>
          <p>No per-feature paywalls. No "contact sales" for the basics. The chat input, email scan, and manager log work on every plan.</p>
        </div>
        <div className="price-grid">
          <div className="price-card reveal">
            <div className="price-name">Solo</div>
            <div className="price-desc">For Rachel, running her own thing.</div>
            <div className="price-amount"><span className="currency">$</span>0</div>
            <div className="price-period">free forever · 1 user</div>
            <ul className="price-features">
              <li>Chat &amp; email capture</li>
              <li>Personal log + reminders</li>
              <li>Slack &amp; Gmail connect</li>
              <li>Up to 1,000 tasks / month</li>
            </ul>
            <div className="price-cta">
              <a href={APP_ROUTE} className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }}>Start free</a>
            </div>
          </div>

          <div className="price-card featured reveal reveal-2">
            <span className="price-tag">Most teams</span>
            <div className="price-name">Team</div>
            <div className="price-desc">For Sam, Jordan, and the eight people in between.</div>
            <div className="price-amount"><span className="currency">$</span>9<span style={{fontSize: 22, fontWeight: 600, color:'rgba(247,245,240,0.6)', marginLeft:4}}>/seat</span></div>
            <div className="price-period">billed monthly · cancel anytime</div>
            <ul className="price-features">
              <li>Everything in Solo</li>
              <li>Accept / deny assignment flow</li>
              <li>Manager log &amp; team rollups</li>
              <li>Org-wide Slack &amp; calendar sync</li>
              <li>Unlimited tasks</li>
            </ul>
            <div className="price-cta">
              <a href={APP_ROUTE} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Start 14-day trial</a>
            </div>
          </div>

          <div className="price-card reveal reveal-3">
            <div className="price-name">Enterprise</div>
            <div className="price-desc">For Jordan's COO, who has questions.</div>
            <div className="price-amount" style={{fontSize: 38}}>Let's talk</div>
            <div className="price-period">SSO · audit · custom retention</div>
            <ul className="price-features">
              <li>Everything in Team</li>
              <li>SAML SSO &amp; SCIM provisioning</li>
              <li>Audit log export &amp; retention</li>
              <li>Dedicated success manager</li>
              <li>Security review package planned</li>
            </ul>
            <div className="price-cta">
              <a href={DEMO_MAILTO} className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }}>Book a call</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Final CTA ---------- */
function FinalCTA() {
  return (
    <section className="final-cta">
      <div className="container">
        <h2 className="reveal">Done.<br />Logged. Continuous.</h2>
        <p className="reveal reveal-2">Stop losing work to inboxes, transitions, and tribal knowledge. Donnit keeps the tasks moving and the record intact — free for solo, set up in under two minutes.</p>
        <div className="reveal reveal-3" style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href={APP_ROUTE} className="btn btn-primary btn-arrow">Get Donnit free <IconArrow /></a>
          <a href={DEMO_MAILTO} className="btn btn-outline" style={{ borderColor: 'var(--charcoal)' }}>Book a 15-min demo</a>
        </div>
        <div className="meta reveal reveal-4">No credit card · Free for solo · Slack &amp; Gmail in 2 clicks</div>

        <div className="final-stage reveal reveal-4">
          {[12, 28, 44, 60, 76].map((left, i) => (
            <div key={i} className="final-check" style={{
              left: `${left}%`,
              top: i % 2 === 0 ? 0 : 40,
              animationDelay: `${i * 0.6}s`,
            }}>
              <IconCheck size={14} stroke={3} />
            </div>
          ))}
          <style>{`
            @keyframes floatCheck {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-12px); }
            }
          `}</style>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="site">
      <div className="container">
        <div className="footer-grid">
          <div className="brand-col col">
            <a href="#/" className="brand-mark">
              <span className="brand-icon"><IconCheck size={16} stroke={3} /></span>
              <span><span className="word">Donn</span><span className="it">it</span></span>
            </a>
            <p>The workforce-continuity OS. Every task, decision, and handoff captured — so when people change roles or move on, nothing is lost.</p>
          </div>
          <div className="col">
            <h4>Product</h4>
            <a href="#product">Features</a>
            <a href="#product">Email triage</a>
            <a href="#product">Manager log</a>
            <a href="#how">Integrations</a>
            <a href={CONTACT_MAILTO}>Changelog</a>
          </div>
          <div className="col">
            <h4>Use cases</h4>
            <a href="#teams">For founders</a>
            <a href="#teams">For ops teams</a>
            <a href="#teams">For ICs</a>
            <a href="#pricing">Personal</a>
          </div>
          <div className="col">
            <h4>Company</h4>
            <a href={CONTACT_MAILTO}>About</a>
            <a href={DEMO_MAILTO}>Customers</a>
            <a href={CONTACT_MAILTO}>Careers</a>
            <a href={CONTACT_MAILTO}>Press</a>
          </div>
          <div className="col">
            <h4>Resources</h4>
            <a href={CONTACT_MAILTO}>Docs</a>
            <a href={CONTACT_MAILTO}>Community</a>
            <a href={CONTACT_MAILTO}>Security</a>
            <a href={CONTACT_MAILTO}>Brand</a>
          </div>
        </div>
        <div className="legal">
          <span className="smol">© 2026 Donnit, Inc. · donnit.ai</span>
          <span style={{ display: 'flex', gap: 18 }}>
            <a href={CONTACT_MAILTO}>Privacy</a>
            <a href={CONTACT_MAILTO}>Terms</a>
            <a href={CONTACT_MAILTO}>DPA</a>
            <a href={CONTACT_MAILTO}>Status: <span style={{ color: 'var(--green)' }}>● operational</span></a>
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ---------- App ---------- */
export default function DonnitLandingPage() {
  useReveal();
  return (
    <div className="donnit-landing-handoff">
      <Header />
      <Hero />
      <Pain />
      <Differentiators />
      <Continuity />
      <ChatCapture />
      <Personas />
      <Stats />
      <Pricing />
      <FinalCTA />
      <Footer />
    </div>
  );
}
