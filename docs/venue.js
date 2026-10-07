'use strict';
// «Моё заведение»: photos of a real menu -> a training pack for that restaurant.
// Server side: server/menu.py (extract on Sonnet vision, then a parallel build).
// A pack plugs into the normal modes: its card deck, its "speak" phrases, its
// quiz set and its scenes appear next to the built-in content.

const MAX_SIDE = 1600;   // px; a phone photo downscaled to this reads fine and costs ~1.5k tokens
S.packs = S.packs || [];           // [{id, name, created, counts, cost}]
S.packCache = S.packCache || {};   // id -> full pack (offline use)
let venueDraft = null;             // {images: [dataUrl], menu, cost}

// ---------- registering packs into the app ----------
function registerPack(p) {
  if (!p || p.status !== 'ready' || C.packIds.has(p.id)) return;
  C.packIds.add(p.id);
  for (const deck of p.decks || []) {
    deck.icon = '🏪';
    C.decks[deck.id] = deck;
    C.packDecks.push({ id: deck.id, icon: '🏪' });
    for (const sec of deck.sections) for (const it of sec.items) {
      it.deck = deck.id; it.section = sec.id; it.sec = sec;
      C.items.push(it); C.byId[it.id] = it;
    }
  }
  if (p.quiz && p.quiz.questions && p.quiz.questions.length && C.quiz) C.quiz.sets.unshift(p.quiz);
  for (const sc of p.scenes || []) C.scenes.unshift(sc);
}
async function fetchPack(id) {
  const r = await fetch(`${API}/packs/${id}`);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function loadPacks() {
  for (const meta of S.packs) {
    let p = S.packCache[meta.id];
    if (!p || p.status !== 'ready') {
      try { p = await fetchPack(meta.id); if (p.status === 'ready') { S.packCache[meta.id] = p; store.save(); } } catch (e) {}
    }
    if (p) registerPack(p);
  }
}

// ---------- images ----------
function downscale(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function apiPost(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) {
    const map = { code: 'Неверный код доступа', budget: 'Дневной лимит на меню исчерпан, попробуй завтра', size: 'Слишком большие фото' };
    throw new Error(t(map[j.error] || 'Не получилось: {e}', { e: j.error || r.status }));
  }
  return j;
}

// ---------- screens ----------
function viewVenue() {
  const list = S.packs.map(m => {
    const p = S.packCache[m.id];
    const st = p && p.status === 'ready' ? p.counts : null;
    return `<div class="card tight"><div class="day-head"><b>🏪 ${esc(m.name || t('Без названия'))}</b>
        <span class="muted small">${esc(new Date(m.created).toLocaleDateString())}</span></div>
      ${st ? `<div class="muted small">${esc(t('{a} карточек · {b} фраз · {c} вопросов · {d} сцен', { a: st.cards, b: st.phrases, c: st.quiz, d: st.scenes }))}</div>`
           : `<div class="muted small">${esc(t('Собирается…'))}</div>`}
      <div class="row" style="margin-top:8px"><button class="btn primary" data-open="${m.id}">${esc(t('Учить'))}</button>
        <button class="btn ghost" data-del="${m.id}">✕</button></div></div>`;
  }).join('');
  const v = render(`<h2>${esc(t('Моё заведение'))}</h2>
    <p class="muted small">${esc(t('Сфоткай меню ресторана или бара, где работаешь или хочешь работать. AI соберёт тренировку именно под это место: блюда, их вина и коктейли, фразы, квиз и сцены. Около минуты и ~$0,30 за заведение.'))}</p>
    <button class="btn primary wide" id="newMenu">📷 ${esc(t('Новое меню'))}</button>
    ${list ? `<h3>${esc(t('Мои заведения'))}</h3>${list}` : ''}`);
  $('#newMenu').onclick = () => { venueDraft = { images: [] }; viewVenuePhotos(); };
  v.querySelectorAll('[data-open]').forEach(b => b.onclick = () => viewPackHub(b.dataset.open));
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (b.dataset.armed) {
      S.packs = S.packs.filter(m => m.id !== b.dataset.del); delete S.packCache[b.dataset.del]; store.save(); location.reload();
    } else { b.dataset.armed = '1'; b.textContent = t('Удалить?'); }
  });
}

function codeField() {
  return S.settings.menuCode ? '' : `<label class="code-row"><span>${esc(t('Код доступа'))}</span>
    <input id="menuCode" type="text" autocomplete="off" placeholder="paella-…"></label>`;
}
function readCode() {
  const el = $('#menuCode');
  if (el && el.value.trim()) { S.settings.menuCode = el.value.trim(); store.save(); }
  return S.settings.menuCode || '';
}

function viewVenuePhotos() {
  const d = venueDraft;
  const v = render(`<div class="stat-row"><button class="btn ghost" id="back" style="min-height:0;padding:4px 10px">← ${esc(t('Назад'))}</button></div>
    <h2>📷 ${esc(t('Фото меню'))}</h2>
    <p class="muted small">${esc(t('Можно несколько фото: еда, вина, коктейли, доска с блюдами дня. Снимай ровно и при хорошем свете.'))}</p>
    <div class="thumbs">${d.images.map((src, i) => `<div class="thumb"><img src="${src}" alt=""><button data-rm="${i}">✕</button></div>`).join('')}</div>
    <label class="btn wide file-btn">＋ ${esc(t(d.images.length ? 'Ещё фото' : 'Сфоткать или выбрать'))}
      <input type="file" id="pick" accept="image/*" multiple hidden></label>
    ${codeField()}
    <div id="err"></div>
    <button class="btn primary wide" id="go" ${d.images.length ? '' : 'disabled'} style="margin-top:12px">${esc(t('Распознать меню'))}</button>`);
  $('#back').onclick = () => go('venue');
  v.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { d.images.splice(+b.dataset.rm, 1); viewVenuePhotos(); });
  $('#pick').onchange = async e => {
    for (const f of [...e.target.files].slice(0, 6 - d.images.length)) {
      try { d.images.push(await downscale(f)); } catch (err) { /* not an image */ }
    }
    viewVenuePhotos();
  };
  $('#go').onclick = async () => {
    const code = readCode();
    if (!code) { $('#err').innerHTML = `<div class="note">${esc(t('Введи код доступа'))}</div>`; return; }
    $('#go').disabled = true; $('#go').textContent = t('Читаю меню… (10–30 с)');
    try {
      d.menu = await apiPost('/menu/extract', { code, images: d.images });
      viewVenueReview();
    } catch (err) {
      if (/код/i.test(err.message) || /code/i.test(err.message)) { S.settings.menuCode = ''; store.save(); }
      $('#go').disabled = false; $('#go').textContent = t('Распознать меню');
      $('#err').innerHTML = `<div class="note">${esc(err.message)}</div>`;
    }
  };
}

function viewVenueReview() {
  const m = venueDraft.menu;
  const row = (kind, i, it) => `<div class="task"><span class="task-text">${esc(it.name)}${it.price ? ` <span class="muted small">${esc(it.price)}</span>` : ''}</span>
    <button class="btn go" data-x="${kind}:${i}">✕</button></div>`;
  const block = (title, kind) => m[kind].length ? `<div class="card"><h3 style="margin:0 0 4px">${esc(t(title))} · ${m[kind].length}</h3>
    ${m[kind].map((it, i) => row(kind, i, it)).join('')}</div>` : '';
  const total = m.food.length + m.wines.length + m.drinks.length;
  const v = render(`<h2>${esc(t('Проверь меню'))}</h2>
    <p class="muted small">${esc(t('Вот что AI прочитал на фото. Убери лишнее (✕), если что-то распознано неверно. Название можно поправить.'))}</p>
    <label class="code-row"><span>${esc(t('Название заведения'))}</span><input id="vname" type="text" value="${esc(m.name || '')}"></label>
    ${m.unreadable ? `<div class="note">${esc(m.unreadable)}</div>` : ''}
    ${block('Еда', 'food')}${block('Вина', 'wines')}${block('Напитки', 'drinks')}
    <div id="err"></div>
    <button class="btn primary wide" id="build" ${total ? '' : 'disabled'}>${esc(t('Собрать тренировку ({n} позиций)', { n: total }))}</button>
    <button class="btn ghost wide" id="redo" style="margin-top:8px">${esc(t('Переснять фото'))}</button>`);
  v.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
    const [k, i] = b.dataset.x.split(':'); m.name = $('#vname').value; m[k].splice(+i, 1); viewVenueReview();
  });
  $('#redo').onclick = viewVenuePhotos;
  $('#build').onclick = async () => {
    m.name = $('#vname').value.trim();
    $('#build').disabled = true;
    try {
      const { id } = await apiPost('/menu/build', { code: S.settings.menuCode, menu: m });
      S.packs.unshift({ id, name: m.name, created: new Date().toISOString() }); store.save();
      venueDraft = null;
      viewBuilding(id);
    } catch (err) {
      $('#build').disabled = false;
      $('#err').innerHTML = `<div class="note">${esc(err.message)}</div>`;
    }
  };
}

function viewBuilding(id) {
  render(`<h2>🏪 ${esc(t('Собираю тренировку'))}</h2>
    <div class="card center"><div class="spinner" id="prog">${esc(t('Начинаю…'))}</div>
    <p class="muted small">${esc(t('Обычно около минуты. Можно уйти с экрана — сборка идёт на сервере.'))}</p></div>`);
  pollPack(id, true);
}
async function pollPack(id, showProgress) {
  for (let i = 0; i < 90; i++) {
    let p;
    try { p = await fetchPack(id); } catch (e) { p = null; }
    if (p && p.status !== 'building') {
      if (p.status === 'ready') {
        S.packCache[id] = p;
        const meta = S.packs.find(m => m.id === id); if (meta) { meta.name = p.name || meta.name; }
        store.save(); registerPack(p);
        if (state.tab === 'venue') viewPackHub(id);
      } else if (state.tab === 'venue') {
        render(`<div class="note">${esc(t('Не получилось собрать: {e}', { e: (p.errors || []).join('; ') }))}</div>`);
      }
      return;
    }
    const el = $('#prog');
    if (showProgress && el && p) el.textContent = t('Готово частей: {n}', { n: p.progress || '0' });
    await new Promise(r => setTimeout(r, 3000));
  }
}

function viewPackHub(id) {
  const p = S.packCache[id];
  if (!p) { viewBuilding(id); return; }
  const carta = (p.decks || []).find(d => d.id.endsWith('-carta'));
  const frases = (p.decks || []).find(d => d.id.endsWith('-frases'));
  const v = render(`<div class="stat-row"><button class="btn ghost" id="back" style="min-height:0;padding:4px 10px">← ${esc(t('Мои заведения'))}</button>
      <span class="muted small">$${p.cost}</span></div>
    <h2>🏪 ${esc(p.name || t('Без названия'))}</h2>
    <div class="card">
      ${carta ? `<div class="task"><span class="task-text">🃏 ${esc(t('Карточки: меню'))} · ${p.counts.cards}</span><button class="btn go" data-act="cards">▶</button></div>` : ''}
      ${frases ? `<div class="task"><span class="task-text">🎤 ${esc(t('Вслух: фразы для этого места'))} · ${p.counts.phrases}</span><button class="btn go" data-act="speak">▶</button></div>` : ''}
      ${p.quiz ? `<div class="task"><span class="task-text">❓ ${esc(t('Квиз по меню'))} · ${p.counts.quiz}</span><button class="btn go" data-act="quiz">▶</button></div>` : ''}
      ${(p.scenes || []).map(sc => `<div class="task"><span class="task-text">🎭 ${esc(L(sc, 'title'))} <span class="pill" style="font-size:11px;padding:1px 8px">${sc.lang.toUpperCase()}</span></span>
        <button class="btn go" data-scene="${sc.id}">▶</button></div>`).join('')}
    </div>
    ${(p.errors || []).length ? `<p class="muted small">${esc(t('Часть не собралась: {e}', { e: p.errors.join('; ') }))}</p>` : ''}
    <p class="muted small">${esc(t('Состав и аллергены — типичные для такого блюда, не рецепт этой кухни. Всегда уточняй на кухне.'))}</p>`);
  $('#back').onclick = () => go('venue');
  v.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'cards') go('cards', { deck: carta.id, autostart: true });
    if (a === 'speak') go('speak', { deck: frases.id, autostart: true });
    if (a === 'quiz') go('quiz', { set: p.quiz.id });
  });
  v.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => go('scenes', { scene: b.dataset.scene }));
}

// Resume builds that were still running when the app was closed.
function resumeBuilds() {
  for (const m of S.packs) if (!S.packCache[m.id] || S.packCache[m.id].status !== 'ready') pollPack(m.id, false);
}
