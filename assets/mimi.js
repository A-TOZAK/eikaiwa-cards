/* 耳のドリル — 聞いた印と、どこまで聞いたかは、この端末の localStorage にだけ保存する */
(() => {
  'use strict';
  const KEY = 'eikaiwa.mimi.v1';
  const $app = document.getElementById('app');
  const $bar = document.getElementById('bar');
  const player = document.getElementById('player');
  const RATES = [0.8, 1, 1.2];
  const KIND = { drill: 'ドリル', shower: 'シャワー' };

  let DATA = null;
  let queue = [];        // [{ ep, kind }] 第1回ドリル → 第1回シャワー → 第2回ドリル …
  let cur = -1;          // いま入っている queue の番号
  let store = load();
  let lastSave = 0;

  // ── 保存 ─────────────────────────────────────────
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY)) || {};
      return { pos: s.pos || null, done: s.done || {}, rate: s.rate || 1 };
    } catch (e) {
      return { pos: null, done: {}, rate: 1 };
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても聞ける */ }
  }

  // ── 小道具 ───────────────────────────────────────
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  const keyOf = (q) => `${q.ep.id}_${q.kind}`;
  const label = (q) => `第${q.ep.n}回 ${KIND[q.kind]}`;
  const findIdx = (id, kind) => queue.findIndex((q) => q.ep.id === id && q.kind === kind);

  // ── 再生 ─────────────────────────────────────────
  function setTrack(idx, at, autoplay) {
    if (idx < 0 || idx >= queue.length) return;
    const q = queue[idx];
    const changed = idx !== cur;
    cur = idx;
    if (changed) {
      player.src = q.ep.files[q.kind].src;
      player.load();
    }
    const seekTo = at || 0;
    const start = () => {
      if (seekTo) { try { player.currentTime = seekTo; } catch (e) { /* まだ読めていない */ } }
      player.playbackRate = store.rate;
    };
    if (player.readyState >= 1) start(); else player.addEventListener('loadedmetadata', start, { once: true });
    store.pos = { idx, t: seekTo };
    save();
    mediaMeta(q);
    if (autoplay) {
      const p = player.play();
      if (p && p.catch) p.catch(() => {});
    }
    renderBar();
    markRows();
  }
  function toggle() {
    if (cur < 0) return resume();
    if (player.paused) {
      player.playbackRate = store.rate;
      const p = player.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      player.pause();
    }
  }
  function resume() {
    const pos = store.pos;
    if (pos && pos.idx < queue.length) return setTrack(pos.idx, pos.t, true);
    const firstTodo = queue.findIndex((q) => !store.done[keyOf(q)]);
    setTrack(firstTodo < 0 ? 0 : firstTodo, 0, true);
  }
  function skip(sec) {
    if (cur < 0) return;
    player.currentTime = Math.max(0, Math.min((player.duration || 0) - 0.5, player.currentTime + sec));
  }
  function nextTrack() { if (cur + 1 < queue.length) setTrack(cur + 1, 0, true); }
  function prevTrack() {
    if (player.currentTime > 5 || cur <= 0) { player.currentTime = 0; return; }
    setTrack(cur - 1, 0, true);
  }
  function cycleRate() {
    const i = RATES.indexOf(store.rate);
    store.rate = RATES[(i + 1) % RATES.length];
    player.playbackRate = store.rate;
    save();
    renderBar();
  }

  player.addEventListener('timeupdate', () => {
    if (cur < 0) return;
    const now = Date.now();
    if (now - lastSave > 4000) {
      store.pos = { idx: cur, t: Math.max(0, player.currentTime - 2) };
      save();
      lastSave = now;
    }
    updateProgress();
  });
  player.addEventListener('play', renderBar);
  player.addEventListener('pause', () => {
    if (cur >= 0) { store.pos = { idx: cur, t: player.currentTime }; save(); }
    renderBar();
  });
  player.addEventListener('ended', () => {
    const q = queue[cur];
    store.done[keyOf(q)] = Date.now();
    save();
    markRows();
    if (cur + 1 < queue.length) setTrack(cur + 1, 0, true);
    else { store.pos = null; save(); renderBar(); }
  });

  // ロック画面・イヤホンからの操作
  function mediaMeta(q) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${label(q)}　${q.ep.title}`,
        artist: q.kind === 'drill' ? '耳のドリル' : '英語のシャワー',
        album: '耳のドリル',
        artwork: [{ src: 'img/icon-180.png', sizes: '180x180', type: 'image/png' }],
      });
    } catch (e) { /* 対応していない端末 */ }
  }
  if ('mediaSession' in navigator) {
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* 未対応 */ } };
    set('play', () => toggle());
    set('pause', () => player.pause());
    set('seekbackward', () => skip(-10));
    set('seekforward', () => skip(10));
    set('previoustrack', () => prevTrack());
    set('nexttrack', () => nextTrack());
  }

  // ── 下の再生帯 ───────────────────────────────────
  function renderBar() {
    if (cur < 0) { $bar.hidden = true; return; }
    const q = queue[cur];
    $bar.hidden = false;
    $bar.innerHTML = `
      <div class="wrap">
        <div class="pinfo">
          <span class="pt ja">${esc(label(q))}　${esc(q.ep.title)}</span>
          <span class="ptime"><span id="tnow">${mmss(player.currentTime)}</span> / ${mmss(q.ep.files[q.kind].sec)}</span>
        </div>
        <input id="seek" class="seek" type="range" min="0" max="${Math.floor(q.ep.files[q.kind].sec)}" step="1" value="${Math.floor(player.currentTime)}" aria-label="再生する位置">
        <div class="pctl">
          <button data-act="back10" aria-label="10秒もどる">10秒<br>もどる</button>
          <button data-act="prev" aria-label="前へ">⏮</button>
          <button data-act="toggle" class="pplay" aria-label="${player.paused ? '再生' : '一時停止'}">${player.paused ? '▶' : '❚❚'}</button>
          <button data-act="next" aria-label="次へ">⏭</button>
          <button data-act="rate" aria-label="速さを変える">${store.rate === 1 ? 'ふつう' : store.rate + '倍'}</button>
        </div>
      </div>`;
  }
  function updateProgress() {
    const t = document.getElementById('tnow');
    const s = document.getElementById('seek');
    if (t) t.textContent = mmss(player.currentTime);
    if (s && !s.matches(':active')) s.value = Math.floor(player.currentTime);
  }
  $bar.addEventListener('input', (ev) => {
    if (ev.target.id === 'seek') player.currentTime = Number(ev.target.value);
  });

  // ── 画面：一覧 ───────────────────────────────────
  function resumeText() {
    const pos = store.pos;
    if (pos && pos.idx < queue.length) {
      const q = queue[pos.idx];
      return `${label(q)}　${q.ep.title}　${mmss(pos.t)}から`;
    }
    const i = queue.findIndex((q) => !store.done[keyOf(q)]);
    return i < 0 ? '全部聞きました。第1回から聞き直せます' : `${label(queue[i])}　${queue[i].ep.title}から`;
  }
  function viewHome() {
    const eps = DATA.episodes;
    const doneN = queue.filter((q) => store.done[keyOf(q)]).length;
    let html = `
      <div class="wrap">
        <div class="top-link"><a href="index.html">← 英会話カード</a></div>
        <header class="masthead">
          <div class="kicker" lang="en">LISTENING DRILL</div>
          <h1 class="ja"><span class="nb">耳のドリルと</span><span class="nb">英語のシャワー</span></h1>
          <p class="ja">ネイティブの英語を聞き取る耳をつくる番組です。1回はドリル約10分とシャワー約11分の2本です。画面を消しても流れつづけ、終わると次へ進みます。</p>
        </header>
        <div class="total"><span class="num">${doneN}</span><span class="of">／ ${queue.length}本 聞いた</span></div>
        <div class="bar"><i style="width:${queue.length ? Math.round((doneN / queue.length) * 100) : 0}%"></i></div>
        <button class="listen-all" data-act="resume">
          <span>つづきから聞く<small class="ja">${esc(resumeText())}</small></span><span class="tri" aria-hidden="true">▶</span>
        </button>
        <details class="how">
          <summary>2本のちがい</summary>
          <p class="ja"><b>ドリル</b>は、会話を聞いて、一文ずつ英語と日本語で確かめ、音のつながりを練習する回です。まねする間が入っています。</p>
          <p class="ja"><b>シャワー</b>は、同じ話題を6人の先生が話すのを、ほぼ英語だけで聞く回です。国ごとの英語を聞きなれるのがねらいです。</p>
        </details>
        <h2 class="group">全${eps.length}回</h2>`;
    for (const e of eps) {
      html += `
        <section class="ep" id="${e.id}">
          <div class="eh"><span class="en-n">第${e.n}回</span><span class="t ja">${esc(e.title)}</span></div>
          <div class="btns">
            ${['drill', 'shower'].map((k) => `
              <button class="pbtn" data-play="${e.id}/${k}">
                <span class="k">${KIND[k]}</span><span class="d">${mmss(e.files[k].sec)}</span><span class="ok" data-done="${e.id}_${k}">${store.done[`${e.id}_${k}`] ? '聞いた' : ''}</span>
              </button>`).join('')}
          </div>
          <a class="tx-link" href="#/t/${e.id}">台本を見る</a>
        </section>`;
    }
    html += `
        <p class="foot ja">個人用の学習ページです。聞いた印とつづきの位置は、このスマホの中にだけ保存されます。<br>英語の声はマイクロソフトの読み上げ、日本語の声はボイスピークです。<br>データの日付 ${esc(DATA.built)}</p>
      </div>`;
    $app.innerHTML = html;
    markRows();
  }
  function markRows() {
    document.querySelectorAll('.pbtn').forEach((b) => {
      const [id, k] = b.dataset.play.split('/');
      const on = cur >= 0 && queue[cur].ep.id === id && queue[cur].kind === k;
      b.classList.toggle('now', on);
      const ok = b.querySelector('.ok');
      if (ok) ok.textContent = store.done[`${id}_${k}`] ? '聞いた' : '';
    });
  }

  // ── 画面：台本 ───────────────────────────────────
  function viewScript(id) {
    const e = DATA.episodes.find((x) => x.id === id);
    if (!e) return go('#/');
    const html = `
      <div class="top"><div class="wrap"><div class="row">
        <button class="back" data-go="#/">← 一覧</button>
        <div class="title ja">第${e.n}回 ${esc(e.title)}</div>
      </div></div></div>
      <div class="wrap tx">
        <div class="btns">
          <button class="pbtn" data-play="${e.id}/drill"><span class="k">ドリル</span><span class="d">${mmss(e.files.drill.sec)}</span></button>
          <button class="pbtn" data-play="${e.id}/shower"><span class="k">シャワー</span><span class="d">${mmss(e.files.shower.sec)}</span></button>
        </div>
        <p class="scene ja">${esc(e.scene)}</p>
        <h3>聞きどころ</h3>
        <p class="ja">${esc(e.q)}</p>
        <details><summary>答え</summary><p class="ja">${esc(e.a)}</p></details>
        <h3>会話</h3>
        <ol class="lines">
          ${e.dialogue.map((l) => `<li><span class="who" lang="en">${esc(l.who)}</span><span class="en" lang="en">${esc(l.en)}</span><span class="jp ja">${esc(l.ja)}</span></li>`).join('')}
        </ol>
        <h3>音のつながり</h3>
        <ol class="sounds">
          ${e.sounds.map((s) => `<li><b class="ja">${esc(s.point)}</b><span class="en" lang="en">${esc(s.natural)}</span><span class="jp ja">${esc(s.explain)}</span></li>`).join('')}
        </ol>
        ${e.humor ? `
        <h3>笑いのポイント　<span class="ja">${esc(e.humor.technique)}</span></h3>
        <div class="humor">
          <p><span class="who" lang="en">${esc(e.humor.joke.who)}</span><br><span class="en" lang="en">${esc(e.humor.joke.en)}</span></p>
          <p class="jp ja">${esc(e.humor.why)}</p>
          <p class="jp ja">${esc(e.humor.cue)}</p>
          <ol class="sounds">
            ${e.humor.responses.map((r) => `<li><span class="en" lang="en">${esc(r.en)}</span><span class="jp ja">${esc(r.ja)}</span></li>`).join('')}
            <li><b class="ja">アキの持ちネタ</b><span class="en" lang="en">${esc(e.humor.aki.en)}</span><span class="jp ja">${esc(e.humor.aki.ja)}</span></li>
          </ol>
        </div>` : ''}
        <h3>シャワー <span lang="en">${esc(e.shower.topic_en)}</span></h3>
        ${e.shower.talks.map((t) => `
          <details class="talk">
            <summary><span lang="en">${esc(t.who)}</span>　<small lang="en">${esc(t.from)}</small><br><span class="jp ja">${esc(t.gist)}</span></summary>
            <p lang="en">${esc(t.en)}</p>
          </details>`).join('')}
      </div>`;
    $app.innerHTML = html;
    window.scrollTo(0, 0);
    markRows();
  }

  // ── 行き先 ───────────────────────────────────────
  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 't' && parts[1]) return viewScript(parts[1]);
    viewHome();
  }
  window.addEventListener('hashchange', route);

  document.addEventListener('click', (ev) => {
    const goEl = ev.target.closest('[data-go]');
    if (goEl) { ev.preventDefault(); return go(goEl.dataset.go); }
    const pl = ev.target.closest('[data-play]');
    if (pl) {
      const [id, k] = pl.dataset.play.split('/');
      const idx = findIdx(id, k);
      if (idx === cur) return toggle();
      const pos = store.pos;
      return setTrack(idx, pos && pos.idx === idx ? pos.t : 0, true);
    }
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'resume') return resume();
    if (act === 'toggle') return toggle();
    if (act === 'back10') return skip(-10);
    if (act === 'next') return nextTrack();
    if (act === 'prev') return prevTrack();
    if (act === 'rate') return cycleRate();
  });

  fetch('data/mimi.json?d=' + Date.now())
    .then((r) => r.json())
    .then((d) => {
      DATA = d;
      queue = d.episodes.flatMap((ep) => [{ ep, kind: 'drill' }, { ep, kind: 'shower' }]);
      const pos = store.pos;
      if (pos && pos.idx < queue.length) setTrack(pos.idx, pos.t, false);
      route();
    })
    .catch(() => { $app.innerHTML = '<div class="wrap"><p class="ja">データを読みこめませんでした。電波のよいところで開き直してください。</p></div>'; });
})();
