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
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
// Express ladder: box 0 = again in this session, then 10 min, 1, 2, 4, 8 days.
const LADDER = [0, 10 * MIN, DAY, 2 * DAY, 4 * DAY, 8 * DAY];
const LEARNED_BOX = 3;

// Plan: tasks point at a mode + filter. `target` = cards (box>=3) needed to auto-tick.
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
S.settings = Object.assign({ promptLang: 'ru', lang: 'es', rate: 0.95, newPerSession: 20, voiceEs: '', voiceEn: '' }, S.settings);

// ---------- content ----------
const C = { decks: {}, items: [], byId: {}, quiz: null, scenes: [] };

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
        it.deck = d.id; it.section = sec.id; it.sectionTitle = sec.title;
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
// Prompt language (what you READ): ru / en / es. Target language (what you SAY) is S.settings.lang.
const PL = () => S.settings.promptLang || 'ru';
// Field in the prompt language with fallback to the Russian original: L(node, 'hint') -> hint_en / hint_es / hint.
function L(o, base) { const p = PL(); return (p !== 'ru' && o[base + '_' + p]) || o[base]; }
function promptOf(it) {
  const p = PL();
  if (p === 'en') return it.p_en || (S.settings.lang !== 'en' && it.en) || it.ru;
  if (p === 'es') return it.p_es || it.ru;
  return it.ru;
}

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
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

// ---------- speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen(lang, onInterim) {
  return new Promise((resolve, reject) => {
    const rec = new SR();
    rec.lang = lang === 'en' ? 'en-GB' : 'es-ES';
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    let finalAlts = [];
    rec.onresult = e => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) finalAlts = Array.from(res).map(a => a.transcript);
      else onInterim && onInterim(res[0].transcript);
    };
    rec.onerror = e => reject(e.error || 'error');
    rec.onend = () => resolve(finalAlts);
    rec.start();
    listen.current = rec;
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
  return { score, hit, words: a };
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
  const t = now(), due = [], fresh = [];
  for (const it of items) {
    const r = rec(prefix + it.id);
    if (!r) fresh.push(it); else if (r.due <= t) due.push(it);
  }
  due.sort((x, y) => rec(prefix + x.id).due - rec(prefix + y.id).due);
  return due.concat(fresh.slice(0, S.settings.newPerSession));
}
function deckStats(items, prefix = '') {
  let learned = 0, started = 0, due = 0; const t = now();
  for (const it of items) {
    const r = rec(prefix + it.id); if (!r) continue;
    started++; if (r.box >= LEARNED_BOX) learned++; if (r.due <= t) due++;
  }
  return { total: items.length, learned, started, due };
}

// ---------- routing ----------
let state = { tab: 'plan' };
function go(tab, opts = {}) {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (listen.current) try { listen.current.abort(); } catch (e) {}
  state = Object.assign({ tab }, opts);
  setCtx({});
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  try { sessionStorage.setItem('camarero.tab', tab); } catch (e) {}
  ({ plan: viewPlan, cards: viewCardsHome, speak: viewSpeakHome, scenes: viewScenes, quiz: viewQuizHome })[tab](opts);
}

// ---------- plan ----------
function viewPlan() {
  const all = deckStats(C.items);
  let html = `<h2>План на 4 дня</h2>
    <div class="card tight"><div class="stat-row"><span>Выучено карточек</span><b>${all.learned} / ${all.total}</b></div>
    <div class="progress"><i style="width:${all.total ? 100 * all.learned / all.total : 0}%"></i></div>
    <div class="stat-row"><span>К повтору сейчас: ${all.due}</span><span>Начато: ${all.started}</span></div></div>`;
  for (const d of PLAN) {
    const done = d.tasks.filter(t => S.plan[t.id]).length;
    html += `<div class="card"><div class="day-head"><h3 style="margin:0">День ${d.day}. ${esc(d.title)}</h3>
      <span class="muted small">${done}/${d.tasks.length}</span></div>`;
    for (const t of d.tasks) {
      html += `<div class="task"><input type="checkbox" data-task="${t.id}" ${S.plan[t.id] ? 'checked' : ''} aria-label="Готово">
        <span class="task-text">${esc(t.text)}</span>
        <button class="btn go" data-go='${esc(JSON.stringify(t.go))}'>▶</button></div>`;
    }
    html += `</div>`;
  }
  html += `<p class="muted small center">Отмечай задачу, когда прошёл её без ошибок. Карточки «к повтору» лучше пройти и утром, и вечером.</p>`;
  const v = render(html);
  v.querySelectorAll('[data-task]').forEach(cb => cb.onchange = () => { S.plan[cb.dataset.task] = cb.checked; store.save(); viewPlan(); });
  v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const g = JSON.parse(b.dataset.go); go(g.tab, Object.assign({ autostart: true }, g)); });
}

// ---------- deck/section picker (shared by cards + speak) ----------
function pickerHtml(sel, opts) {
  let html = `<div class="chips">` +
    `<button class="chip" data-deck="all" aria-pressed="${sel.deck === 'all'}">Все</button>` +
    DECKS.filter(d => C.decks[d.id]).map(d => `<button class="chip" data-deck="${d.id}" aria-pressed="${sel.deck === d.id}">${d.icon} ${esc(C.decks[d.id].title)}</button>`).join('') +
    `</div>`;
  if (sel.deck !== 'all' && C.decks[sel.deck]) {
    html += `<div class="chips">` + C.decks[sel.deck].sections
      .filter(s => !opts.phrasesOnly || s.items.some(i => i.kind === 'phrase'))
      .map(s => `<button class="chip" data-sec="${s.id}" aria-pressed="${(sel.sections || []).includes(s.id)}">${esc(s.title)}</button>`).join('') + `</div>`;
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

// ---------- cards ----------
const cardSel = { deck: 'servicio', sections: [], dir: 'ru-es', list: false, q: '' };
function viewCardsHome(opts = {}) {
  if (opts.deck) { cardSel.deck = opts.deck; cardSel.sections = opts.sections || []; }
  if (opts.autostart) { cardSel.list = false; return startCards(); }
  const lang = S.settings.lang;
  cardSel.dir = cardSel.dir.startsWith('es') ? 'es-p' : 'p-' + lang;
  const pl = PL().toUpperCase();
  const items = itemsFor({ deck: cardSel.deck, sections: cardSel.sections });
  const st = deckStats(items);
  let html = `<h2>Карточки</h2>${pickerHtml(cardSel, {})}
    <div class="seg"><button data-dir="p-${lang}" aria-pressed="${cardSel.dir !== 'es-p'}">${pl} → ${lang.toUpperCase()}</button>
    <button data-dir="es-p" aria-pressed="${cardSel.dir === 'es-p'}">ES → ${pl === 'ES' ? 'толкование' : pl}</button></div>
    <div class="card tight"><div class="stat-row"><span>Карточек: ${st.total}</span><span>Выучено: ${st.learned}</span><span>К повтору: ${st.due}</span></div>
    <div class="progress"><i style="width:${st.total ? 100 * st.learned / st.total : 0}%"></i></div></div>
    <div class="row"><button class="btn primary" id="start">Начать</button><button class="btn" id="list">${cardSel.list ? 'Скрыть список' : 'Список'}</button></div>`;
  if (cardSel.list) {
    html += `<input type="search" id="q" placeholder="Поиск…" value="${esc(cardSel.q)}"><div class="card" id="listBox">${listHtml(items)}</div>`;
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
  if (!shown.length) return `<p class="muted">Ничего не найдено.</p>`;
  return shown.map(it => {
    const r = rec(it.id);
    return `<div class="list-item"><span class="box-dot b${r ? r.box : 0}"></span><b>${esc(it.es)}</b>
      <button class="say" data-say="${esc(it.es)}" data-lang="es" aria-label="Озвучить">🔊</button>
      <div>${esc(promptOf(it))}</div>${it.en && PL() !== 'en' ? `<div class="muted small">EN: ${esc(it.en)}</div>` : ''}
      ${it.note ? `<div class="muted small">${esc(L(it, 'note'))}</div>` : ''}</div>`;
  }).join('');
}
function bindSay(root) {
  root.querySelectorAll('[data-say]').forEach(b => b.onclick = e => { e.stopPropagation(); tts.say(b.dataset.say, b.dataset.lang); });
}
function extraHtml(it) {
  if (!it.extra) return '';
  return `<table class="extra">` + Object.entries(it.extra).map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('') + `</table>`;
}

function startCards() {
  const [from, to] = cardSel.dir.split('-');
  const items = itemsFor({ deck: cardSel.deck, sections: cardSel.sections, needEn: to === 'en' });
  const queue = buildQueue(items, '');
  const session = { queue, done: 0, total: queue.length, from, to };
  if (!queue.length) {
    render(`<h2>Карточки</h2><div class="card center"><p>На сейчас всё повторено 🎉</p><p class="muted small">Новые карточки появятся, когда подойдёт срок повтора. Можно выбрать другой раздел.</p>
      <button class="btn primary wide" id="back">Назад</button></div>`);
    $('#back').onclick = () => go('cards');
    return;
  }
  showCard(session);
}
function showCard(sess) {
  const it = sess.queue[0];
  if (it) setCtx({ mode: 'cards', item: it.id, ru: it.ru, es: it.es, en: it.en || '', dir: sess.from + '-' + sess.to });
  if (!it) {
    render(`<h2>Сессия готова</h2><div class="card center"><p>Пройдено карточек: <b>${sess.done}</b></p>
      <div class="row"><button class="btn" id="back">К разделам</button><button class="btn primary" id="more">Ещё</button></div></div>`);
    $('#back').onclick = () => go('cards'); $('#more').onclick = startCards;
    return;
  }
  const lang = sess.to === 'p' ? 'es' : sess.to;
  const front = sess.from === 'p' ? promptOf(it) : it.es;
  const back = sess.from === 'p' ? (sess.to === 'en' ? it.en : it.es) : promptOf(it);
  const backAlt = sess.from === 'p' && sess.to === 'es' ? it.es_alt : '';
  const v = render(`<div class="stat-row"><span>${esc(C.decks[it.deck].title)} · ${esc(it.sectionTitle)}</span><span>${sess.done}/${sess.total}</span></div>
    <div class="progress"><i style="width:${100 * sess.done / sess.total}%"></i></div>
    <div class="card" style="margin-top:12px">
      <div class="prompt">${esc(front)} ${sess.from === 'es' ? `<button class="say" data-say="${esc(it.es)}" data-lang="es">🔊</button>` : ''}</div>
      <div id="back" hidden>
        <div class="answer">${esc(back)} ${sess.to !== 'p' ? `<button class="say" data-say="${esc(back)}" data-lang="${lang}">🔊</button>` : ''}</div>
        ${backAlt ? `<div class="answer-alt">или: ${esc(backAlt)} <button class="say" data-say="${esc(backAlt)}" data-lang="es">🔊</button></div>` : ''}
        ${sess.from === 'p' && sess.to === 'es' && it.en && PL() !== 'en' ? `<div class="answer-alt">EN: ${esc(it.en)}</div>` : ''}
        ${sess.from === 'es' && it.en ? `<div class="answer-alt">EN: ${esc(it.en)}</div>` : ''}
        ${it.note ? `<div class="note">${esc(L(it, 'note'))}</div>` : ''}${extraHtml(it)}
      </div>
    </div>
    <button class="btn primary wide" id="reveal">Показать ответ</button>
    <div class="grade" id="grades" hidden>
      <button class="btn bad" data-g="again">Не знал</button>
      <button class="btn warn" data-g="hard">Сомневался</button>
      <button class="btn good" data-g="good">Знал</button>
    </div>`);
  bindSay(v);
  $('#reveal').onclick = () => {
    $('#back').hidden = false; $('#reveal').hidden = true; $('#grades').hidden = false;
    if (sess.to !== 'p') tts.say(back, lang);
  };
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const r = grade(it.id, b.dataset.g);
    sess.queue.shift();
    // Failed cards come back a few cards later in the same session.
    if (r.box === 0) sess.queue.splice(Math.min(3, sess.queue.length), 0, it); else sess.done++;
    showCard(sess);
  });
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
  const v = render(`<h2>Сказать вслух</h2>
    <p class="muted small">Видишь ситуацию по-русски, отвечаешь голосом на ${lang === 'en' ? 'английском' : 'испанском'}. Для беглости это главный режим.</p>
    ${pickerHtml(speakSel, { phrasesOnly: true })}
    <div class="card tight"><div class="stat-row"><span>Фраз: ${st.total}</span><span>Беглых: ${st.learned}</span><span>К повтору: ${st.due}</span></div>
    <div class="progress"><i style="width:${st.total ? 100 * st.learned / st.total : 0}%"></i></div></div>
    ${SR ? '' : `<div class="note">Этот браузер не распознаёт речь. Отвечай вслух, потом открывай эталон и оценивай себя сам. На Android лучше всего работает Chrome.</div>`}
    <button class="btn primary wide" id="start" style="margin-top:12px">Начать</button>`);
  bindPicker(v, speakSel, viewSpeakHome);
  $('#start').onclick = () => startSpeak(items);
}
function startSpeak(items) {
  const queue = buildQueue(items, 'v:');
  if (!queue.length) {
    render(`<div class="card center"><p>Здесь всё отработано на сегодня 🎉</p><button class="btn primary wide" id="b">Назад</button></div>`);
    $('#b').onclick = () => go('speak'); return;
  }
  showSpeak({ queue, done: 0, total: queue.length });
}
function showSpeak(sess) {
  const it = sess.queue[0];
  if (it) setCtx({ mode: 'speak', item: it.id, ru: it.ru, es: it.es, en: it.en || '' });
  if (!it) {
    render(`<h2>Готово</h2><div class="card center"><p>Отработано фраз: <b>${sess.done}</b></p>
      <div class="row"><button class="btn" id="b">Назад</button><button class="btn primary" id="m">Ещё</button></div></div>`);
    $('#b').onclick = () => go('speak'); $('#m').onclick = () => go('speak', { autostart: true });
    return;
  }
  const lang = S.settings.lang;
  const refs = lang === 'en' ? [it.en] : [it.es, it.es_alt].filter(Boolean);
  const v = render(`<div class="stat-row"><span>${esc(it.sectionTitle)}</span><span>${sess.done}/${sess.total}</span></div>
    <div class="progress"><i style="width:${100 * sess.done / sess.total}%"></i></div>
    <div class="card" style="margin-top:12px"><div class="crumb">Ситуация</div><div class="prompt">${esc(promptOf(it))}</div></div>
    ${SR ? `<button class="mic" id="mic" aria-label="Говорить">🎤</button><div class="heard" id="heard">Нажми и скажи</div>` : ''}
    <div id="result"></div>
    <button class="btn ${SR ? '' : 'primary'} wide" id="reveal">${SR ? 'Не знаю — показать' : 'Сказал — показать эталон'}</button>
    <div class="grade" id="grades" hidden>
      <button class="btn bad" data-g="again">Не смог</button>
      <button class="btn warn" data-g="hard">С запинкой</button>
      <button class="btn good" data-g="good">Бегло</button>
    </div>`);
  const showRef = (m) => {
    const ref = refs[0];
    $('#result').innerHTML = `<div class="card">
      ${m ? `<div class="score" style="color:var(--${m.score >= .8 ? 'good' : m.score >= .5 ? 'warn' : 'bad'})">${Math.round(m.score * 100)}%</div>` : ''}
      <div class="answer">${m ? paintRef(m.ref, m.hit) : esc(ref)} <button class="say" data-say="${esc(m ? m.ref : ref)}" data-lang="${lang}">🔊</button></div>
      ${refs.slice(1).map(r => `<div class="answer-alt">или: ${esc(r)}</div>`).join('')}
      ${lang === 'es' && it.en && PL() !== 'en' ? `<div class="answer-alt">EN: ${esc(it.en)}</div>` : ''}
      ${it.note ? `<div class="note">${esc(L(it, 'note'))}</div>` : ''}</div>`;
    bindSay($('#result'));
    $('#reveal').hidden = true; $('#grades').hidden = false;
    tts.say(m ? m.ref : ref, lang);
  };
  $('#reveal').onclick = () => showRef(null);
  const mic = $('#mic');
  if (mic) mic.onclick = async () => {
    if (mic.classList.contains('on')) { listen.current && listen.current.stop(); return; }
    speechSynthesis && speechSynthesis.cancel();
    mic.classList.add('on'); $('#heard').textContent = 'Слушаю…';
    try {
      const alts = await listen(lang, t => { $('#heard').textContent = t; });
      mic.classList.remove('on');
      if (!alts.length) { $('#heard').textContent = 'Ничего не расслышал, попробуй ещё раз'; return; }
      const m = bestMatch(refs, alts);
      CTX.heard = m.said; CTX.score = Math.round(m.score * 100);
      $('#heard').textContent = '«' + m.said + '»';
      showRef(m);
      // Pre-select the suggested grade by score.
      const sug = m.score >= .8 ? 'good' : m.score >= .5 ? 'hard' : 'again';
      $(`[data-g="${sug}"]`).style.outline = '3px solid currentColor';
    } catch (err) {
      mic.classList.remove('on');
      $('#heard').textContent = err === 'not-allowed' ? 'Нет доступа к микрофону — разреши его в настройках сайта' : 'Ошибка распознавания: ' + err;
    }
  };
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const r = grade('v:' + it.id, b.dataset.g);
    sess.queue.shift();
    if (r.box === 0) sess.queue.splice(Math.min(3, sess.queue.length), 0, it); else sess.done++;
    showSpeak(sess);
  });
}

// ---------- scenes ----------
let wildGuest = false;
function viewScenes(opts = {}) {
  if (opts.scene) { const sc = C.scenes.find(s => s.id === opts.scene); if (sc) return playScene(sc); }
  const v = render(`<h2>Сцены</h2>
    <p class="muted small">Гость говорит, ты отвечаешь вслух, потом выбираешь, как он отреагировал. В режиме «непредсказуемый гость» реакцию выбирает случай, как в жизни.</p>
    <div class="seg"><button id="calm" aria-pressed="${!wildGuest}">Выбираю сам</button><button id="wild" aria-pressed="${wildGuest}">🎲 Непредсказуемый гость</button></div>
    ${C.scenes.map(sc => {
      const st = S.scenes[sc.id] || { runs: 0, ends: [] };
      const ends = Object.entries(sc.nodes).filter(([, n]) => n.end || !n.next || !n.next.length).length;
      return `<button class="card tight option" data-scene="${sc.id}" style="text-align:left">
        <b>${esc(L(sc, 'title'))}</b> <span class="pill" style="font-size:11px;padding:1px 8px">${sc.lang.toUpperCase()}</span>
        <div class="muted small">${esc(L(sc, 'context'))}</div>
        <div class="stat-row"><span>Пройдено раз: ${st.runs}</span><span>Концовок: ${(st.ends || []).length}/${ends}</span></div></button>`;
    }).join('')}`);
  $('#calm').onclick = () => { wildGuest = false; viewScenes(); };
  $('#wild').onclick = () => { wildGuest = true; viewScenes(); };
  v.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => playScene(C.scenes.find(s => s.id === b.dataset.scene)));
}
function playScene(sc) {
  const log = [];
  const v = render(`<div class="stat-row"><button class="btn ghost" id="exit" style="min-height:0;padding:4px 10px">← Сцены</button>
    <span>${esc(L(sc, 'title'))}${wildGuest ? ' · 🎲' : ''}</span></div>
    <div class="card tight muted small">${esc(L(sc, 'context'))}</div><div id="chat"></div><div id="ctl"></div>`);
  $('#exit').onclick = () => go('scenes');
  step(sc, sc.start, log);
}
function step(sc, nodeId, log) {
  const node = sc.nodes[nodeId];
  setCtx({ mode: 'scene', scene: sc.id, node: nodeId, guest: node && node.guest || '', you: node && node.you && node.you[0] || '' });
  const chat = $('#chat'), ctl = $('#ctl');
  if (!node) { ctl.innerHTML = `<p class="muted">Узел «${esc(nodeId)}» не найден.</p>`; return; }
  if (node.guest) {
    chat.appendChild(h(`<div class="bubble guest"><span class="who">Гость</span>${esc(node.guest)}
      <button class="say" data-say="${esc(node.guest)}" data-lang="${sc.lang}">🔊</button></div>`));
    bindSay(chat.lastElementChild);
    tts.say(node.guest, sc.lang);
  }
  const isEnd = node.end || !node.next || !node.next.length;
  if (isEnd && !(node.you && node.you.length)) return finishScene(sc, nodeId, log);
  const refs = node.you || [];
  ctl.innerHTML = `${node.hint ? `<div class="hint">💡 ${esc(L(node, 'hint'))}</div>` : ''}
    ${SR && refs.length ? `<button class="mic" id="mic" aria-label="Ответить">🎤</button><div class="heard" id="heard">Ответь гостю</div>` : ''}
    ${refs.length ? `<button class="btn wide" id="show">${SR ? 'Показать вариант ответа' : 'Ответил — показать вариант'}</button>` : ''}
    <div id="after"></div>`;
  window.scrollTo(0, document.body.scrollHeight);
  const after = (m) => {
    const said = m ? m.said : null;
    if (m) { CTX.heard = m.said; CTX.score = Math.round(m.score * 100); }
    if (said) chat.appendChild(h(`<div class="bubble you"><span class="who">Ты · ${Math.round(m.score * 100)}%</span>${esc(said)}</div>`));
    const ref = m ? m.ref : refs[0];
    if (ref) {
      chat.appendChild(h(`<div class="bubble you" style="opacity:.85"><span class="who">Вариант</span>${m ? paintRef(ref, m.hit) : esc(ref)}
        <button class="say" data-say="${esc(ref)}" data-lang="${sc.lang}">🔊</button>
        ${refs.filter(r => r !== ref).map(r => `<div class="small muted">или: ${esc(r)}</div>`).join('')}</div>`));
      bindSay(chat.lastElementChild);
      if (!m) tts.say(ref, sc.lang);
    }
    log.push({ node: nodeId, score: m ? m.score : null });
    if (isEnd) return finishScene(sc, nodeId, log);
    const nx = node.next;
    if (wildGuest) {
      ctl.innerHTML = `<button class="btn primary wide" id="cont">Дальше ▶</button>`;
      $('#cont').onclick = () => step(sc, nx[Math.floor(Math.random() * nx.length)].to, log);
    } else {
      ctl.innerHTML = `<div class="crumb" style="margin:8px 0">Как реагирует гость?</div>` +
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
    speechSynthesis && speechSynthesis.cancel();
    mic.classList.add('on'); $('#heard').textContent = 'Слушаю…';
    try {
      const alts = await listen(sc.lang, t => { $('#heard').textContent = t; });
      mic.classList.remove('on');
      if (!alts.length) { $('#heard').textContent = 'Не расслышал, ещё раз'; return; }
      after(bestMatch(refs, alts));
    } catch (err) {
      mic.classList.remove('on');
      $('#heard').textContent = err === 'not-allowed' ? 'Нет доступа к микрофону' : 'Ошибка: ' + err;
    }
  };
  if (!refs.length && !isEnd) after(null);
}
function finishScene(sc, endId, log) {
  const st = S.scenes[sc.id] || { runs: 0, ends: [] };
  st.runs++; if (!st.ends.includes(endId)) st.ends.push(endId);
  S.scenes[sc.id] = st; store.save();
  const scored = log.filter(l => l.score !== null);
  const avg = scored.length ? Math.round(100 * scored.reduce((a, l) => a + l.score, 0) / scored.length) : null;
  $('#ctl').innerHTML = `<div class="card center"><b>Конец сцены</b>
    ${avg !== null ? `<div class="score">${avg}%</div><div class="muted small">среднее совпадение с вариантом</div>` : ''}
    <div class="muted small">Концовок открыто: ${st.ends.length}</div>
    <div class="row" style="margin-top:10px"><button class="btn" id="list">Все сцены</button><button class="btn primary" id="again">Ещё раз</button></div></div>`;
  $('#list').onclick = () => go('scenes');
  $('#again').onclick = () => playScene(sc);
  window.scrollTo(0, document.body.scrollHeight);
}

// ---------- quiz ----------
function viewQuizHome(opts = {}) {
  if (!C.quiz) return render(`<p class="muted">Квиз не загрузился.</p>`);
  if (opts.set) { const s = C.quiz.sets.find(x => x.id === opts.set); if (s) return playQuiz(s); }
  const v = render(`<h2>Квиз</h2>
    ${C.quiz.sets.map(s => {
      const best = (S.quiz[s.id] || {}).best;
      return `<button class="card tight option" data-set="${s.id}"><b>${esc(L(s, 'title'))}</b>
        <div class="stat-row"><span>Вопросов: ${s.questions.length}</span><span>${best != null ? 'Лучший: ' + best + '%' : 'ещё не проходил'}</span></div></button>`;
    }).join('')}
    ${C.quiz.rules && C.quiz.rules.length ? `<details class="card"><summary>Правила сочетаний (шпаргалка)</summary>
      ${C.quiz.rules.map(r => `<div class="rule"><b>${esc(r[PL()] || r.ru)}</b>${PL() !== 'es' ? `<div class="muted">${esc(r.es)}</div>` : ''}</div>`).join('')}</details>` : ''}`);
  v.querySelectorAll('[data-set]').forEach(b => b.onclick = () => playQuiz(C.quiz.sets.find(s => s.id === b.dataset.set)));
}
function playQuiz(set) {
  const qs = shuffle(set.questions).map(q => {
    const order = shuffle(q.options.map((o, i) => i));
    return { q: L(q, 'q'), why: L(q, 'why'), options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
  });
  const sess = { set, qs, i: 0, right: 0, wrong: [] };
  showQ(sess);
}
function showQ(sess) {
  const q = sess.qs[sess.i];
  if (q) setCtx({ mode: 'quiz', set: sess.set.id, q: q.q, answer: q.options[q.answer] });
  if (!q) {
    const pct = Math.round(100 * sess.right / sess.qs.length);
    const qr = S.quiz[sess.set.id] || {}; qr.best = Math.max(qr.best || 0, pct); S.quiz[sess.set.id] = qr; store.save();
    const v = render(`<h2>${esc(L(sess.set, 'title'))}</h2><div class="card center"><div class="score">${pct}%</div>
      <p>${sess.right} из ${sess.qs.length}</p></div>
      ${sess.wrong.length ? `<h3>Разобрать ошибки</h3>` + sess.wrong.map(w => `<div class="card tight"><b>${esc(w.q)}</b>
        <div class="w-ok">${esc(w.options[w.answer])}</div><div class="muted small">${esc(w.why || '')}</div></div>`).join('') : ''}
      <div class="row"><button class="btn" id="b">Все квизы</button><button class="btn primary" id="a">Ещё раз</button></div>`);
    $('#b').onclick = () => go('quiz'); $('#a').onclick = () => playQuiz(sess.set);
    return;
  }
  const v = render(`<div class="stat-row"><span>${esc(L(sess.set, 'title'))}</span><span>${sess.i + 1}/${sess.qs.length}</span></div>
    <div class="progress"><i style="width:${100 * sess.i / sess.qs.length}%"></i></div>
    <div class="card" style="margin-top:12px"><div class="prompt">${esc(q.q)}</div></div>
    ${q.options.map((o, i) => `<button class="btn option" data-o="${i}">${esc(o)}</button>`).join('')}
    <div id="why"></div>`);
  v.querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
    const pick = +b.dataset.o;
    v.querySelectorAll('[data-o]').forEach(x => { x.disabled = true; if (+x.dataset.o === q.answer) x.classList.add('right'); });
    if (pick === q.answer) sess.right++; else { b.classList.add('wrong'); sess.wrong.push(q); }
    $('#why').innerHTML = `${q.why ? `<div class="note">${esc(q.why)}</div>` : ''}<button class="btn primary wide" id="next" style="margin-top:12px">Дальше</button>`;
    $('#next').onclick = () => { sess.i++; showQ(sess); };
  });
}

// ---------- ✋ reports ----------
// Same idea as the ✋ button in LA: the note leaves straight from the lesson
// with its context (which card / scene / question), so nothing depends on
// remembering it later. If the phone is offline the note waits in the outbox
// and goes out on the next send or app start.
const REPORT_API = 'https://77-42-69-208.sslip.io/camarero-api/report';
let CTX = { mode: 'plan' };
function setCtx(o) { CTX = Object.assign({ mode: state.tab }, o); }
S.outbox = S.outbox || [];

function ctxSummary(c) {
  const parts = [];
  if (c.mode === 'cards' || c.mode === 'speak') parts.push(`${c.mode === 'cards' ? 'Карточка' : 'Вслух'} ${c.item}`, c.ru, c.es, c.en);
  else if (c.mode === 'scene') parts.push(`Сцена ${c.scene} / ${c.node}`, c.guest && 'Гость: ' + c.guest, c.you && 'Вариант: ' + c.you);
  else if (c.mode === 'quiz') parts.push(`Квиз ${c.set}`, c.q, c.answer && 'Ответ: ' + c.answer);
  else parts.push('Экран: ' + c.mode);
  if (c.heard) parts.push(`Распознано: «${c.heard}» (${c.score}%)`);
  return parts.filter(Boolean).join('\n');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}
async function postReport(rec) {
  // text/plain keeps it a "simple" CORS request: no preflight round trip.
  const r = await fetch(REPORT_API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(rec) });
  if (!r.ok) throw new Error(r.status);
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
    if ('speechSynthesis' in window) speechSynthesis.cancel();
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
    const rec = Object.assign({}, CTX, {
      text: text || '(без комментария)', tags: [...tags].join(', '),
      lang: S.settings.lang, at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120),
    });
    S.outbox.push(rec); store.save();
    dlg.close();
    const before = S.outbox.length;
    await flushOutbox();
    toast(S.outbox.length < before ? 'Записано ✋ — разберу' : `Нет связи — сохранил, отправлю позже (${S.outbox.length})`);
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
    sel.innerHTML = `<option value="">Автовыбор</option>` + vs.map(v => `<option ${S.settings[id] === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    sel.onchange = () => { S.settings[id] = sel.value.replace(/ \([^)]*\)$/, ''); store.save(); tts.say(lang === 'en' ? 'Hi there, how are you?' : '¡Buenas! ¿Qué os pongo?', lang); };
  }
}
function initSettings() {
  const dlg = $('#settings');
  $('#settingsBtn').onclick = () => {
    $('#rate').value = S.settings.rate; $('#rateOut').textContent = S.settings.rate;
    $('#newPerSession').value = S.settings.newPerSession;
    $('#promptLang').value = PL();
    fillVoiceSelects(); dlg.showModal();
  };
  $('#rate').oninput = e => { S.settings.rate = +e.target.value; $('#rateOut').textContent = S.settings.rate; store.save(); };
  $('#promptLang').onchange = e => { S.settings.promptLang = e.target.value; store.save(); go(state.tab); };
  $('#newPerSession').onchange = e => { S.settings.newPerSession = Math.max(5, +e.target.value || 20); store.save(); };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'camarero-progress.json'; a.click();
  };
  $('#resetBtn').onclick = () => {
    if (!$('#resetBtn').dataset.armed) { $('#resetBtn').dataset.armed = '1'; $('#resetBtn').textContent = 'Точно сбросить?'; return; }
    S.cards = {}; S.quiz = {}; S.scenes = {}; S.plan = {}; store.save(); dlg.close(); go(state.tab);
  };
  $('#langBtn').onclick = () => { setLang(S.settings.lang === 'es' ? 'en' : 'es'); go(state.tab); };
}

// ---------- boot ----------
(async function boot() {
  setLang(S.settings.lang);
  initSettings();
  initReports();
  tts.load();
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  const errors = await loadContent();
  let tab = 'plan';
  try { tab = sessionStorage.getItem('camarero.tab') || 'plan'; } catch (e) {}
  go(tab);
  flushOutbox();
  if (errors.length) view().prepend(h(`<div class="note">Не загрузилось: ${esc(errors.join('; '))}</div>`));
})();
