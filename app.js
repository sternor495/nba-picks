(() => {
'use strict';
const TEAMS = window.TEAMS, PLAYERS = window.PLAYERS;
const LOCK = window.LOCK_AT, SEASON = window.SEASON;
const teamBy = Object.fromEntries(TEAMS.map(t => [t.a, t]));
const playerBy = Object.fromEntries(PLAYERS.map(p => [p.id, p]));
const $app = document.getElementById('app');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const logo = a => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/${a.toLowerCase()}.png&w=80&h=80`;
const head = id => `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const randId = n => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(n)); for (const x of r) s += a[x % a.length]; return s; };
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = name => `<span class="av" style="background:hsl(${hue(name)} 55% 45%)">${esc((name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
const isLocked = () => Date.now() >= LOCK;
const fmt = n => (Math.round(n * 10) / 10).toLocaleString('en-US');
const ord = n => n + (['th','st','nd','rd'][(n % 100 - 20) % 10] || ['th','st','nd','rd'][n % 100] || 'th');
const confTeams = c => TEAMS.filter(t => t.c === c);
const CONF = { east: { key: 'E', name: 'East' }, west: { key: 'W', name: 'West' } };

/* ---------- scoring (the rules, in code) ---------- */
const placeValue = p => 100 - 5 * (p - 1);                       // 1st 100 … 10th 55
function placeScore(slot, actual) {
  if (!actual || actual > 10) return 0;                           // missed the top 10
  if (actual === slot) return placeValue(slot);                   // exact: full value
  return Math.max(0, placeValue(actual) / 2 - 2 * Math.abs(actual - slot));
}
function winsScore(guess, actual) {
  if (actual == null) return 0;
  if (guess === actual) return actual;                            // exact: the win total itself
  return Math.max(0, 10 - 4 * Math.floor(Math.abs(guess - actual) / 10));
}
function statScore(guess, avg) {
  if (avg == null) return 0;
  const a = Math.round(avg);
  if (guess === a) return a;                                      // exact: the number itself
  return Math.max(0, 10 - Math.abs(guess - a));
}
function scoreEntry(e, live) {
  const r = { east: [], west: [], players: [], place: 0, wins: 0, stats: 0, total: 0, eastPlace: 0, westPlace: 0 };
  for (const conf of ['east', 'west']) {
    e[conf].forEach((pick, i) => {
      const act = live?.teams?.[pick.a];
      const ps = live ? placeScore(i + 1, act?.place) : 0;
      const ws = live && act ? winsScore(pick.w, act.projW) : 0;
      r[conf].push({ ...pick, slot: i + 1, place: act?.place, projW: act?.projW, ps, ws });
      r.place += ps; r.wins += ws; r[conf + 'Place'] += ps;
    });
  }
  for (const p of e.players) {
    const a = live?.players?.[p.id];
    const s = { pts: statScore(p.pts, a?.pts), reb: statScore(p.reb, a?.reb), ast: statScore(p.ast, a?.ast) };
    const sum = s.pts + s.reb + s.ast;
    r.players.push({ ...p, act: a, s, sum });
    r.stats += sum;
  }
  r.total = r.place + r.wins + r.stats;
  return r;
}

/* ---------- live NBA data (ESPN public feeds) ---------- */
let liveCache = null;
async function getLive(force) {
  if (liveCache && !force && Date.now() - liveCache.at < 5 * 60e3) return liveCache;
  const [st, pl] = await Promise.all([
    fetch(`https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${SEASON}&seasontype=2`).then(r => r.json()),
    fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=1000&sort=offensive.avgPoints%3Adesc&season=${SEASON}&seasontype=2`).then(r => r.json()).catch(() => ({ athletes: [] })),
  ]);
  const teams = {}; let games = 0, allDone = true;
  for (const c of st.children || []) {
    for (const en of c.standings.entries) {
      const s = Object.fromEntries(en.stats.map(x => [x.name, x.value]));
      const w = s.wins | 0, l = s.losses | 0, gp = w + l;
      games += gp; if (gp < 82) allDone = false;
      teams[en.team.abbreviation] = { place: s.playoffSeed | 0, w, l, gp, projW: gp ? (gp >= 82 ? w : Math.round(w / gp * 82)) : null };
    }
  }
  const players = {};
  for (const a of pl.athletes || []) {
    const c = Object.fromEntries(a.categories.map(x => [x.name, x.totals]));
    const gp = +c.general?.[0] || 0;
    if (gp > 0) players[a.athlete.id] = { gp, pts: +c.offensive[0], reb: +c.general[11], ast: +c.offensive[10] };
  }
  liveCache = { at: Date.now(), teams, players, started: games > 0, final: games > 0 && allDone };
  return liveCache;
}

/* ---------- backends ---------- */
function localApi() {
  const KEY = 'ho-localdb';
  const load = () => store.get(KEY, { groups: {} });
  const save = db => store.set(KEY, db);
  let uid = store.get('ho-uid'); if (!uid) { uid = randId(12); store.set('ho-uid', uid); }
  const listeners = new Set();
  const ping = () => listeners.forEach(f => f());
  return {
    mode: 'local', uid,
    async createGroup(name, myName) {
      const db = load(), id = randId(8);
      db.groups[id] = { name, owner: uid, createdAt: Date.now(), members: { [uid]: { name: myName, done: false, joinedAt: Date.now() } }, entries: {} };
      save(db); return id;
    },
    async getGroup(id) { const g = load().groups[id]; return g ? { id, name: g.name, owner: g.owner } : null; },
    async join(id, name) { const db = load(); const m = db.groups[id].members; m[uid] = { ...(m[uid] || { done: false, joinedAt: Date.now() }), name }; save(db); ping(); },
    watchMembers(id, cb) {
      const f = () => { const g = load().groups[id]; cb(Object.entries(g?.members || {}).map(([u, m]) => ({ uid: u, ...m }))); };
      listeners.add(f); f(); return () => listeners.delete(f);
    },
    async getEntry(id) { return load().groups[id]?.entries[uid] || null; },
    async saveEntry(id, entry) { if (isLocked()) throw new Error('locked'); const db = load(); const g = db.groups[id]; g.entries[uid] = entry; g.members[uid] = { ...g.members[uid], name: entry.name, done: true }; save(db); ping(); },
    async entries(id) { const g = load().groups[id]; return Object.entries(g?.entries || {}).filter(([u]) => isLocked() || u === uid).map(([u, e]) => ({ uid: u, ...e })); },
  };
}

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }

async function firebaseApi(cfg) {
  const v = '10.12.2';
  await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
  await Promise.all([loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js`), loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore-compat.js`)]);
  firebase.initializeApp(cfg);
  const auth = firebase.auth(), db = firebase.firestore();
  const user = auth.currentUser || await new Promise((res, rej) => {
    const off = auth.onAuthStateChanged(u => { if (u) { off(); res(u); } });
    auth.signInAnonymously().catch(rej);
  });
  const uid = user.uid;
  const G = id => db.collection('groups').doc(id);
  const now = firebase.firestore.FieldValue.serverTimestamp;
  return {
    mode: 'cloud', uid,
    async createGroup(name, myName) {
      const id = randId(8);
      await G(id).set({ name, owner: uid, createdAt: now() });
      await G(id).collection('members').doc(uid).set({ name: myName, done: false, joinedAt: now() });
      return id;
    },
    async getGroup(id) { const s = await G(id).get(); return s.exists ? { id, ...s.data() } : null; },
    async join(id, name) {
      const ref = G(id).collection('members').doc(uid);
      const s = await ref.get();
      await ref.set(s.exists ? { name } : { name, done: false, joinedAt: now() }, { merge: true });
    },
    watchMembers(id, cb) {
      return G(id).collection('members').onSnapshot(q => cb(q.docs.map(d => ({ uid: d.id, ...d.data(), joinedAt: d.data().joinedAt?.toMillis?.() || 0 }))), e => console.error(e));
    },
    async getEntry(id) { const s = await G(id).collection('entries').doc(uid).get(); return s.exists ? s.data() : null; },
    async saveEntry(id, entry) {
      await G(id).collection('entries').doc(uid).set({ ...entry, savedAt: now() });
      await G(id).collection('members').doc(uid).set({ name: entry.name, done: true }, { merge: true });
    },
    async entries(id) {
      if (!isLocked()) { const e = await this.getEntry(id); return e ? [{ uid, ...e }] : []; }
      const q = await G(id).collection('entries').get();
      return q.docs.map(d => ({ uid: d.id, ...d.data() }));
    },
  };
}

/* ---------- state ---------- */
let api = null;
const S = {
  view: 'loading',        // loading | home | join | group | pick | missing | error
  gid: null, group: null, members: [], entry: null,
  tab: 'squad', step: 0, draft: null,
  pq: '', ppos: 'All', openUid: null,
  lb: null, lbErr: null, err: '', busy: false,
};
let unsubMembers = null;

const myGroups = () => store.get('ho-groups', []);
function rememberGroup(id, name) { const g = myGroups().filter(x => x.id !== id); g.unshift({ id, name }); store.set('ho-groups', g.slice(0, 12)); }
const draftKey = () => `ho-draft-${S.gid}`;
function saveDraft() { store.set(draftKey(), S.draft); }
const me = () => S.members.find(m => m.uid === api.uid);
const inviteUrl = () => `${location.origin}${location.pathname}?g=${S.gid}`;

/* ---------- small UI bits ---------- */
const BALL = `<svg class="ball" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="var(--hot)"/><path d="M2 32h60M32 2v60M12 10c12 10 12 34 0 44M52 10c-12 10-12 34 0 44" stroke="var(--court)" stroke-width="3.5" fill="none"/></svg>`;
const COURT = `<svg class="court" viewBox="0 0 500 470" fill="none" stroke="currentColor" stroke-width="4" aria-hidden="true"><rect x="10" y="10" width="480" height="450"/><rect x="170" y="10" width="160" height="190"/><circle cx="250" cy="200" r="60"/><path d="M40 10v140a210 210 0 0 0 420 0V10"/><circle cx="250" cy="52" r="8"/><path d="M220 40h60"/><path d="M190 460a60 60 0 0 1 120 0"/></svg>`;

function countdown(compact) {
  let ms = LOCK - Date.now();
  if (ms <= 0) return `<span class="pill">🔒 Season live</span>`;
  const d = Math.floor(ms / 864e5); ms -= d * 864e5;
  const h = Math.floor(ms / 36e5); ms -= h * 36e5;
  const m = Math.floor(ms / 6e4); const s = Math.floor((ms - m * 6e4) / 1e3);
  if (compact) return `<span class="pill num" data-clock="1">⏱ Locks in ${d}d ${h}h</span>`;
  return `<div class="clock num" data-clock="0">${[[d,'days'],[h,'hrs'],[m,'min'],[s,'sec']].map(([v,l]) => `<div><b>${String(v).padStart(2,'0')}</b><small>${l}</small></div>`).join('')}</div>`;
}
setInterval(() => {
  document.querySelectorAll('[data-clock]').forEach(el => { el.outerHTML = countdown(el.dataset.clock === '1'); });
}, 1000);

function topbar() {
  return `<header class="top"><div class="in">
    <button class="brand" data-act="home" aria-label="Hoops Oracle home">${BALL}Hoops Oracle</button>
    <span class="sp"></span>${S.view === 'home' ? '' : countdown(true)}
  </div></header>${api?.mode === 'local' ? `<div class="demo">Demo mode: picks are saved in this browser only. Group links start working for friends once the shared database is connected.</div>` : ''}`;
}

let toastT;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.role = 'status'; t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2600);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('confetti'); c.hidden = false;
  const x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#e8661f', '#13213a', '#f5b041', '#3b6fd8', '#ffffff'];
  const bits = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, r: 4 + Math.random() * 6, vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4, a: Math.random() * 6, col: cols[Math.random() * cols.length | 0], ball: Math.random() < .12 }));
  let f = 0;
  (function tick() {
    x.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.y += b.vy; b.x += b.vx; b.a += .1;
      x.save(); x.translate(b.x, b.y); x.rotate(b.a);
      if (b.ball) { x.fillStyle = '#e8661f'; x.beginPath(); x.arc(0, 0, b.r + 4, 0, 7); x.fill(); x.strokeStyle = '#13213a'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-b.r - 4, 0); x.lineTo(b.r + 4, 0); x.stroke(); }
      else { x.fillStyle = b.col; x.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); }
      x.restore();
    }
    if (++f < 190) requestAnimationFrame(tick); else { x.clearRect(0, 0, c.width, c.height); c.hidden = true; }
  })();
}

/* ---------- rules ---------- */
function rulesHtml() {
  const ladder = Array.from({ length: 10 }, (_, i) => `<div><b class="num">${placeValue(i + 1)}</b><small>${ord(i + 1)}</small></div>`).join('');
  return `<section class="card stack rules" id="rules">
    <div><p class="eyebrow">How it works</p><h2>The rules</h2></div>
    <p>Before the season tips off, everyone in your group makes three calls. When the regular season ends, the closest prophet wins.</p>

    <h3>1 · Conference standings</h3>
    <p>Rank the top 10 teams in the East and the West. Each place is worth points:</p>
    <div class="ladder">${ladder}</div>
    <ul>
      <li><b>Exact place:</b> you get that place's full value.</li>
      <li><b>Wrong place, but they finish top 10:</b> half the value of the place they actually finished, minus 2 points for every place you were off.</li>
      <li><b>They miss the top 10:</b> 0 points.</li>
    </ul>
    <p class="ex">You pick a team 1st and they finish 4th. 4th is worth 85, half is 42.5, minus 3 places × 2 = <b>36.5 points</b>.</p>

    <h3>2 · Win totals</h3>
    <p>For each of your 20 teams, predict their regular-season wins (out of 82).</p>
    <ul>
      <li><b>Exact:</b> you score the win total itself. Nail a 57-win season and bank 57.</li>
      <li><b>Off by 1–9:</b> 10 points.</li>
      <li><b>Off by 10–19:</b> 6 points.</li>
      <li><b>Off by 20–29:</b> 2 points.</li>
      <li><b>Off by 30+:</b> 0.</li>
    </ul>
    <p class="ex">A team wins 43. You said 42 → <b>10</b>. 32 → <b>6</b>. 22 → <b>2</b>. 12 → <b>0</b>. 54 → <b>6</b>.</p>

    <h3>3 · Your starting five</h3>
    <p>Pick any 5 players and predict each one's season averages for points, rebounds and assists, in whole numbers. Real averages are rounded to the nearest whole number.</p>
    <ul>
      <li><b>Exact:</b> you score the number itself. Call 27 points a game and he averages 27 → 27 points.</li>
      <li><b>Otherwise:</b> 10 points minus 1 for every point you're off (never below 0).</li>
    </ul>
    <p class="ex">He averages 22 and you said 20 → <b>8 points</b>. You said 9 assists and he averages 6 → <b>7</b>.</p>

    <h3>Try it</h3>
    <div class="calc">
      <div><label class="lbl" for="cw-g">Your wins pick</label><input class="txt num" id="cw-g" type="number" inputmode="numeric" value="42" min="0" max="82"></div>
      <div><label class="lbl" for="cw-a">Actual wins</label><input class="txt num" id="cw-a" type="number" inputmode="numeric" value="43" min="0" max="82"></div>
      <div><label class="lbl" for="cp-g">You ranked them</label><input class="txt num" id="cp-g" type="number" inputmode="numeric" value="1" min="1" max="10"></div>
      <div><label class="lbl" for="cp-a">They finished</label><input class="txt num" id="cp-a" type="number" inputmode="numeric" value="4" min="1" max="15"></div>
    </div>
    <p class="note good" id="calc-out"></p>

    <h3>The fine print</h3>
    <ul>
      <li>Picks lock at the opening tip: <b>Tuesday, Oct 20, 2026, 7:00 PM ET</b>. Edit as much as you like until then.</li>
      <li>Everyone's picks stay secret until lock. Then they're revealed to the group.</li>
      <li>The leaderboard updates live during the season from ESPN data, as if the season ended today. Win totals are projected to an 82-game pace until the season is over.</li>
      <li>Final standings are the regular-season seeds, before the play-in.</li>
      <li>A player who never plays a game scores 0.</li>
    </ul>
  </section>`;
}
function calcUpdate() {
  const v = id => parseInt(document.getElementById(id)?.value, 10);
  const out = document.getElementById('calc-out'); if (!out) return;
  const wg = v('cw-g'), wa = v('cw-a'), pg = v('cp-g'), pa = v('cp-a');
  const w = isNaN(wg) || isNaN(wa) ? '–' : fmt(winsScore(wg, wa));
  const p = isNaN(pg) || isNaN(pa) || pg < 1 || pg > 10 ? '–' : fmt(placeScore(pg, pa));
  out.innerHTML = `Win total: <b>${w} pts</b> · Standings: <b>${p} pts</b>`;
}

/* ---------- views ---------- */
function viewHome() {
  const gs = myGroups();
  return `${topbar()}
  <section class="hero"><div class="in">${COURT}
    <p class="eyebrow">2026-27 NBA season</p>
    <h1>Call the<br><span>whole season.</span></h1>
    <p>Rank the top 10 in each conference, predict every team's win total, and draft a starting five with stat lines. Your friends do the same. Closest to the truth in April takes the crown.</p>
    <p class="small" style="opacity:.75">Picks lock at the opening tip in</p>
    ${countdown(false)}
  </div></section>
  <main class="wrap stack" style="margin-top:20px">
    ${gs.length ? `<section class="card stack"><h3>Your groups</h3><div class="stack" style="gap:8px">${gs.map(g => `<a class="btn" style="justify-content:space-between" href="?g=${esc(g.id)}">${esc(g.name)} <span aria-hidden="true">→</span></a>`).join('')}</div></section>` : ''}
    <section class="card stack">
      <div><p class="eyebrow">Start a league</p><h2>Create a group</h2></div>
      <p class="muted">You'll get a link to send your friends. No accounts, no passwords. Whoever has the link can join.</p>
      <form id="create" class="stack" autocomplete="off">
        <div><label class="lbl" for="gname">Group name</label><input class="txt" id="gname" maxlength="40" placeholder="Sunday Hoopers" required></div>
        <div><label class="lbl" for="myname">Your name</label><input class="txt" id="myname" maxlength="30" placeholder="Oren" required></div>
        ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
        <button class="btn hot big" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Creating…' : 'Create group'}</button>
      </form>
    </section>
    ${rulesHtml()}
  </main>`;
}

function viewJoin() {
  const locked = isLocked();
  return `${topbar()}
  <section class="hero"><div class="in">${COURT}
    <p class="eyebrow">You're invited</p>
    <h1>${esc(S.group.name)}</h1>
    <p>${S.members.length} ${S.members.length === 1 ? 'prophet has' : 'prophets have'} joined so far${S.members.length ? ': ' + S.members.slice(0, 6).map(m => esc(m.name)).join(', ') + (S.members.length > 6 ? '…' : '') : ''}.</p>
    ${countdown(false)}
  </div></section>
  <main class="wrap stack" style="margin-top:20px">
    ${locked ? `<section class="card stack"><h3>Picks are locked</h3><p>The season has tipped off, so new picks can't be added. You can still watch the leaderboard.</p><button class="btn hot" data-act="spectate">See the leaderboard</button></section>` :
    `<section class="card stack">
      <h2>Join the group</h2>
      <form id="join" class="stack" autocomplete="off">
        <div><label class="lbl" for="jname">What should we call you?</label><input class="txt" id="jname" maxlength="30" placeholder="Your name" required></div>
        ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
        <button class="btn hot big" ${S.busy ? 'disabled' : ''}>Join & make my picks</button>
      </form>
    </section>`}
    ${rulesHtml()}
  </main>`;
}

function viewGroup() {
  const tabs = [['squad', 'Squad'], ['mine', 'My picks'], ['board', 'Leaderboard'], ['rules', 'Rules']];
  let body = '';
  if (S.tab === 'squad') body = tabSquad();
  else if (S.tab === 'mine') body = tabMine();
  else if (S.tab === 'board') body = tabBoard();
  else body = rulesHtml();
  const done = S.members.filter(m => m.done).length;
  return `${topbar()}
  <section class="hero"><div class="in" style="padding-block:24px 22px;gap:10px">${COURT}
    <p class="eyebrow">Group · ${S.members.length} ${S.members.length === 1 ? 'player' : 'players'} · ${done} locked in</p>
    <h1 style="font-size:clamp(38px,9vw,64px)">${esc(S.group.name)}</h1>
    <div class="wrap-row"><button class="btn hot" data-act="invite">Invite friends</button>${!isLocked() && me() ? `<button class="btn" data-act="pick">${me()?.done ? 'Edit my picks' : 'Make my picks'}</button>` : ''}</div>
  </div></section>
  <main class="wrap stack" style="margin-top:16px">
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</nav>
    ${body}
  </main>`;
}

function tabSquad() {
  const ms = [...S.members].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const meM = me();
  return `
  ${meM && !meM.done && !isLocked() ? `<section class="card stack" style="border-color:var(--hot)"><h3>Your picks aren't in yet</h3><p class="muted">It takes about 5 minutes. You can change them until tip-off.</p><button class="btn hot big" data-act="pick">Make my picks</button></section>` : ''}
  <section class="card stack">
    <div class="row"><h3 class="grow">Invite link</h3></div>
    <p class="muted small">Anyone with this link can join. Send it in the group chat.</p>
    <div class="row" style="flex-wrap:wrap"><input class="txt grow small" id="invite-url" readonly value="${esc(inviteUrl())}" aria-label="Invite link" style="min-width:200px"><button class="btn hot" data-act="invite">Copy / share</button></div>
  </section>
  <section class="card">
    <h3 style="margin-bottom:6px">The prophets</h3>
    ${ms.map(m => `<div class="mem">${avatar(m.name)}<div class="grow"><b>${esc(m.name)}</b>${m.uid === S.group.owner ? ' <span class="muted small">· commissioner</span>' : ''}${m.uid === api.uid ? ' <span class="muted small">· you</span>' : ''}</div>${m.done ? '<span class="badge ok">Picks in ✓</span>' : '<span class="badge wait">Thinking…</span>'}</div>`).join('') || '<p class="muted">No one yet.</p>'}
  </section>
  ${!isLocked() ? `<p class="muted small center">Picks are revealed to everyone at tip-off. ${countdown(true)}</p>` : ''}`;
}

function tabMine() {
  if (!S.entry) {
    if (isLocked()) return `<section class="card"><p>You didn't make picks in this group before the season started.</p></section>`;
    return `<section class="card stack center"><h3>No picks yet</h3><p class="muted">East, West, then your starting five.</p><button class="btn hot big" data-act="pick">Start picking</button></section>`;
  }
  const live = S.lb?.live || null;
  const sc = live?.started ? scoreEntry(S.entry, live) : null;
  return `${!isLocked() ? `<div class="row"><p class="grow muted small">Saved. You can change these until tip-off.</p><button class="btn" data-act="pick">Edit picks</button></div>` : ''}
  ${picksTables(S.entry, sc)}`;
}

function picksTables(e, sc) {
  const conf = c => {
    const rows = sc ? sc[c] : e[c].map((p, i) => ({ ...p, slot: i + 1 }));
    return `<div class="tbl"><table><thead><tr><th>#</th><th>${CONF[c].name}</th><th>Wins</th>${sc ? '<th>Now</th><th>Proj W</th><th style="text-align:right">Pts</th>' : ''}</tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.slot}</td><td><span class="row" style="gap:8px"><img class="logo" style="width:22px;height:22px" src="${logo(r.a)}" alt="">${esc(teamBy[r.a]?.s || r.a)}</span></td><td>${r.w}</td>${sc ? `<td class="${r.place === r.slot ? 'hit' : ''}">${r.place ? ord(r.place) : '–'}</td><td class="${r.projW === r.w ? 'hit' : ''}">${r.projW ?? '–'}</td><td class="pts">${fmt(r.ps + r.ws)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
  };
  const prow = sc ? sc.players : e.players;
  return `<section class="stack">
    <h3>East</h3>${conf('east')}
    <h3>West</h3>${conf('west')}
    <h3>Starting five</h3>
    <div class="tbl"><table><thead><tr><th>Player</th><th>PTS</th><th>REB</th><th>AST</th>${sc ? '<th style="text-align:right">Pts</th>' : ''}</tr></thead><tbody>
    ${prow.map(p => { const pl = playerBy[p.id]; const a = p.act; const cell = (k) => `${p[k]}${sc ? ` <span class="muted small">/ ${a ? fmt(a[k]) : '–'}</span>` : ''}`;
      return `<tr><td><span class="row" style="gap:8px"><img src="${head(p.id)}" alt="" style="width:34px;height:25px;object-fit:cover;object-position:top;border-radius:4px">${esc(pl?.n || p.name || p.id)}</span></td><td>${cell('pts')}</td><td>${cell('reb')}</td><td>${cell('ast')}</td>${sc ? `<td class="pts">${fmt(p.sum)}</td>` : ''}</tr>`; }).join('')}
    </tbody></table></div>
    ${sc ? `<p class="muted small">Your number / current average. Total: <b>${fmt(sc.total)}</b> points.</p>` : ''}
  </section>`;
}

function tabBoard() {
  if (!isLocked()) {
    const done = S.members.filter(m => m.done).length;
    return `<section class="card stack center">
      <h3>Sealed until tip-off</h3>
      <p class="muted">${done} of ${S.members.length} have their picks in. Everyone's picks and the live leaderboard appear when the season starts.</p>
      ${countdown(false).replace('class="clock', 'style="justify-content:center" class="clock')}
    </section>`;
  }
  if (S.lbErr) return `<section class="card stack"><p class="err">${esc(S.lbErr)}</p><button class="btn" data-act="reload-lb">Try again</button></section>`;
  if (!S.lb) { loadBoard(); return `<section class="card center muted">Loading the scores…</section>`; }
  const { live, rows } = S.lb;
  if (!rows.length) return `<section class="card">No one made picks in this group.</section>`;
  const max = Math.max(1, ...rows.map(r => r.sc.total));
  let rank = 0, prev = null;
  return `<p class="muted small">${live.final ? 'Final results.' : live.started ? 'Live: if the season ended today. Updated from ESPN.' : 'The season has not started yet, so everyone is at 0.'}</p>
  <div class="legend"><span><i class="c1"></i>East places</span><span><i class="c2"></i>West places</span><span><i class="c3"></i>Win totals</span><span><i class="c4"></i>Starting five</span></div>
  <div class="lb">${rows.map((r, i) => {
      if (r.sc.total !== prev) { rank = i + 1; prev = r.sc.total; }
      const w = v => (v / max * 100).toFixed(2) + '%';
      const open = S.openUid === r.uid;
      return `<button class="lbrow ${rank === 1 && live.started ? 'first' : ''}" data-act="open" data-v="${esc(r.uid)}" aria-expanded="${open}">
        <span class="pos">${rank === 1 && live.started ? '👑' : rank}</span>
        <span class="grow" style="min-width:0"><b>${esc(r.name)}</b>${r.uid === api.uid ? ' <span class="muted small">· you</span>' : ''}
          <span class="bars"><i class="c1" style="width:${w(r.sc.eastPlace)}"></i><i class="c2" style="width:${w(r.sc.westPlace)}"></i><i class="c3" style="width:${w(r.sc.wins)}"></i><i class="c4" style="width:${w(r.sc.stats)}"></i></span></span>
        <span class="tot">${fmt(r.sc.total)}</span>
      </button>${open ? `<div style="padding:4px 0 12px">${picksTables(r, live.started ? r.sc : null)}</div>` : ''}`;
    }).join('')}</div>
  <button class="btn ghost" data-act="reload-lb">Refresh scores</button>`;
}

async function loadBoard(force) {
  try {
    const [live, entries] = await Promise.all([getLive(force), api.entries(S.gid)]);
    const rows = entries.map(e => ({ ...e, sc: scoreEntry(e, live.started ? live : null) })).sort((a, b) => b.sc.total - a.sc.total);
    S.lb = { live, rows }; S.lbErr = null;
  } catch (e) { console.error(e); S.lbErr = "Couldn't load the scores. Check your connection and try again."; }
  render();
}

/* ---------- pick wizard ---------- */
function blankDraft() { return { east: [], west: [], players: [] }; }
function viewPick() {
  const d = S.draft, st = S.step;
  const titles = ['Eastern Conference', 'Western Conference', 'Your starting five', 'Lock it in'];
  const can = [d.east.length === 10, d.west.length === 10, d.players.length === 5, true][st];
  let body = st < 2 ? stepConf(st === 0 ? 'east' : 'west') : st === 2 ? stepPlayers() : stepReview();
  return `${topbar()}
  <main class="wrap stack" style="margin-top:16px;padding-bottom:0">
    <div class="steps" aria-hidden="true">${[0,1,2,3].map(i => `<div class="${i <= st ? 'on' : ''}"></div>`).join('')}</div>
    <div><p class="eyebrow">Step ${st + 1} of 4 · ${esc(S.group.name)}</p><h2>${titles[st]}</h2></div>
    ${body}
    <div class="stepnav">
      <button class="btn" data-act="${st === 0 ? 'cancel-pick' : 'prev'}">${st === 0 ? 'Cancel' : '← Back'}</button>
      <span class="grow small muted">${[`${d.east.length}/10 teams`, `${d.west.length}/10 teams`, `${d.players.length}/5 players`, ''][st]}</span>
      ${st < 3 ? `<button class="btn hot" data-act="next" ${can ? '' : 'disabled'}>Next →</button>` : `<button class="btn hot big" data-act="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Saving…' : S.entry ? 'Save changes' : 'Submit picks'}</button>`}
    </div>
  </main>`;
}

function stepConf(c) {
  const list = S.draft[c], picked = new Set(list.map(x => x.a));
  const pool = confTeams(CONF[c].key).filter(t => !picked.has(t.a));
  const warn = [];
  for (let i = 1; i < list.length; i++) if (list[i].w > list[i - 1].w) warn.push(`#${i + 1} ${teamBy[list[i].a].s} has more wins than #${i} ${teamBy[list[i - 1].a].s}.`);
  const slots = Array.from({ length: 10 }, (_, i) => {
    const p = list[i];
    if (!p) return `<div class="slot empty"><span class="rk">${i + 1}<small>${placeValue(i + 1)} pts</small></span><span>${i === list.length ? 'Tap a team below' : ''}</span></div>`;
    const t = teamBy[p.a];
    return `<div class="slot ${i >= 6 ? 'playin' : ''}">
      <span class="rk num">${i + 1}<small>${placeValue(i + 1)} pts</small></span>
      <img class="logo" src="${logo(p.a)}" alt="">
      <span class="tname">${esc(t.s)}<small>Last year ${t.lw}–${82 - t.lw}</small></span>
      <span class="wcell">${stepper(`w-${c}-${i}`, p.w, 'W', 0, 82, { act: 'w', c, i })}</span>
      <span class="mvcell row" style="gap:2px"><span class="mv"><button data-act="up" data-c="${c}" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button data-act="down" data-c="${c}" data-i="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></span><button class="btn ghost" style="min-height:36px;padding:4px 8px;border:0" data-act="rm" data-c="${c}" data-i="${i}" aria-label="Remove ${esc(t.s)}">✕</button></span>
    </div>`;
  }).join('');
  return `<p class="muted">Tap teams in the order you think they'll finish, 1 to 10. Then set each team's win total. Seeds 7–10 go to the play-in.</p>
    <div class="stack" style="gap:6px">${slots}</div>
    ${warn.length ? `<p class="note">Heads up: ${esc(warn[0])} That's allowed, but your win totals and your order disagree.</p>` : ''}
    ${pool.length ? `<div><p class="lbl">${list.length < 10 ? 'Tap to add' : 'Missed your cut'}</p><div class="pool">${pool.map(t => `<button class="tchip" data-act="addteam" data-c="${c}" data-v="${t.a}" ${list.length >= 10 ? 'disabled style="opacity:.5"' : ''}><img class="logo" src="${logo(t.a)}" alt="">${esc(t.s)}<small>${t.lw}–${82 - t.lw} last year</small></button>`).join('')}</div></div>` : ''}`;
}

function stepper(id, val, unit, min, max, data) {
  const ds = Object.entries(data).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<span class="stepper"><button type="button" data-step="-1" ${ds} aria-label="Less">−</button><input id="${id}" class="num" type="number" inputmode="numeric" min="${min}" max="${max}" value="${val}" ${ds} data-num="1" aria-label="${unit}"><span class="u">${unit}</span><button type="button" data-step="1" ${ds} aria-label="More">+</button></span>`;
}

function playerListHtml() {
  const q = S.pq.trim().toLowerCase(), sel = new Set(S.draft.players.map(p => p.id));
  const teamName = a => (teamBy[a]?.n || a).toLowerCase();
  const list = PLAYERS.filter(p => (S.ppos === 'All' || p.p.includes(S.ppos[0])) && (!q || p.n.toLowerCase().includes(q) || teamName(p.t).includes(q) || p.t.toLowerCase() === q));
  return list.map(p => `<button class="prow ${sel.has(p.id) ? 'sel' : ''}" data-act="addplayer" data-v="${p.id}">
      <img src="${head(p.id)}" alt="" loading="lazy">
      <span style="min-width:0"><b>${esc(p.n)}</b><span class="ln"> · ${esc(p.t)} · ${esc(p.p)}</span><br><span class="ln num">${p.l ? `Last season ${p.l[0]} pts · ${p.l[1]} reb · ${p.l[2]} ast` : 'Rookie / did not play last season'}</span></span>
      <span class="small" style="font-weight:700;color:var(--hot)">${sel.has(p.id) ? '✓' : '+'}</span>
    </button>`).join('') || '<p class="muted">No players match.</p>';
}

function stepPlayers() {
  const ps = S.draft.players;
  const cards = Array.from({ length: 5 }, (_, i) => {
    const p = ps[i];
    if (!p) return `<div class="pslot">${i === ps.length ? 'Pick a player below' : 'Open spot'}</div>`;
    const pl = playerBy[p.id];
    return `<div class="pcard">
      <img class="head" src="${head(p.id)}" alt="">
      <div class="row" style="min-width:0"><div class="grow" style="min-width:0"><b>${esc(pl.n)}</b><br><span class="muted small">${esc(pl.t)} · ${pl.l ? `last year ${pl.l.join(' / ')}` : 'rookie'}</span></div><button class="btn ghost" style="border:0;min-height:36px;padding:4px 8px" data-act="rmplayer" data-v="${p.id}" aria-label="Remove ${esc(pl.n)}">✕</button></div>
      <div class="stats">${stepper(`s-${p.id}-pts`, p.pts, 'PTS', 0, 60, { act: 's', id: p.id, k: 'pts' })}${stepper(`s-${p.id}-reb`, p.reb, 'REB', 0, 25, { act: 's', id: p.id, k: 'reb' })}${stepper(`s-${p.id}-ast`, p.ast, 'AST', 0, 20, { act: 's', id: p.id, k: 'ast' })}</div>
    </div>`;
  }).join('');
  return `<p class="muted">Draft any 5 players, then predict each one's season averages. Whole numbers. Exact hits score big.</p>
    <div class="lineup">${cards}</div>
    <div class="stack" style="gap:10px">
      <input class="txt" id="psearch" type="search" placeholder="Search players or teams" value="${esc(S.pq)}" aria-label="Search players">
      <div class="chips">${['All', 'Guards', 'Forwards', 'Centers'].map(x => `<button data-act="pos" data-v="${x}" class="${S.ppos === x ? 'on' : ''}">${x}</button>`).join('')}</div>
      <div class="plist" id="plist">${playerListHtml()}</div>
    </div>`;
}

function stepReview() {
  return `<p class="muted">Look it over. You can come back and edit until tip-off.</p>${picksTables({ ...S.draft }, null)}`;
}

/* ---------- render ---------- */
function render() {
  const fns = { home: viewHome, join: viewJoin, group: viewGroup, pick: viewPick,
    loading: () => `${topbar()}<main class="wrap"><p class="muted center" style="margin-top:40px">Warming up…</p></main>`,
    missing: () => `${topbar()}<main class="wrap stack" style="margin-top:24px"><section class="card stack"><h2>Group not found</h2><p>Check the link, or start your own group.</p><a class="btn hot" href="${location.pathname}">Create a group</a></section></main>`,
    error: () => `${topbar()}<main class="wrap stack" style="margin-top:24px"><section class="card stack"><h2>Something went wrong</h2><p>${esc(S.err)}</p><button class="btn" data-act="reload">Reload</button></section></main>` };
  $app.innerHTML = fns[S.view]();
  if (document.getElementById('calc-out')) calcUpdate();
}

/* ---------- navigation ---------- */
async function openGroup(gid) {
  S.gid = gid; S.view = 'loading'; render();
  const g = await api.getGroup(gid);
  if (!g) { S.view = 'missing'; render(); return; }
  S.group = g; rememberGroup(gid, g.name);
  unsubMembers?.();
  let first = true;
  await new Promise(res => {
    unsubMembers = api.watchMembers(gid, ms => {
      S.members = ms;
      if (first) { first = false; res(); }
      else if (S.view === 'group' || S.view === 'join') render();
    });
  });
  S.entry = await api.getEntry(gid);
  if (me()) { S.view = 'group'; S.tab = isLocked() ? 'board' : 'squad'; }
  else S.view = 'join';
  render();
  if (isLocked()) loadBoard();
}

function startPick() {
  S.draft = store.get(draftKey()) || (S.entry ? { east: S.entry.east, west: S.entry.west, players: S.entry.players } : blankDraft());
  S.step = 0; S.pq = ''; S.ppos = 'All'; S.view = 'pick'; render(); scrollTo(0, 0);
}

async function invite() {
  const url = inviteUrl();
  const text = `Join "${S.group.name}" on Hoops Oracle: call the 2026-27 NBA standings and pick your starting five.`;
  if (navigator.share && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
    try { await navigator.share({ title: 'Hoops Oracle', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied. Paste it in your group chat.'); }
  catch { const el = document.getElementById('invite-url'); if (el) { el.select(); toast('Copy the highlighted link.'); } else { S.tab = 'squad'; render(); } }
}

/* ---------- events ---------- */
function clamp(v, lo, hi) { v = parseInt(v, 10); return isNaN(v) ? lo : Math.min(hi, Math.max(lo, v)); }
function setNum(ds, val) {
  if (ds.act === 'w') { const p = S.draft[ds.c][+ds.i]; if (p) p.w = clamp(val, 0, 82); }
  else if (ds.act === 's') { const p = S.draft.players.find(x => x.id === ds.id); if (p) p[ds.k] = clamp(val, 0, ds.k === 'pts' ? 60 : ds.k === 'reb' ? 25 : 20); }
  saveDraft();
}

$app.addEventListener('click', async e => {
  const stepBtn = e.target.closest('[data-step]');
  if (stepBtn) {
    const input = stepBtn.parentElement.querySelector('input');
    const v = clamp(+input.value + +stepBtn.dataset.step, +input.min, +input.max);
    input.value = v; setNum(stepBtn.dataset, v);
    if (stepBtn.dataset.act === 'w') render();
    return;
  }
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  const { act, v, c } = b.dataset, i = +b.dataset.i;
  const d = S.draft;
  switch (act) {
    case 'home': history.pushState(null, '', location.pathname); S.view = 'home'; S.err = ''; unsubMembers?.(); render(); break;
    case 'tab': S.tab = v; if (v === 'mine' && isLocked() && !S.lb) loadBoard(); render(); break;
    case 'invite': invite(); break;
    case 'pick': startPick(); break;
    case 'spectate': S.view = 'group'; S.tab = 'board'; render(); break;
    case 'reload': location.reload(); break;
    case 'reload-lb': S.lb = null; S.lbErr = null; render(); loadBoard(true); break;
    case 'open': S.openUid = S.openUid === v ? null : v; render(); break;
    case 'cancel-pick': S.view = 'group'; render(); break;
    case 'prev': S.step--; render(); scrollTo(0, 0); break;
    case 'next': S.step++; render(); scrollTo(0, 0); break;
    case 'addteam': if (d[c].length < 10) { d[c].push({ a: v, w: teamBy[v].lw }); fixWinsDefault(c); saveDraft(); render(); } break;
    case 'rm': d[c].splice(i, 1); saveDraft(); render(); break;
    case 'up': if (i > 0) { [d[c][i - 1], d[c][i]] = [d[c][i], d[c][i - 1]]; saveDraft(); render(); } break;
    case 'down': if (i < d[c].length - 1) { [d[c][i + 1], d[c][i]] = [d[c][i], d[c][i + 1]]; saveDraft(); render(); } break;
    case 'pos': S.ppos = v; render(); break;
    case 'addplayer': {
      const idx = d.players.findIndex(p => p.id === v);
      if (idx >= 0) d.players.splice(idx, 1);
      else if (d.players.length >= 5) { toast('Your five is full. Remove someone first.'); break; }
      else { const l = playerBy[v].l || [12, 4, 2]; d.players.push({ id: v, pts: Math.round(l[0]), reb: Math.round(l[1]), ast: Math.round(l[2]) }); }
      saveDraft(); render(); break;
    }
    case 'rmplayer': d.players = d.players.filter(p => p.id !== v); saveDraft(); render(); break;
    case 'submit': submit(); break;
  }
});
// New team defaults to last season's wins; keep the list from looking obviously out of order.
function fixWinsDefault(c) { const l = S.draft[c]; const i = l.length - 1; if (i > 0 && l[i].w > l[i - 1].w) l[i].w = l[i - 1].w; }

$app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'psearch') { S.pq = t.value; document.getElementById('plist').innerHTML = playerListHtml(); return; }
  if (t.dataset.num) { if (t.value !== '') setNum(t.dataset, t.value); return; }
  if (/^c[wp]-/.test(t.id)) calcUpdate();
});
$app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.num) { setNum(t.dataset, t.value); t.value = clamp(t.value, +t.min, +t.max); if (t.dataset.act === 'w') render(); }
});

$app.addEventListener('submit', async e => {
  e.preventDefault();
  if (S.busy) return;
  try {
    if (e.target.id === 'create') {
      const name = document.getElementById('gname').value.trim(), my = document.getElementById('myname').value.trim();
      if (!name || !my) { S.err = 'Add a group name and your name.'; render(); return; }
      S.busy = true; S.err = ''; render();
      const id = await api.createGroup(name.slice(0, 40), my.slice(0, 30));
      store.set('ho-name', my);
      S.busy = false;
      history.pushState(null, '', `?g=${id}`);
      await openGroup(id);
      toast('Group created! Invite your friends, then make your picks.');
    } else if (e.target.id === 'join') {
      const my = document.getElementById('jname').value.trim();
      if (!my) { S.err = 'Add your name.'; render(); return; }
      S.busy = true; S.err = ''; render();
      await api.join(S.gid, my.slice(0, 30)); store.set('ho-name', my);
      S.busy = false;
      if (!me()) S.members.push({ uid: api.uid, name: my, done: false });
      startPick();
    }
  } catch (err) { console.error(err); S.busy = false; S.err = 'That didn\'t work. Check your connection and try again.'; render(); }
});

async function submit() {
  if (isLocked()) { toast('Picks are locked. The season has started.'); return; }
  const d = S.draft;
  if (d.east.length !== 10 || d.west.length !== 10 || d.players.length !== 5) { toast('Finish all three steps first.'); return; }
  S.busy = true; render();
  try {
    const entry = { name: me()?.name || store.get('ho-name', 'Player'), east: d.east, west: d.west, players: d.players, updatedAt: Date.now() };
    await api.saveEntry(S.gid, entry);
    S.entry = entry; store.del(draftKey());
    S.busy = false; S.view = 'group'; S.tab = 'mine'; render(); scrollTo(0, 0);
    confetti(); toast('Picks locked in. See you at tip-off! 🏀');
  } catch (err) { console.error(err); S.busy = false; render(); toast('Could not save. Check your connection and try again.'); }
}

addEventListener('popstate', () => boot());

/* ---------- boot ---------- */
async function boot() {
  if (!api) {
    try { api = window.FIREBASE_CONFIG ? await firebaseApi(window.FIREBASE_CONFIG) : localApi(); }
    catch (e) { console.error(e); S.err = 'Could not connect to the game server. Check your connection and reload.'; S.view = 'error'; render(); return; }
  }
  const gid = new URLSearchParams(location.search).get('g');
  if (gid) await openGroup(gid.replace(/[^a-z0-9]/gi, '').slice(0, 20));
  else { S.view = 'home'; render(); }
}
render();
boot();
})();
