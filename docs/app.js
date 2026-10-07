'use strict';

// ---------- constants ----------
const DECKS = [
  { id: 'servicio', icon: '🍽' },
  { id: 'bebidas', icon: '🍹' },
  { id: 'platos', icon: '🥘' },
  { id: 'vocab', icon: '📖' },
  { id: 'vender', icon: '✨' },
  { id: 'equipo', icon: '👥' },
];
const STORE_KEY = 'camarero.v1';
const API = 'https://77-42-69-208.sslip.io/camarero-api';
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
// Express ladder: box 0 = again in this session, then 10 min, 1, 2, 4, 8 days.
const LADDER = [0, 10 * MIN, DAY, 2 * DAY, 4 * DAY, 8 * DAY];
const LEARNED_BOX = 3;

// Plan: each task opens a mode with its filter. Texts are i18n keys.
const PLAN = [
  { day: 1, title: 'Сервис и зал', tasks: [
    { id: 'd1a', text: 'Карточки: сервис (весь путь гостя)', go: { tab: 'cards', deck: 'servicio' } },
    { id: 'd1b', text: 'Вслух: сервис, по-испански', go: { tab: 'speak', deck: 'servicio', lang: 'es' } },
    { id: 'd1c', text: 'Карточки: словарь — зал, посуда', go: { tab: 'cards', deck: 'vocab', sections: ['sala', 'vajilla'] } },
    { id: 'd1d', text: 'Сцена: пара на ужин', go: { tab: 'scenes', scene: 'pareja-cena' } },
  ]},
  { day: 2, title: 'Еда и продающие слова', tasks: [
    { id: 'd2a', text: 'Карточки: блюда (тапас, Валенсия)', go: { tab: 'cards', deck: 'platos' } },
    { id: 'd2b', text: 'Карточки: кухня, прожарка, аллергены', go: { tab: 'cards', deck: 'vocab', sections: ['cocina', 'punto', 'alergenos', 'ingredientes'] } },
    { id: 'd2c', text: 'Вслух: продающие фразы', go: { tab: 'speak', deck: 'vender' } },
    { id: 'd2d', text: 'Квиз: аллергены', go: { tab: 'quiz', set: 'alergenos' } },
    { id: 'd2e', text: 'Сцена: celíaco / аллергия', go: { tab: 'scenes', scene: 'celiaco-alergia' } },
  ]},
  { day: 3, title: 'Напитки, коктейли, вино', tasks: [
    { id: 'd3a', text: 'Карточки: напитки и коктейли', go: { tab: 'cards', deck: 'bebidas' } },
    { id: 'd3b', text: 'Квиз: коктейли', go: { tab: 'quiz', set: 'cocteles' } },
    { id: 'd3c', text: 'Квиз: кофе и пиво', go: { tab: 'quiz', set: 'cafe-cerveza' } },
    { id: 'd3d', text: 'Квиз: что налить к блюду', go: { tab: 'quiz', set: 'maridaje' } },
    { id: 'd3e', text: 'Сцена: бар (ночь)', go: { tab: 'scenes', scene: 'bar-copas' } },
    { id: 'd3f', text: 'Сцена: гость не может выбрать вино', go: { tab: 'scenes', scene: 'indeciso-vino' } },
  ]},
  { day: 4, title: 'Скорость и уверенность', tasks: [
    { id: 'd4a', text: 'Все сцены в режиме «непредсказуемый гость»', go: { tab: 'scenes' } },
    { id: 'd4b', text: 'Вслух: сервис по-английски', go: { tab: 'speak', deck: 'servicio', lang: 'en' } },
    { id: 'd4c', text: 'Карточки: с командой и кухней', go: { tab: 'cards', deck: 'equipo' } },
    { id: 'd4d', text: 'Повторить всё, что «к повтору»', go: { tab: 'cards', deck: 'all' } },
  ]},
];

// ---------- storage ----------
const store = (() => {
  let data = { cards: {}, quiz: {}, scenes: {}, plan: {}, settings: {} };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = Object.assign(data, JSON.parse(raw));
  } catch (e) { /* private mode or blocked storage: run in memory */ }
  return {
    data,
    save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {} },
  };
})();
const S = store.data;
S.settings = Object.assign({ promptLang: 'ru', lang: 'es', rate: 0.95, newPerSession: 20, voiceEs: '', voiceEn: '', aiCheck: true }, S.settings);
S.outbox = S.outbox || [];

// ---------- content ----------
// packDecks / packIds: restaurant packs built from menu photos (venue.js).
const C = { decks: {}, items: [], byId: {}, quiz: null, scenes: [], packDecks: [], packIds: new Set() };

async function loadJson(name) {
  const r = await fetch(`content/${name}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
  return r.json();
}

async function loadContent() {
  const errors = [];
  await Promise.all(DECKS.map(async d => {
    try {
      const deck = await loadJson(d.id);
      deck.icon = d.icon;
      C.decks[d.id] = deck;
      for (const sec of deck.sections) for (const it of sec.items) {
        it.deck = d.id; it.section = sec.id; it.sec = sec;
        C.items.push(it); C.byId[it.id] = it;
      }
    } catch (e) { errors.push(e.message); }
  }));
  try { C.quiz = await loadJson('quiz'); } catch (e) { errors.push(e.message); }
  try { C.scenes = (await loadJson('dialogos')).scenes; } catch (e) { errors.push(e.message); }
  return errors;
}

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const now = () => Date.now();
// App language (interface, prompts, notes): ru / en / es. Answer language is S.settings.lang.
const PL = () => S.settings.promptLang || 'ru';
// Field in the app language with fallback to the Russian original: L(node, 'hint') -> hint_en / hint_es / hint.
function L(o, base) { const p = PL(); return (o && p !== 'ru' && o[base + '_' + p]) || (o && o[base]) || ''; }
function promptOf(it) {
  const p = PL();
  if (p === 'en') return it.p_en || (S.settings.lang !== 'en' && it.en) || it.ru;
  if (p === 'es') return it.p_es || it.ru;
  return it.ru;
}
const deckTitle = id => L(C.decks[id], 'title');
const secTitle = it => L(it.sec, 'title');

function h(html) { const tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content; }
function render(html) { const v = view(); v.innerHTML = ''; v.appendChild(h(html)); window.scrollTo(0, 0); return v; }

// ---------- speech synthesis ----------
const tts = {
  voices: [],
  load() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => { this.voices = speechSynthesis.getVoices(); fillVoiceSelects(); };
    pick(); speechSynthesis.onvoiceschanged = pick;
  },
  voiceFor(lang) {
    const want = lang === 'en' ? S.settings.voiceEn : S.settings.voiceEs;
    if (want) { const v = this.voices.find(v => v.name === want); if (v) return v; }
    const prefix = lang === 'en' ? ['en-GB', 'en-US', 'en'] : ['es-ES', 'es'];
    for (const p of prefix) {
      const cands = this.voices.filter(v => v.lang.replace('_', '-').startsWith(p));
      const good = cands.find(v => /google|microsoft|natural|online/i.test(v.name)) || cands[0];
      if (good) return good;
    }
    return null;
  },
  say(text, lang) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voiceFor(lang);
    if (v) u.voice = v;
    u.lang = v ? v.lang : (lang === 'en' ? 'en-GB' : 'es-ES');
    u.rate = S.settings.rate;
    speechSynthesis.speak(u);
  },
};
const stopSpeech = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); };

// ---------- speech recognition ----------
// The browser turns speech into text in the language we set (no auto-detection):
// es-ES or en-GB. Up to three alternatives come back; all are used for grading.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen(lang, onInterim) {
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = lang === 'en' ? 'en-GB' : 'es-ES';
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.continuous = false;
    let finalAlts = [];
    r.onresult = e => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) finalAlts = Array.from(res).map(a => a.transcript);
      else onInterim && onInterim(res[0].transcript);
    };
    r.onerror = e => reject(e.error || 'error');
    r.onend = () => resolve(finalAlts);
    r.start();
    listen.current = r;
  });
}

// Normalize to comparable tokens: lowercase, no accents, no punctuation.
function tokens(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);
}
// Order-aware match: LCS over tokens. Returns score 0..1 and per-ref-word hit flags.
function compare(ref, said) {
  const a = tokens(ref), b = tokens(said);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array(a.length).fill(false);
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { hit[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const score = a.length ? dp[0][0] / a.length : 0;
  return { score, hit, words: a, saidLen: b.length };
}
function bestMatch(refs, alts) {
  let best = { score: -1 };
  for (const r of refs) for (const s of alts) {
    const m = compare(r, s); if (m.score > best.score) best = Object.assign(m, { ref: r, said: s });
  }
  return best;
}
// Paint the reference with matched words green, missed words underlined.
function paintRef(ref, hit) {
  let k = 0;
  return ref.split(/(\s+)/).map(part => {
    if (!part.trim()) return part;
    const has = tokens(part).length > 0;
    const cls = has ? (hit[k++] ? 'w-ok' : 'w-miss') : '';
    return cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
  }).join('');
}

// ---------- automatic grading ----------
// 1) Every reference word said, in order, with at most one extra word -> correct,
//    graded on the phone for free.
// 2) Otherwise the server asks a model (POST /check, ~1.5 s, ~$0.001; repeated
//    answers come from its cache). It accepts other natural wordings as correct
//    and shows the reference as "more common".
// 3) If the server is unreachable or over its daily cap: grade by word match.
const GRADE_OF = { correct: 'good', minor: 'hard', wrong: 'again', none: 'again' };
const VERDICT_UI = { correct: ['✅', 'Правильно'], minor: ['🟡', 'Почти'], wrong: ['❌', 'Неверно'], none: ['⏭', 'Не ответил'] };

async function evaluate({ refs, alts, situation, target }) {
  const m = bestMatch(refs, alts);
  const base = { heard: m.said, ref: m.ref, hit: m.hit };
  if (m.score === 1 && m.saidLen <= m.words.length + 1)
    return Object.assign(base, { verdict: 'correct', score: 100, same: true, source: 'local' });
  if (S.settings.aiCheck) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(API + '/check', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, signal: ctl.signal,
        body: JSON.stringify({ situation, target, ui: PL(), refs, heard: alts }),
      });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
        return Object.assign(base, { verdict: j.verdict, score: j.score, same: !!j.same_as_ref,
          heard: j.heard || m.said, better: j.better || '', comment: j.comment || '', source: 'ai' });
      }
    } catch (e) { /* offline, timeout or budget: fall through to the local score */ }
  }
  const s = Math.round(m.score * 100);
  return Object.assign(base, { verdict: s >= 80 ? 'correct' : s >= 50 ? 'minor' : 'wrong', score: s, same: false,
    source: 'local', comment: S.settings.aiCheck ? t('Проверка недоступна, оценка по совпадению слов') : '' });
}

// Result card: verdict, what was heard, the model's comment, the reference
// (as "more common" when another wording was accepted) and any better phrasing.
function verdictCard(v, refs, lang, it) {
  const [icon, label] = VERDICT_UI[v.verdict];
  const n = s => tokens(s).join(' ');
  const refShown = v.ref || refs[0];
  const better = v.better && !refs.some(r => n(r) === n(v.better)) ? v.better : '';
  const refLabel = v.verdict === 'correct' && !v.same ? 'Чаще говорят' : 'Эталон';
  return `<div class="card">
    <div class="verdict v-${v.verdict}"><span>${icon} ${esc(t(label))}</span>${v.score != null ? `<span class="pct">${v.score}%</span>` : ''}</div>
    ${v.heard ? `<div class="label">${esc(t('Ты сказал'))}</div><div class="said">«${esc(v.heard)}»</div>` : ''}
    ${v.comment ? `<div class="note">${esc(v.comment)}</div>` : ''}
    ${v.same && v.verdict === 'correct' ? '' : `<div class="label">${esc(t(refLabel))}</div>
      <div class="answer">${v.hit && v.source === 'local' ? paintRef(refShown, v.hit) : esc(refShown)} <button class="say" data-say="${esc(refShown)}" data-lang="${lang}">🔊</button></div>`}
    ${better ? `<div class="answer-alt">${esc(t('или'))}: ${esc(better)} <button class="say" data-say="${esc(better)}" data-lang="${lang}">🔊</button></div>` : ''}
    ${refs.filter(r => r !== refShown).map(r => `<div class="answer-alt">${esc(t('или'))}: ${esc(r)}</div>`).join('')}
    ${it && lang === 'es' && it.en && PL() !== 'en' ? `<div class="answer-alt">EN: ${esc(it.en)}</div>` : ''}
    ${it && it.note ? `<div class="note">${esc(L(it, 'note'))}</div>` : ''}
  </div>`;
}

// ---------- SRS ----------
function rec(key) { return S.cards[key] || null; }
function grade(key, g) {
  const r = S.cards[key] || { box: 0, due: 0, seen: 0, ok: 0, bad: 0 };
  r.seen++;
  if (g === 'again') { r.box = 0; r.bad++; }
  else if (g === 'hard') { r.box = Math.max(1, r.box); }
  else { r.box = Math.min(LADDER.length - 1, r.box + 1); r.ok++; }
  r.due = now() + LADDER[r.box];
  S.cards[key] = r; store.save();
  return r;
}
function itemsFor(filter) {
  return C.items.filter(it =>
    (filter.deck === 'all' || it.deck === filter.deck) &&
    (!filter.sections || !filter.sections.length || filter.sections.includes(it.section)) &&
    (!filter.phrasesOnly || it.kind === 'phrase') &&
    (!filter.needEn || it.en));
}
// Due reviews first (oldest first), then up to N new cards in content order.
function buildQueue(items, prefix) {
  const tm = now(), due = [], fresh = [];
  for (const it of items) {
    const r = rec(prefix + it.id);
    if (!r) fresh.push(it); else if (r.due <= tm) due.push(it);
  }
  due.sort((x, y) => rec(prefix + x.id).due - rec(prefix + y.id).due);
  return due.concat(fresh.slice(0, S.settings.newPerSession));
}
function deckStats(items, prefix = '') {
  let learned = 0, started = 0, due = 0; const tm = now();
  for (const it of items) {
    const r = rec(prefix + it.id); if (!r) continue;
    started++; if (r.box >= LEARNED_BOX) learned++; if (r.due <= tm) due++;
  }
  return { total: items.length, learned, started, due };
}
// After an answer: failed items come back a few cards later in the same session.
function advance(sess, it, r) {
  sess.queue.shift();
  if (r.box === 0) sess.queue.splice(Math.min(3, sess.queue.length), 0, it); else sess.done++;
}

// ---------- routing ----------
let state = { tab: 'plan' };
function go(tab, opts = {}) {
  stopSpeech();
  if (listen.current) try { listen.current.abort(); } catch (e) {}
  state = Object.assign({ tab }, opts);
  setCtx({});
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  try { sessionStorage.setItem('camarero.tab', tab); } catch (e) {}
  ({ plan: viewPlan, cards: viewCardsHome, speak: viewSpeakHome, scenes: viewScenes, quiz: viewQuizHome, venue: viewVenue })[tab](opts);
}

// ---------- plan ----------
function viewPlan() {
  const all = deckStats(C.items);
  let html = `<h2>${esc(t('План на 4 дня'))}</h2>
    <div class="card tight"><div class="stat-row"><span>${esc(t('Выучено карточек'))}</span><b>${all.learned} / ${all.total}</b></div>
    <div class="progress"><i style="width:${all.total ? 100 * all.learned / all.total : 0}%"></i></div>
    <div class="stat-row"><span>${esc(t('К повтору сейчас: {n}', { n: all.due }))}</span><span>${esc(t('Начато: {n}', { n: all.started }))}</span></div></div>`;
  for (const d of PLAN) {
    const done = d.tasks.filter(x => S.plan[x.id]).length;
    html += `<div class="card"><div class="day-head"><h3 style="margin:0">${esc(t('День {n}. {t}', { n: d.day, t: t(d.title) }))}</h3>
      <span class="muted small">${done}/${d.tasks.length}</span></div>`;
    for (const x of d.tasks) {
      html += `<div class="task"><input type="checkbox" data-task="${x.id}" ${S.plan[x.id] ? 'checked' : ''} aria-label="✓">
        <span class="task-text">${esc(t(x.text))}</span>
        <button class="btn go" data-go='${esc(JSON.stringify(x.go))}'>▶</button></div>`;
    }
    html += `</div>`;
  }
  html += `<p class="muted small center">${esc(t('Отмечай задачу, когда прошёл её без ошибок. Карточки «к повтору» лучше пройти и утром, и вечером.'))}</p>`;
  const v = render(html);
  v.querySelectorAll('[data-task]').forEach(cb => cb.onchange = () => { S.plan[cb.dataset.task] = cb.checked; store.save(); viewPlan(); });
  v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const g = JSON.parse(b.dataset.go); go(g.tab, Object.assign({ autostart: true }, g)); });
}

// ---------- deck/section picker (shared by cards + speak) ----------
function pickerHtml(sel, opts) {
  let html = `<div class="chips">` +
    `<button class="chip" data-deck="all" aria-pressed="${sel.deck === 'all'}">${esc(t('Все'))}</button>` +
    C.packDecks.concat(DECKS).filter(d => C.decks[d.id]).map(d => `<button class="chip" data-deck="${d.id}" aria-pressed="${sel.deck === d.id}">${d.icon} ${esc(deckTitle(d.id))}</button>`).join('') +
    `</div>`;
  if (sel.deck !== 'all' && C.decks[sel.deck]) {
    html += `<div class="chips">` + C.decks[sel.deck].sections
      .filter(s => !opts.phrasesOnly || s.items.some(i => i.kind === 'phrase'))
      .map(s => `<button class="chip" data-sec="${s.id}" aria-pressed="${(sel.sections || []).includes(s.id)}">${esc(L(s, 'title'))}</button>`).join('') + `</div>`;
  }
  return html;
}
function bindPicker(v, sel, rerender) {
  v.querySelectorAll('[data-deck]').forEach(b => b.onclick = () => { sel.deck = b.dataset.deck; sel.sections = []; rerender(); });
  v.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => {
    const s = new Set(sel.sections || []); s.has(b.dataset.sec) ? s.delete(b.dataset.sec) : s.add(b.dataset.sec);
    sel.sections = [...s]; rerender();
  });
}
function bindSay(root) {
  root.querySelectorAll('[data-say]').forEach(b => b.onclick = e => { e.stopPropagation(); e.preventDefault(); tts.say(b.dataset.say, b.dataset.lang); });
}

// ---------- cards ----------
const cardSel = { deck: 'servicio', sections: [], dir: 'p-es', list: false, q: '' };
function viewCardsHome(opts = {}) {
  if (opts.deck) { cardSel.deck = opts.deck; cardSel.sections = opts.sections || []; }
  const lang = S.settings.lang;
  cardSel.dir = cardSel.dir.startsWith('es') ? 'es-p' : 'p-' + lang;
  if (opts.autostart) { cardSel.list = false; return startCards(); }
  const pl = PL().toUpperCase();
  const items = itemsFor({ deck: cardSel.deck, sections: cardSel.sections });
  const st = deckStats(items);
  let html = `<h2>${esc(t('Карточки'))}</h2>${pickerHtml(cardSel, {})}
    <div class="seg"><button data-dir="p-${lang}" aria-pressed="${cardSel.dir !== 'es-p'}">${pl} → ${lang.toUpperCase()}</button>
    <button data-dir="es-p" aria-pressed="${cardSel.dir === 'es-p'}">ES → ${pl === 'ES' ? esc(t('толкование')) : pl}</button></div>
    <div class="card tight"><div class="stat-row"><span>${esc(t('Карточек: {n}', { n: st.total }))}</span><span>${esc(t('Выучено: {n}', { n: st.learned }))}</span><span>${esc(t('К повтору: {n}', { n: st.due }))}</span></div>
    <div class="progress"><i style="width:${st.total ? 100 * st.learned / st.total : 0}%"></i></div></div>
    <div class="row"><button class="btn primary" id="start">${esc(t('Начать'))}</button><button class="btn" id="list">${esc(t(cardSel.list ? 'Скрыть список' : 'Список'))}</button></div>`;
  if (cardSel.list) {
    html += `<input type="search" id="q" placeholder="${esc(t('Поиск…'))}" value="${esc(cardSel.q)}"><div class="card" id="listBox">${listHtml(items)}</div>`;
  }
  const v = render(html);
  bindPicker(v, cardSel, viewCardsHome);
  v.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { cardSel.dir = b.dataset.dir; viewCardsHome(); });
  $('#start', v).onclick = startCards;
  $('#list', v).onclick = () => { cardSel.list = !cardSel.list; viewCardsHome(); };
  const q = $('#q', v);
  if (q) q.oninput = () => { cardSel.q = q.value; $('#listBox').innerHTML = listHtml(items); bindSay($('#listBox')); };
  bindSay(v);
}
function listHtml(items) {
  const q = tokens(cardSel.q).join(' ');
  const shown = items.filter(it => !q || tokens([it.es, it.es_alt, it.en, it.ru, promptOf(it)].join(' ')).join(' ').includes(q));
  if (!shown.length) return `<p class="muted">${esc(t('Ничего не найдено.'))}</p>`;
  return shown.map(it => {
    const r = rec(it.id);
    return `<div class="list-item"><span class="box-dot b${r ? r.box : 0}"></span><b>${esc(it.es)}</b>
      <button class="say" data-say="${esc(it.es)}" data-lang="es" aria-label="🔊">🔊</button>
      <div>${esc(promptOf(it))}</div>${it.en && PL() !== 'en' ? `<div class="muted small">EN: ${esc(it.en)}</div>` : ''}
      ${it.note ? `<div class="muted small">${esc(L(it, 'note'))}</div>` : ''}</div>`;
  }).join('');
}
function extraHtml(it) {
  if (!it.extra) return '';
  return `<table class="extra">` + Object.entries(it.extra).map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('') + `</table>`;
}

function startCards() {
  const [from, to] = cardSel.dir.split('-');
  const items = itemsFor({ deck: cardSel.deck, sections: cardSel.sections, needEn: to === 'en' });
  const queue = buildQueue(items, '');
  if (!queue.length) {
    render(`<h2>${esc(t('Карточки'))}</h2><div class="card center"><p>${esc(t('На сейчас всё повторено 🎉'))}</p>
      <p class="muted small">${esc(t('Новые карточки появятся, когда подойдёт срок повтора. Можно выбрать другой раздел.'))}</p>
      <button class="btn primary wide" id="back">${esc(t('Назад'))}</button></div>`);
    $('#back').onclick = () => go('cards');
    return;
  }
  showCard({ queue, done: 0, total: queue.length, from, to });
}
function showCard(sess) {
  const it = sess.queue[0];
  if (!it) {
    render(`<h2>${esc(t('Сессия готова'))}</h2><div class="card center"><p>${esc(t('Пройдено карточек: {n}', { n: sess.done }))}</p>
      <div class="row"><button class="btn" id="back">${esc(t('К разделам'))}</button><button class="btn primary" id="more">${esc(t('Ещё'))}</button></div></div>`);
    $('#back').onclick = () => go('cards'); $('#more').onclick = startCards;
    return;
  }
  setCtx({ mode: 'cards', item: it.id, prompt: promptOf(it), ru: it.ru, es: it.es, en: it.en || '', dir: sess.from + '-' + sess.to });
  const lang = sess.to === 'p' ? 'es' : sess.to;
  const front = sess.from === 'p' ? promptOf(it) : it.es;
  const back = sess.from === 'p' ? (sess.to === 'en' ? it.en : it.es) : promptOf(it);
  const backAlt = sess.from === 'p' && sess.to === 'es' ? it.es_alt : '';
  const v = render(`<div class="stat-row"><span>${esc(deckTitle(it.deck))} · ${esc(secTitle(it))}</span><span>${sess.done}/${sess.total}</span></div>
    <div class="progress"><i style="width:${100 * sess.done / sess.total}%"></i></div>
    <div class="card" style="margin-top:12px">
      <div class="prompt">${esc(front)} ${sess.from === 'es' ? `<button class="say" data-say="${esc(it.es)}" data-lang="es">🔊</button>` : ''}</div>
      <div id="back" hidden>
        <div class="answer">${esc(back)} ${sess.to !== 'p' ? `<button class="say" data-say="${esc(back)}" data-lang="${lang}">🔊</button>` : ''}</div>
        ${backAlt ? `<div class="answer-alt">${esc(t('или'))}: ${esc(backAlt)} <button class="say" data-say="${esc(backAlt)}" data-lang="es">🔊</button></div>` : ''}
        ${sess.from === 'p' && sess.to === 'es' && it.en && PL() !== 'en' ? `<div class="answer-alt">EN: ${esc(it.en)}</div>` : ''}
        ${sess.from === 'es' && it.en && PL() !== 'en' ? `<div class="answer-alt">EN: ${esc(it.en)}</div>` : ''}
        ${it.note ? `<div class="note">${esc(L(it, 'note'))}</div>` : ''}${extraHtml(it)}
      </div>
    </div>
    <button class="btn primary wide" id="reveal">${esc(t('Показать ответ'))}</button>
    <div class="grade" id="grades" hidden>
      <button class="btn bad" data-g="again">${esc(t('Не знал'))}</button>
      <button class="btn warn" data-g="hard">${esc(t('Сомневался'))}</button>
      <button class="btn good" data-g="good">${esc(t('Знал'))}</button>
    </div>`);
  bindSay(v);
  $('#reveal').onclick = () => {
    $('#back').hidden = false; $('#reveal').hidden = true; $('#grades').hidden = false;
    if (sess.to !== 'p') tts.say(back, lang);
  };
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { advance(sess, it, grade(it.id, b.dataset.g)); showCard(sess); });
}

// ---------- speak ----------
const speakSel = { deck: 'servicio', sections: [] };
function viewSpeakHome(opts = {}) {
  if (opts.deck) { speakSel.deck = opts.deck; speakSel.sections = opts.sections || []; }
  if (opts.lang) setLang(opts.lang);
  const lang = S.settings.lang;
  const items = itemsFor({ deck: speakSel.deck, sections: speakSel.sections, phrasesOnly: true, needEn: lang === 'en' });
  if (opts.autostart) return startSpeak(items);
  const st = deckStats(items, 'v:');
  const v = render(`<h2>${esc(t('Сказать вслух'))}</h2>
    <p class="muted small">${esc(t('Видишь ситуацию, отвечаешь голосом на {lang}. Оценка ставится автоматически. Для беглости это главный режим.', { lang: t(lang === 'en' ? 'английском' : 'испанском') }))}</p>
    ${pickerHtml(speakSel, { phrasesOnly: true })}
    <div class="card tight"><div class="stat-row"><span>${esc(t('Фраз: {n}', { n: st.total }))}</span><span>${esc(t('Беглых: {n}', { n: st.learned }))}</span><span>${esc(t('К повтору: {n}', { n: st.due }))}</span></div>
    <div class="progress"><i style="width:${st.total ? 100 * st.learned / st.total : 0}%"></i></div></div>
    ${SR ? '' : `<div class="note">${esc(t('Этот браузер не распознаёт речь. Отвечай вслух, потом открывай эталон и оценивай себя сам. На Android лучше всего работает Chrome.'))}</div>`}
    <button class="btn primary wide" id="start" style="margin-top:12px">${esc(t('Начать'))}</button>`);
  bindPicker(v, speakSel, viewSpeakHome);
  $('#start').onclick = () => startSpeak(items);
}
function startSpeak(items) {
  const queue = buildQueue(items, 'v:');
  if (!queue.length) {
    render(`<div class="card center"><p>${esc(t('Здесь всё отработано на сегодня 🎉'))}</p><button class="btn primary wide" id="b">${esc(t('Назад'))}</button></div>`);
    $('#b').onclick = () => go('speak'); return;
  }
  showSpeak({ queue, done: 0, total: queue.length });
}
function micError(err) {
  return err === 'not-allowed' || err === 'service-not-allowed'
    ? t('Нет доступа к микрофону — разреши его в настройках сайта') : t('Ошибка распознавания: {e}', { e: err });
}
function showSpeak(sess) {
  const it = sess.queue[0];
  if (!it) {
    render(`<h2>${esc(t('Готово'))}</h2><div class="card center"><p>${esc(t('Отработано фраз: {n}', { n: sess.done }))}</p>
      <div class="row"><button class="btn" id="b">${esc(t('Назад'))}</button><button class="btn primary" id="m">${esc(t('Ещё'))}</button></div></div>`);
    $('#b').onclick = () => go('speak'); $('#m').onclick = () => go('speak', { autostart: true });
    return;
  }
  setCtx({ mode: 'speak', item: it.id, prompt: promptOf(it), ru: it.ru, es: it.es, en: it.en || '' });
  const lang = S.settings.lang;
  const refs = lang === 'en' ? [it.en] : [it.es, it.es_alt].filter(Boolean);
  let first = null;   // the first attempt's verdict is what gets graded
  const v = render(`<div class="stat-row"><span>${esc(secTitle(it))}</span><span>${sess.done}/${sess.total}</span></div>
    <div class="progress"><i style="width:${100 * sess.done / sess.total}%"></i></div>
    <div class="card" style="margin-top:12px"><div class="crumb">${esc(t('Ситуация'))}</div><div class="prompt">${esc(promptOf(it))}</div></div>
    ${SR ? `<button class="mic" id="mic" aria-label="${esc(t('Говорить'))}">🎤</button><div class="heard" id="heard">${esc(t('Нажми и скажи'))}</div>` : ''}
    <div id="result"></div>
    <button class="btn ${SR ? '' : 'primary'} wide" id="reveal">${esc(t(SR ? 'Не знаю — показать' : 'Сказал — показать эталон'))}</button>
    <div id="after"></div>`);
  const next = () => { advance(sess, it, grade('v:' + it.id, GRADE_OF[first])); showSpeak(sess); };
  const showAfter = () => {
    $('#reveal').hidden = true;
    $('#after').innerHTML = `${first !== 'none' && SR ? `<p class="muted small center">${esc(t('Повтор не меняет оценку — засчитана первая попытка.'))}</p>` : ''}
      <button class="btn primary wide" id="next">${esc(t('Дальше ▶'))}</button>`;
    $('#next').onclick = next;
  };
  const showResult = verdict => {
    $('#result').innerHTML = verdictCard(verdict, refs, lang, it);
    bindSay($('#result'));
    tts.say(verdict.better && verdict.verdict !== 'correct' ? verdict.better : (verdict.ref || refs[0]), lang);
  };
  $('#reveal').onclick = () => {
    if (!SR) {   // no speech recognition: self-grading is the only option
      $('#result').innerHTML = verdictCard({ verdict: 'none', ref: refs[0] }, refs, lang, it).replace(/<div class="verdict[\s\S]*?<\/div>/, '');
      bindSay($('#result')); tts.say(refs[0], lang); $('#reveal').hidden = true;
      $('#after').innerHTML = `<div class="grade"><button class="btn bad" data-g="again">${esc(t('Не смог'))}</button>
        <button class="btn warn" data-g="hard">${esc(t('С запинкой'))}</button><button class="btn good" data-g="good">${esc(t('Бегло'))}</button></div>`;
      $('#after').querySelectorAll('[data-g]').forEach(b => b.onclick = () => { advance(sess, it, grade('v:' + it.id, b.dataset.g)); showSpeak(sess); });
      return;
    }
    if (!first) first = 'none';
    showResult({ verdict: 'none', ref: refs[0] });
    showAfter();
  };
  const mic = $('#mic');
  if (mic) mic.onclick = async () => {
    if (mic.classList.contains('on')) { listen.current && listen.current.stop(); return; }
    stopSpeech();
    mic.classList.add('on'); $('#heard').textContent = t('Слушаю…');
    let alts;
    try { alts = await listen(lang, s => { $('#heard').textContent = s; }); }
    catch (err) { mic.classList.remove('on'); $('#heard').textContent = micError(err); return; }
    mic.classList.remove('on');
    if (!alts.length) { $('#heard').textContent = t('Ничего не расслышал, попробуй ещё раз'); return; }
    $('#heard').textContent = '';
    $('#result').innerHTML = `<div class="spinner">${esc(t('Проверяю…'))}</div>`;
    $('#reveal').hidden = true;
    const verdict = await evaluate({ refs, alts, target: lang, situation: it.p_en || it.ru });
    Object.assign(CTX, { heard: verdict.heard, score: verdict.score, verdict: verdict.verdict, comment: verdict.comment || '' });
    if (!first) first = verdict.verdict;
    showResult(verdict);
    showAfter();
    mic.setAttribute('aria-label', t('Ещё раз'));
  };
}

// ---------- scenes ----------
let wildGuest = false;
function viewScenes(opts = {}) {
  if (opts.scene) { const sc = C.scenes.find(s => s.id === opts.scene); if (sc) return playScene(sc); }
  const v = render(`<h2>${esc(t('Сцены'))}</h2>
    <p class="muted small">${esc(t('Гость говорит, ты отвечаешь вслух, AI оценивает ответ, потом выбираешь, как гость отреагировал. В режиме «непредсказуемый гость» реакцию выбирает случай, как в жизни.'))}</p>
    <div class="seg"><button id="calm" aria-pressed="${!wildGuest}">${esc(t('Выбираю сам'))}</button><button id="wild" aria-pressed="${wildGuest}">${esc(t('🎲 Непредсказуемый гость'))}</button></div>
    ${C.scenes.map(sc => {
      const st = S.scenes[sc.id] || { runs: 0, ends: [] };
      const ends = Object.entries(sc.nodes).filter(([, n]) => n.end || !n.next || !n.next.length).length;
      return `<button class="card tight option" data-scene="${sc.id}" style="text-align:left">
        <b>${esc(L(sc, 'title'))}</b> <span class="pill" style="font-size:11px;padding:1px 8px">${sc.lang.toUpperCase()}</span>
        <div class="muted small">${esc(L(sc, 'context'))}</div>
        <div class="stat-row"><span>${esc(t('Пройдено раз: {n}', { n: st.runs }))}</span><span>${esc(t('Концовок: {a}/{b}', { a: (st.ends || []).length, b: ends }))}</span></div></button>`;
    }).join('')}`);
  $('#calm').onclick = () => { wildGuest = false; viewScenes(); };
  $('#wild').onclick = () => { wildGuest = true; viewScenes(); };
  v.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => playScene(C.scenes.find(s => s.id === b.dataset.scene)));
}
function playScene(sc) {
  const log = [];
  render(`<div class="stat-row"><button class="btn ghost" id="exit" style="min-height:0;padding:4px 10px">${esc(t('← Сцены'))}</button>
    <span>${esc(L(sc, 'title'))}${wildGuest ? ' · 🎲' : ''}</span></div>
    <div class="card tight muted small">${esc(L(sc, 'context'))}</div><div id="chat"></div><div id="ctl"></div>`);
  $('#exit').onclick = () => go('scenes');
  step(sc, sc.start, log);
}
function step(sc, nodeId, log) {
  const node = sc.nodes[nodeId];
  setCtx({ mode: 'scene', scene: sc.id, node: nodeId, guest: node && node.guest || '', you: node && node.you && node.you[0] || '' });
  const chat = $('#chat'), ctl = $('#ctl');
  if (!node) { ctl.innerHTML = `<p class="muted">${esc(t('Узел «{n}» не найден.', { n: nodeId }))}</p>`; return; }
  if (node.guest) {
    chat.appendChild(h(`<div class="bubble guest"><span class="who">${esc(t('Гость'))}</span>${esc(node.guest)}
      <button class="say" data-say="${esc(node.guest)}" data-lang="${sc.lang}">🔊</button></div>`));
    bindSay(chat.lastElementChild);
    tts.say(node.guest, sc.lang);
  }
  const isEnd = node.end || !node.next || !node.next.length;
  if (isEnd && !(node.you && node.you.length)) return finishScene(sc, nodeId, log);
  const refs = node.you || [];
  ctl.innerHTML = `${node.hint ? `<div class="hint">💡 ${esc(L(node, 'hint'))}</div>` : ''}
    ${SR && refs.length ? `<button class="mic" id="mic" aria-label="${esc(t('Ответить'))}">🎤</button><div class="heard" id="heard">${esc(t('Ответь гостю'))}</div>` : ''}
    ${refs.length ? `<button class="btn wide" id="show">${esc(t(SR ? 'Показать вариант ответа' : 'Ответил — показать вариант'))}</button>` : ''}`;
  window.scrollTo(0, document.body.scrollHeight);
  const after = v => {
    if (v) {
      const [icon] = VERDICT_UI[v.verdict];
      chat.appendChild(h(`<div class="bubble you"><span class="who">${esc(t('Ты'))} · ${icon} ${v.score}%</span>${esc(v.heard)}
        ${v.comment ? `<div class="small muted">${esc(v.comment)}</div>` : ''}</div>`));
    }
    const shown = v && v.verdict === 'correct' && v.same ? '' : (v && v.better && v.verdict !== 'correct' ? v.better : refs[0]);
    if (shown) {
      chat.appendChild(h(`<div class="bubble you" style="opacity:.85"><span class="who">${esc(t(v && v.verdict === 'correct' ? 'Чаще говорят' : 'Вариант'))}</span>${esc(shown)}
        <button class="say" data-say="${esc(shown)}" data-lang="${sc.lang}">🔊</button>
        ${refs.filter(r => r !== shown).map(r => `<div class="small muted">${esc(t('или'))}: ${esc(r)}</div>`).join('')}</div>`));
      bindSay(chat.lastElementChild);
      tts.say(shown, sc.lang);
    }
    log.push({ node: nodeId, score: v ? v.score : null });
    if (isEnd) return finishScene(sc, nodeId, log);
    const nx = node.next;
    if (wildGuest) {
      ctl.innerHTML = `<button class="btn primary wide" id="cont">${esc(t('Дальше ▶'))}</button>`;
      $('#cont').onclick = () => step(sc, nx[Math.floor(Math.random() * nx.length)].to, log);
    } else {
      ctl.innerHTML = `<div class="crumb" style="margin:8px 0">${esc(t('Как реагирует гость?'))}</div>` +
        nx.map((n, i) => `<button class="btn option" data-i="${i}">${esc(n.label)}</button>`).join('');
      ctl.querySelectorAll('[data-i]').forEach(b => b.onclick = () => step(sc, nx[+b.dataset.i].to, log));
    }
    window.scrollTo(0, document.body.scrollHeight);
  };
  const show = $('#show');
  if (show) show.onclick = () => after(null);
  const mic = $('#mic');
  if (mic) mic.onclick = async () => {
    if (mic.classList.contains('on')) { listen.current && listen.current.stop(); return; }
    stopSpeech();
    mic.classList.add('on'); $('#heard').textContent = t('Слушаю…');
    let alts;
    try { alts = await listen(sc.lang, s => { $('#heard').textContent = s; }); }
    catch (err) { mic.classList.remove('on'); $('#heard').textContent = micError(err); return; }
    mic.classList.remove('on');
    if (!alts.length) { $('#heard').textContent = t('Ничего не расслышал, попробуй ещё раз'); return; }
    ctl.innerHTML = `<div class="spinner">${esc(t('Проверяю…'))}</div>`;
    const situation = `${node.guest ? `The guest said: "${node.guest}". ` : ''}The waiter should: ${node.hint_en || node.hint || ''}`;
    const v = await evaluate({ refs, alts, target: sc.lang, situation });
    Object.assign(CTX, { heard: v.heard, score: v.score, verdict: v.verdict, comment: v.comment || '' });
    after(v);
  };
  if (!refs.length && !isEnd) after(null);
}
function finishScene(sc, endId, log) {
  const st = S.scenes[sc.id] || { runs: 0, ends: [] };
  st.runs++; if (!st.ends.includes(endId)) st.ends.push(endId);
  S.scenes[sc.id] = st; store.save();
  const scored = log.filter(l => l.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((a, l) => a + l.score, 0) / scored.length) : null;
  $('#ctl').innerHTML = `<div class="card center"><b>${esc(t('Конец сцены'))}</b>
    ${avg !== null ? `<div class="score">${avg}%</div><div class="muted small">${esc(t('средняя оценка ответов'))}</div>` : ''}
    <div class="muted small">${esc(t('Концовок открыто: {n}', { n: st.ends.length }))}</div>
    <div class="row" style="margin-top:10px"><button class="btn" id="list">${esc(t('Все сцены'))}</button><button class="btn primary" id="again">${esc(t('Ещё раз'))}</button></div></div>`;
  $('#list').onclick = () => go('scenes');
  $('#again').onclick = () => playScene(sc);
  window.scrollTo(0, document.body.scrollHeight);
}

// ---------- quiz ----------
function viewQuizHome(opts = {}) {
  if (!C.quiz) return render(`<p class="muted">${esc(t('Квиз не загрузился.'))}</p>`);
  if (opts.set) { const s = C.quiz.sets.find(x => x.id === opts.set); if (s) return playQuiz(s); }
  const v = render(`<h2>${esc(t('Квиз'))}</h2>
    ${C.quiz.sets.map(s => {
      const best = (S.quiz[s.id] || {}).best;
      return `<button class="card tight option" data-set="${s.id}"><b>${esc(L(s, 'title'))}</b>
        <div class="stat-row"><span>${esc(t('Вопросов: {n}', { n: s.questions.length }))}</span><span>${esc(best != null ? t('Лучший: {n}%', { n: best }) : t('ещё не проходил'))}</span></div></button>`;
    }).join('')}
    ${C.quiz.rules && C.quiz.rules.length ? `<details class="card"><summary>${esc(t('Правила сочетаний (шпаргалка)'))}</summary>
      ${C.quiz.rules.map(r => `<div class="rule"><b>${esc(r[PL()] || r.ru)}</b>${PL() !== 'es' ? `<div class="muted">${esc(r.es)}</div>` : ''}</div>`).join('')}</details>` : ''}`);
  v.querySelectorAll('[data-set]').forEach(b => b.onclick = () => playQuiz(C.quiz.sets.find(s => s.id === b.dataset.set)));
}
function playQuiz(set) {
  const qs = shuffle(set.questions).map(q => {
    const order = shuffle(q.options.map((o, i) => i));
    return { q: L(q, 'q'), why: L(q, 'why'), options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
  });
  showQ({ set, qs, i: 0, right: 0, wrong: [] });
}
function showQ(sess) {
  const q = sess.qs[sess.i];
  if (!q) {
    const pct = Math.round(100 * sess.right / sess.qs.length);
    const qr = S.quiz[sess.set.id] || {}; qr.best = Math.max(qr.best || 0, pct); S.quiz[sess.set.id] = qr; store.save();
    render(`<h2>${esc(L(sess.set, 'title'))}</h2><div class="card center"><div class="score">${pct}%</div>
      <p>${esc(t('{a} из {b}', { a: sess.right, b: sess.qs.length }))}</p></div>
      ${sess.wrong.length ? `<h3>${esc(t('Разобрать ошибки'))}</h3>` + sess.wrong.map(w => `<div class="card tight"><b>${esc(w.q)}</b>
        <div class="w-ok">${esc(w.options[w.answer])}</div><div class="muted small">${esc(w.why || '')}</div></div>`).join('') : ''}
      <div class="row"><button class="btn" id="b">${esc(t('Все квизы'))}</button><button class="btn primary" id="a">${esc(t('Ещё раз'))}</button></div>`);
    $('#b').onclick = () => go('quiz'); $('#a').onclick = () => playQuiz(sess.set);
    return;
  }
  setCtx({ mode: 'quiz', set: sess.set.id, q: q.q, answer: q.options[q.answer] });
  const v = render(`<div class="stat-row"><span>${esc(L(sess.set, 'title'))}</span><span>${sess.i + 1}/${sess.qs.length}</span></div>
    <div class="progress"><i style="width:${100 * sess.i / sess.qs.length}%"></i></div>
    <div class="card" style="margin-top:12px"><div class="prompt">${esc(q.q)}</div></div>
    ${q.options.map((o, i) => `<button class="btn option" data-o="${i}">${esc(o)}</button>`).join('')}
    <div id="why"></div>`);
  v.querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
    const pick = +b.dataset.o;
    v.querySelectorAll('[data-o]').forEach(x => { x.disabled = true; if (+x.dataset.o === q.answer) x.classList.add('right'); });
    if (pick === q.answer) sess.right++; else { b.classList.add('wrong'); sess.wrong.push(q); }
    $('#why').innerHTML = `${q.why ? `<div class="note">${esc(q.why)}</div>` : ''}<button class="btn primary wide" id="next" style="margin-top:12px">${esc(t('Дальше'))}</button>`;
    $('#next').onclick = () => { sess.i++; showQ(sess); };
  });
}

// ---------- ✋ reports ----------
// Same idea as the ✋ button in LA: the note leaves straight from the lesson
// with its context (which card / scene / question, what was heard and how it
// was graded), so nothing depends on remembering it later. If the phone is
// offline the note waits in the outbox and goes out on the next send or start.
let CTX = { mode: 'plan' };
function setCtx(o) { CTX = Object.assign({ mode: state.tab }, o); }

function ctxSummary(c) {
  const parts = [];
  if (c.mode === 'cards' || c.mode === 'speak') parts.push(`${t(c.mode === 'cards' ? 'Карточка' : 'Вслух')} ${c.item}`, c.prompt || c.ru, c.es, c.en);
  else if (c.mode === 'scene') parts.push(`${t('Сцена')} ${c.scene} / ${c.node}`, c.guest && `${t('Гость')}: ${c.guest}`, c.you && `${t('Вариант')}: ${c.you}`);
  else if (c.mode === 'quiz') parts.push(`${t('Квиз')} ${c.set}`, c.q, c.answer && `${t('Ответ')}: ${c.answer}`);
  else parts.push(`${t('Экран')}: ${c.mode}`);
  if (c.heard) parts.push(`${t('Распознано')}: «${c.heard}» (${c.score}%${c.verdict ? ', ' + t(VERDICT_UI[c.verdict][1]) : ''})`);
  if (c.comment) parts.push(c.comment);
  return parts.filter(Boolean).join('\n');
}
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}
async function postReport(r) {
  // text/plain keeps it a "simple" CORS request: no preflight round trip.
  const res = await fetch(API + '/report', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(r) });
  if (!res.ok) throw new Error(res.status);
}
async function flushOutbox() {
  let sent = 0;
  while (S.outbox.length) {
    try { await postReport(S.outbox[0]); S.outbox.shift(); store.save(); sent++; }
    catch (e) { break; }
  }
  return sent;
}
function initReports() {
  const dlg = $('#report'), tags = new Set();
  $('#reportBtn').onclick = () => {
    stopSpeech();
    tags.clear();
    dlg.querySelectorAll('[data-tag]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    $('#reportText').value = '';
    $('#reportCtx').textContent = ctxSummary(CTX);
    dlg.showModal();
  };
  dlg.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => {
    tags.has(b.dataset.tag) ? tags.delete(b.dataset.tag) : tags.add(b.dataset.tag);
    b.setAttribute('aria-pressed', tags.has(b.dataset.tag));
  });
  $('#reportCancel').onclick = () => dlg.close();
  $('#reportSend').onclick = async () => {
    const text = $('#reportText').value.trim();
    if (!text && !tags.size) { $('#reportText').focus(); return; }
    const r = Object.assign({}, CTX, {
      text: text || '(—)', tags: [...tags].join(', '), ui: PL(),
      lang: S.settings.lang, at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120),
    });
    S.outbox.push(r); store.save();
    dlg.close();
    const before = S.outbox.length;
    await flushOutbox();
    toast(S.outbox.length < before ? t('Записано ✋ — разберу') : t('Нет связи — сохранил, отправлю позже ({n})', { n: S.outbox.length }));
  };
}

// ---------- settings ----------
function setLang(l) {
  S.settings.lang = l; store.save();
  $('#langBtn').textContent = l.toUpperCase();
}
function fillVoiceSelects() {
  for (const [id, lang] of [['voiceEs', 'es'], ['voiceEn', 'en']]) {
    const sel = $('#' + id); if (!sel) continue;
    const vs = tts.voices.filter(v => v.lang.toLowerCase().startsWith(lang));
    sel.innerHTML = `<option value="">${esc(t('Автовыбор'))}</option>` + vs.map(v => `<option ${S.settings[id] === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    sel.onchange = () => { S.settings[id] = sel.value.replace(/ \([^)]*\)$/, ''); store.save(); tts.say(lang === 'en' ? 'Hi there, how are you?' : '¡Buenas! ¿Qué os pongo?', lang); };
  }
}
function initSettings() {
  const dlg = $('#settings');
  $('#settingsBtn').onclick = () => {
    $('#rate').value = S.settings.rate; $('#rateOut').textContent = S.settings.rate;
    $('#newPerSession').value = S.settings.newPerSession;
    $('#promptLang').value = PL();
    $('#aiCheck').checked = !!S.settings.aiCheck;
    fillVoiceSelects(); dlg.showModal();
  };
  $('#rate').oninput = e => { S.settings.rate = +e.target.value; $('#rateOut').textContent = S.settings.rate; store.save(); };
  $('#promptLang').onchange = e => { S.settings.promptLang = e.target.value; store.save(); applyStaticI18n(); fillVoiceSelects(); go(state.tab); };
  $('#aiCheck').onchange = e => { S.settings.aiCheck = e.target.checked; store.save(); };
  $('#newPerSession').onchange = e => { S.settings.newPerSession = Math.max(5, +e.target.value || 20); store.save(); };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'camarero-progress.json'; a.click();
  };
  $('#resetBtn').onclick = () => {
    const b = $('#resetBtn');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = t('Точно сбросить?'); return; }
    S.cards = {}; S.quiz = {}; S.scenes = {}; S.plan = {}; store.save(); dlg.close(); go(state.tab);
  };
  $('#langBtn').onclick = () => { setLang(S.settings.lang === 'es' ? 'en' : 'es'); go(state.tab); };
}

// ---------- boot ----------
(async function boot() {
  applyStaticI18n();
  setLang(S.settings.lang);
  initSettings();
  initReports();
  tts.load();
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  const errors = await loadContent();
  await loadPacks();
  resumeBuilds();
  let tab = 'plan';
  try { tab = sessionStorage.getItem('camarero.tab') || 'plan'; } catch (e) {}
  go(tab);
  flushOutbox();
  if (errors.length) view().prepend(h(`<div class="note">${esc(t('Не загрузилось: {n}', { n: errors.join('; ') }))}</div>`));
})();
