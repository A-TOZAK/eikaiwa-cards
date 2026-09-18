/* 英会話カード — 記録はこの端末の localStorage にだけ保存する */
(() => {
  'use strict';
  const KEY = 'eikaiwa.v1';
  const $app = document.getElementById('app');
  const player = document.getElementById('player');
  const DEFAULTS = { onlyTodo: true, shuffle: false, en2ja: false, autoplay: true };

  let DATA = null;
  let store = loadStore();
  let session = null;   // カードをめくる回 { catId, deck, i, revealed, all }
  let listen = null;    // 聞き流しの回 { id, deck, i, step, playing }
  let wakeLock = null;

  // ── 保存 ─────────────────────────────────────────
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY)) || {};
      return { learned: s.learned || {}, opts: Object.assign({}, DEFAULTS, s.opts) };
    } catch (e) {
      return { learned: {}, opts: Object.assign({}, DEFAULTS) };
    }
  }
  function saveStore() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても使える */ }
  }
  const isLearned = (id) => !!store.learned[id];
  function setLearned(id, on) {
    if (on) store.learned[id] = Date.now(); else delete store.learned[id];
    saveStore();
  }

  // ── 小道具 ───────────────────────────────────────
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cat = (id) => DATA.categories.find((c) => c.id === id);
  const allCards = () => DATA.categories.flatMap((c) => c.cards);
  const countLearned = (cards) => cards.filter((c) => isLearned(c.id)).length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const stars = (lv) => '★'.repeat(lv);
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── 音声 ─────────────────────────────────────────
  function play(src, rate) {
    player.onended = null;
    player.src = src;
    player.playbackRate = rate || 1;
    player.onloadedmetadata = () => { player.playbackRate = rate || 1; };
    const p = player.play();
    if (p && p.catch) p.catch(() => {});
  }
  function stopAudio() {
    player.onended = null;
    player.pause();
  }
  const enSrc = (id) => `audio/en/${id}.mp3`;
  const jaSrc = (id) => `audio/ja/${id}.mp3`;
  const silSrc = (sec) => `audio/sil/sil_${Math.max(1, Math.min(10, Math.round(sec)))}.mp3`;

  // ── 画面：表紙 ───────────────────────────────────
  function viewHome() {
    const cards = allCards();
    const n = countLearned(cards);
    let html = `
      <div class="hero"><img src="img/hero.jpg" width="1400" height="933" alt="丸いテーブルを囲んで、付箋を使って授業の計画を立てる3人の先生の水彩画"></div>
      <div class="wrap">
        <header class="masthead">
          <div class="kicker" lang="en">AKI'S ENGLISH CARDS</div>
          <h1 class="ja">本番で話す英語のカード</h1>
          <p class="ja">会場で言うひとことから、いっしょに授業をつくる話までを入れています。</p>
        </header>
        <div class="total"><span class="num">${n}</span><span class="of">／ ${cards.length}枚 おぼえた</span></div>
        <div class="bar"><i style="width:${pct(n, cards.length)}%"></i></div>
        <button class="listen-all" data-go="#/l/all">
          <span>聞き流しで練習する<small>日本語、考える間、英語の順に流れます</small></span><span class="tri" aria-hidden="true">▶</span>
        </button>`;
    for (const g of DATA.groups) {
      html += `<h2 class="group">${esc(g)}</h2>`;
      for (const c of DATA.categories.filter((x) => x.group === g)) {
        const k = countLearned(c.cards);
        html += `
          <button class="shelf" data-go="#/c/${c.id}">
            <img src="${esc(c.cover)}" width="84" height="84" alt="" loading="lazy">
            <span>
              <span class="t ja">${esc(c.title)}</span><br>
              <span class="e" lang="en">${esc(c.en)}</span>
              <span class="meta"><span>${k} / ${c.cards.length}</span><span class="bar"><i style="width:${pct(k, c.cards.length)}%"></i></span></span>
            </span>
          </button>`;
      }
    }
    html += `
        <p class="foot ja">個人用の学習ページです。おぼえた印は、このスマホの中にだけ保存されます。<br>データの日付 ${esc(DATA.built)}</p>
      </div>`;
    $app.innerHTML = html;
  }

  // ── 画面：カードをめくる ─────────────────────────
  function topBar(c, tab, count) {
    return `
      <div class="top"><div class="wrap">
        <div class="row">
          <button class="back" data-go="#/">← 棚</button>
          <div class="title ja">${esc(c.title)}</div>
          <div class="count">${count}</div>
        </div>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="${tab === 'study'}" data-go="#/c/${c.id}">めくる</button>
          <button role="tab" aria-selected="${tab === 'list'}" data-go="#/c/${c.id}/list">一覧</button>
          <button role="tab" aria-selected="${tab === 'listen'}" data-go="#/l/${c.id}">聞き流し</button>
        </div>
      </div></div>`;
  }

  function startSession(catId, all) {
    const c = cat(catId);
    let deck = c.cards;
    if (store.opts.onlyTodo && !all) deck = deck.filter((x) => !isLearned(x.id));
    if (store.opts.shuffle) deck = shuffled(deck);
    session = { catId, deck, i: 0, revealed: false, all: !!all };
  }

  function viewStudy(catId) {
    const c = cat(catId);
    if (!c) return go('#/');
    if (!session || session.catId !== catId) startSession(catId, false);
    const s = session;
    const o = store.opts;
    const optsHtml = `
      <div class="opts">
        <label><input type="checkbox" data-opt="onlyTodo" ${o.onlyTodo ? 'checked' : ''}>まだのカードだけ</label>
        <label><input type="checkbox" data-opt="shuffle" ${o.shuffle ? 'checked' : ''}>まぜる</label>
        <label><input type="checkbox" data-opt="en2ja" ${o.en2ja ? 'checked' : ''}>英語から出す</label>
        <label><input type="checkbox" data-opt="autoplay" ${o.autoplay ? 'checked' : ''}>音声を自動で流す</label>
      </div>`;

    if (s.i >= s.deck.length) {
      const k = countLearned(c.cards);
      const rest = c.cards.length - k;
      $app.innerHTML = topBar(c, 'study', `${k} / ${c.cards.length}`) + `
        <div class="wrap"><div class="done">
          <div class="big">${k} / ${c.cards.length}</div>
          <p class="ja">${rest ? `この棚は、あと${rest}枚です。` : 'この棚は全部おぼえました。'}</p>
          ${rest ? '<button class="btn main" data-act="again">まだのカードをもう一度</button>' : ''}
          <button class="btn" data-act="again-all">全部のカードでもう一度</button>
          <button class="btn" data-go="#/">棚にもどる</button>
        </div></div>`;
      return;
    }

    const card = s.deck[s.i];
    const front = o.en2ja
      ? `<p class="q" lang="en">${esc(card.en)}</p>`
      : `<p class="q ja">${esc(card.ja)}</p>`;
    const audioBtns = `
      <div class="audio">
        <button data-act="play">▶ 聞く</button>
        <button data-act="slow">ゆっくり聞く</button>
      </div>`;
    let body = front;
    if (o.en2ja) body += audioBtns;
    if (!s.revealed) {
      body += `<p class="hint ja">${o.en2ja ? '意味を思いうかべてから、下のボタンを押します。' : '英語で言ってみてから、下のボタンを押します。'}</p>`;
    } else {
      body += '<hr>';
      body += o.en2ja ? `<p class="a ja">${esc(card.ja)}</p>` : `<p class="a" lang="en">${esc(card.en)}</p>${audioBtns}`;
      if (card.alt) body += `<p class="alt ja">ほかの言い方　<b lang="en">${esc(card.alt)}</b></p>`;
      if (card.words && card.words.length) {
        body += '<ul class="words">' + card.words.map((w) => `<li><span lang="en">${esc(w[0])}</span><span class="ja">${esc(w[1])}</span></li>`).join('') + '</ul>';
      }
      if (card.note) body += `<p class="note ja">${esc(card.note)}</p>`;
    }

    $app.innerHTML = topBar(c, 'study', `${s.i + 1} / ${s.deck.length}`) + `
      <div class="wrap study">
        ${optsHtml}
        <article class="card" data-act="${s.revealed ? '' : 'reveal'}">
          <div class="scene"><span class="ja">${esc(card.scene)}${isLearned(card.id) ? '<span class="learned-mark">おぼえた</span>' : ''}</span><span class="lv" aria-label="むずかしさ ${card.lv}">${stars(card.lv)}</span></div>
          ${body}
        </article>
      </div>
      <div class="actions"><div class="wrap ${s.revealed ? '' : 'one'}">
        ${s.revealed
          ? '<button class="btn" data-act="todo">まだ</button><button class="btn main" data-act="learned">おぼえた</button>'
          : `<button class="btn main" data-act="reveal">${o.en2ja ? '意味を見る' : '英語を見る'}</button>`}
      </div></div>`;
    window.scrollTo(0, 0);
  }

  // ── 画面：一覧 ───────────────────────────────────
  function viewList(catId) {
    const c = cat(catId);
    if (!c) return go('#/');
    const k = countLearned(c.cards);
    $app.innerHTML = topBar(c, 'list', `${k} / ${c.cards.length}`) + `
      <div class="wrap"><div class="rows">
        ${c.cards.map((x) => `
          <div class="row-card">
            <button style="text-align:left" data-act="play-id" data-id="${x.id}">
              <div class="en" lang="en">${esc(x.en)}</div>
              <div class="jp ja">${esc(x.ja)}</div>
            </button>
            <button class="check" data-act="toggle" data-id="${x.id}" aria-pressed="${isLearned(x.id)}" aria-label="おぼえた">✓</button>
          </div>`).join('')}
      </div></div>`;
  }

  // ── 画面：聞き流し ───────────────────────────────
  const STEPS = [
    { label: '日本語を聞く', show: false },
    { label: '英語で言ってみる', show: false },
    { label: '答え', show: true },
    { label: 'まねして言う', show: true },
    { label: 'もう一度', show: true },
    { label: 'まねして言う', show: true },
  ];

  function startListen(id) {
    const cards = id === 'all' ? allCards() : (cat(id) || { cards: [] }).cards;
    const todo = cards.filter((x) => !isLearned(x.id));
    listen = { id, deck: todo.length ? todo : cards, i: 0, step: 0, playing: false };
  }

  function viewListen(id) {
    if (id !== 'all' && !cat(id)) return go('#/');
    if (!listen || listen.id !== id) startListen(id);
    const L = listen;
    const card = L.deck[L.i];
    const st = STEPS[L.step];
    const head = id === 'all'
      ? `<div class="top"><div class="wrap"><div class="row">
           <button class="back" data-go="#/">← 棚</button><div class="title ja">聞き流し（全部の棚）</div>
           <div class="count">${L.i + 1} / ${L.deck.length}</div></div></div></div>`
      : topBar(cat(id), 'listen', `${L.i + 1} / ${L.deck.length}`);
    $app.innerHTML = head + `
      <div class="wrap listen">
        <div class="now">
          <div class="step ja">${L.playing ? esc(st.label) : '止まっています'}</div>
          <p class="jp ja">${esc(card.ja)}</p>
          <p class="en ${st.show || !L.playing ? '' : 'hide'}" lang="en">${esc(card.en)}</p>
        </div>
        <p class="how ja">日本語、考える間、英語、まねる間の順に流れます。画面は見なくてかまいません。</p>
      </div>
      <div class="actions ctrl"><div class="wrap">
        <button class="btn" data-act="l-prev">前へ</button>
        <button class="btn main" data-act="l-toggle">${L.playing ? '止める' : '流す'}</button>
        <button class="btn" data-act="l-next">次へ</button>
        <button class="btn sub" data-act="l-learned" aria-pressed="${isLearned(card.id)}">${isLearned(card.id) ? 'おぼえた（印あり）' : 'このカードはおぼえた'}</button>
      </div></div>`;
  }

  function listenPlayStep() {
    const L = listen;
    if (!L || !L.playing) return;
    const card = L.deck[L.i];
    const gapThink = card.dur_en * 1.3 + 1.2;
    const gapRepeat = card.dur_en * 1.2 + 0.8;
    const src = [jaSrc(card.id), silSrc(gapThink), enSrc(card.id), silSrc(gapRepeat), enSrc(card.id), silSrc(gapRepeat)][L.step];
    player.src = src;
    player.playbackRate = 1;
    player.onended = () => {           // 次の音をこの中ですぐ流す（画面を消しても止まりにくくする）
      L.step += 1;
      if (L.step >= STEPS.length) { L.step = 0; L.i = (L.i + 1) % L.deck.length; }
      listenPlayStep();
      if (location.hash.startsWith('#/l/')) viewListen(L.id);
    };
    const p = player.play();
    if (p && p.catch) p.catch(() => { L.playing = false; viewListen(L.id); });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: card.en, artist: '英会話カード', album: card.ja });
    }
  }
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* 使えない端末ではそのまま */ }
  }
  function listenToggle(on) {
    const L = listen;
    L.playing = on;
    if (on) { listenPlayStep(); keepAwake(true); } else { stopAudio(); keepAwake(false); }
    viewListen(L.id);
  }
  function listenMove(d) {
    const L = listen;
    L.i = (L.i + d + L.deck.length) % L.deck.length;
    L.step = 0;
    if (L.playing) listenPlayStep(); else stopAudio();
    viewListen(L.id);
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => listen && listenToggle(true));
    navigator.mediaSession.setActionHandler('pause', () => listen && listenToggle(false));
    navigator.mediaSession.setActionHandler('nexttrack', () => listen && listenMove(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => listen && listenMove(-1));
  }

  // ── 行き先 ───────────────────────────────────────
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts[0] !== 'l' && listen) { listen.playing = false; stopAudio(); keepAwake(false); listen = null; }
    if (parts[0] !== 'c') session = null;
    if (parts[0] === 'c' && parts[2] === 'list') { stopAudio(); return viewList(parts[1]); }
    if (parts[0] === 'c' && parts[1]) return viewStudy(parts[1]);
    if (parts[0] === 'l' && parts[1]) return viewListen(parts[1]);
    stopAudio();
    viewHome();
    window.scrollTo(0, 0);
  }

  // ── 操作 ─────────────────────────────────────────
  function reveal() {
    const s = session;
    if (!s || s.revealed) return;
    s.revealed = true;
    const card = s.deck[s.i];
    viewStudy(s.catId);
    if (store.opts.autoplay && !store.opts.en2ja) play(enSrc(card.id), 1);
  }
  function next(learned) {
    const s = session;
    const card = s.deck[s.i];
    setLearned(card.id, learned);
    s.i += 1;
    s.revealed = false;
    viewStudy(s.catId);
    const nextCard = s.deck[s.i];
    if (nextCard && store.opts.autoplay && store.opts.en2ja) play(enSrc(nextCard.id), 1); else stopAudio();
  }

  document.addEventListener('click', (ev) => {
    const goEl = ev.target.closest('[data-go]');
    if (goEl) { ev.preventDefault(); return go(goEl.dataset.go); }
    const el = ev.target.closest('[data-act]');
    if (!el || !el.dataset.act) return;
    const act = el.dataset.act;
    const s = session;
    if (act === 'reveal') return reveal();
    if (act === 'learned') return next(true);
    if (act === 'todo') return next(false);
    if (act === 'play' || act === 'slow') { ev.stopPropagation(); return play(enSrc(s.deck[s.i].id), act === 'slow' ? 0.7 : 1); }
    if (act === 'again') { startSession(s.catId, false); return viewStudy(s.catId); }
    if (act === 'again-all') { startSession(s.catId, true); return viewStudy(s.catId); }
    if (act === 'play-id') return play(enSrc(el.dataset.id), 1);
    if (act === 'toggle') {
      setLearned(el.dataset.id, !isLearned(el.dataset.id));
      return viewList(location.hash.split('/')[2]);
    }
    if (act === 'l-toggle') return listenToggle(!listen.playing);
    if (act === 'l-next') return listenMove(1);
    if (act === 'l-prev') return listenMove(-1);
    if (act === 'l-learned') {
      const card = listen.deck[listen.i];
      setLearned(card.id, !isLearned(card.id));
      return viewListen(listen.id);
    }
  });

  document.addEventListener('change', (ev) => {
    const key = ev.target.dataset && ev.target.dataset.opt;
    if (!key) return;
    store.opts[key] = ev.target.checked;
    saveStore();
    if (session) { startSession(session.catId, false); viewStudy(session.catId); }
  });

  document.addEventListener('keydown', (ev) => {
    if (!session || ev.target.tagName === 'INPUT') return;
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!session.revealed) reveal(); }
    if (session.revealed && ev.key === 'ArrowRight') next(true);
    if (session.revealed && ev.key === 'ArrowLeft') next(false);
  });

  window.addEventListener('hashchange', route);

  fetch('data/cards.json?d=' + Date.now())
    .then((r) => r.json())
    .then((d) => { DATA = d; route(); })
    .catch(() => { $app.innerHTML = '<div class="wrap"><p class="ja" style="padding:40px 0">カードのデータを読みこめませんでした。電波のあるところで、もう一度開いてください。</p></div>'; });
})();
