(function () {
  'use strict';

  var L = window.KanjiLogic;
  var S = window.KanjiSound;
  var FX = window.KanjiFx;
  var KEYS = {
    config: 'kt_config',
    questions: 'kt_questions',
    log: 'kt_log',
    outbox: 'kt_outbox',
    session: 'kt_session',
    demoDevice: 'kt_demo_device',
    reconciled: 'kt_reconciled'
  };
  var PRAISE = ['せいかい！', 'いいね！', 'ナイス！', 'そのとおり！', 'やったね！'];
  var app = document.getElementById('app');
  var screen = '';
  var installPrompt = null;
  var esc = L.escapeHtml;

  /* ---------- ほぞん ---------- */
  function load(k, fallback) {
    try {
      var v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function today() { return L.localDate(new Date()); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  // おためし専用の端末（親のスマホやPC）。答えても記録しない
  function isDemoDevice() { return load(KEYS.demoDevice, false) === true; }
  function getConfig() {
    var c = load(KEYS.config, null);
    return c && c.url && c.key ? c : null;
  }

  // せっていリンク（#u=...&k=...）で開いたときに保存する。# 以降はサーバーに送られない
  function readHashConfig() {
    var h = location.hash.slice(1);
    if (!h) return false;
    var p = new URLSearchParams(h);
    var u = p.get('u'), k = p.get('k');
    history.replaceState(null, '', location.pathname + location.search);
    if (u && k) {
      save(KEYS.config, { url: u, key: k });
      if (p.get('d') === '1') save(KEYS.demoDevice, true);
      return true;
    }
    return false;
  }

  /* ---------- つうしん ---------- */
  function api(action, extra, timeoutMs) {
    var cfg = getConfig();
    if (!cfg) return Promise.reject(new Error('no-config'));
    var body = Object.assign({ key: cfg.key, action: action }, extra || {});
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    // 文字列を送ると text/plain になり、Apps Script でも事前確認なしで通る
    return fetch(cfg.url, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        clearTimeout(timer);
        if (!d || !d.ok) throw new Error((d && d.error) || 'error');
        return d;
      }, function (e) { clearTimeout(timer); throw e; });
  }

  function questions() {
    var c = load(KEYS.questions, null);
    return c && c.items ? c.items : [];
  }
  function refreshQuestions() {
    return api('questions').then(function (d) {
      save(KEYS.questions, { at: new Date().toISOString(), items: d.items || [] });
      return d.items || [];
    });
  }

  var syncing = null;
  function syncNow() {
    if (syncing) return syncing;
    if (!getConfig() || navigator.onLine === false) return Promise.resolve(false);
    var box = load(KEYS.outbox, []);
    if (!box.length) return Promise.resolve(true);
    var batch = box.slice(0, 200);
    syncing = api('log', { rows: batch }, 25000).then(function (d) {
      var ok = {};
      (d.ids || []).forEach(function (id) { ok[id] = true; });
      var rest = load(KEYS.outbox, []).filter(function (r) { return !ok[r.id]; });
      save(KEYS.outbox, rest);
      syncing = null;
      if (rest.length && batch.length === 200) return syncNow();
      return true;
    }).catch(function () { syncing = null; return false; });
    return syncing;
  }

  // シートの「結果」を正にして、端末の記録をそろえる（ひらいたとき1日1回。「おうちのひと」のボタンでは いつでも）
  // シートで消した記録は端末からも消え、シートにあって端末にない記録は足される
  // まだ送れていない記録と、そろえているあいだに答えた記録はのこす
  function reconcileLog(force) {
    if (!getConfig()) return Promise.reject(new Error('no-config'));
    var t = today();
    // 端末の記録が空のとき（機種変更やデータ消去のあと）は、その日にそろえていても もう一度シートから戻す
    if (!force && load(KEYS.reconciled, '') === t && load(KEYS.log, []).length) return Promise.resolve(null);
    var before = {};
    load(KEYS.log, []).forEach(function (r) { before[r.id] = true; });
    return syncNow().then(function () { return api('history', {}, 25000); }).then(function (d) {
      var rows = d.rows || [];
      var keep = {};
      rows.forEach(function (r) { keep[r.id] = true; });
      var extra = load(KEYS.outbox, []).concat(load(KEYS.log, []).filter(function (r) { return !before[r.id]; }));
      var merged = rows.slice();
      extra.forEach(function (r) { if (!keep[r.id]) { keep[r.id] = true; merged.push(r); } });
      save(KEYS.log, merged);
      // 問題のとちゅうでなければ、シートにない回の続きと、まだ1問も答えていない回は作りなおす
      var s = load(KEYS.session, null);
      if (s && screen !== 'quiz' &&
          (!s.idx || !merged.some(function (r) { return r.sid === s.sid; }))) save(KEYS.session, null);
      save(KEYS.reconciled, t);
      return merged.length;
    });
  }

  // おためし専用の端末は、いつもシートの最新の記録を写して、その日の本番と同じ出題にする
  function loadHistory(force) {
    if (!isDemoDevice()) return reconcileLog(!!force).catch(function () { return null; });
    return syncNow().then(function () { return api('history', {}, 25000); }).then(function (d) {
      save(KEYS.log, d.rows || []);
      return true;
    }).catch(function () { return false; });
  }

  function demoBanner(canStop) {
    return '<div class="demo-banner" role="note"><span>おためし中：きろくしません</span>' +
      (canStop ? '<button class="text-btn" data-act="stop-demo">やめる</button>' : '') + '</div>';
  }

  function addRecord(rec) {
    var log = load(KEYS.log, []);
    log.push(rec);
    save(KEYS.log, log);
    var box = load(KEYS.outbox, []);
    box.push(rec);
    save(KEYS.outbox, box);
  }

  /* ---------- がめん：ホーム ---------- */
  function renderHome(notice) {
    if (reloadPending) { location.reload(); return; }
    screen = 'home';
    FX.clear();
    var t = today();
    var stats = L.dayStats(load(KEYS.log, []), t);
    var stamps = '';
    for (var i = 13; i >= 0; i--) {
      var d = L.addDays(t, -i);
      var done = stats.days[d];
      var cls = 'stamp' + (done ? ' is-done' : '') + (i === 0 ? ' is-today' : '');
      var label = done ? '⚽' : String(Number(d.slice(8)));
      stamps += '<li class="' + cls + '" aria-label="' + esc(d) + (done ? ' できた' : '') + '">' + label + '</li>';
    }
    var hasQ = questions().length > 0;
    var action;
    if (!hasQ) {
      action = '<p class="notice">もんだいを まだ よみこめていません。インターネットに つないで、もういちど ひらいてね。</p>' +
        '<button class="chunky go start" data-act="retry">よみこむ</button>';
    } else if (isDemoDevice()) {
      action = '<button class="chunky go start" data-act="start">おためしスタート<small>きょうの 30もん</small></button>';
    } else {
      // 毎日の目標は1回。2〜15回目は、やりたいときのおまけ
      var s = load(KEYS.session, null);
      var resume = s && s.date === t && s.idx > 0 && s.idx < s.items.length;
      var games = L.gamesOn(load(KEYS.log, []), t);
      if (resume) {
        action = (games ? '<p class="done-note">きょう ' + games + 'かい やったよ</p>' : '') +
          '<button class="chunky go start" data-act="start">つづきから<small>' + (s.idx + 1) + 'もんめから</small></button>';
      } else if (games >= L.MAX_GAMES) {
        action = '<p class="done-note">きょうは ' + games + 'かい やったね！<span>また あした やろうね</span></p>';
      } else if (games > 0) {
        action = '<p class="done-note">きょうの ぶんは クリア！<span>もっと やるなら、あと ' + (L.MAX_GAMES - games) + 'かい できるよ</span></p>' +
          '<button class="chunky start more" data-act="start">もう1かい<small>きょう ' + (games + 1) + 'かいめ</small></button>';
      } else {
        action = '<button class="chunky go start" data-act="start">スタート<small>30もん</small></button>';
      }
    }
    app.innerHTML =
      '<section class="home">' +
      (isDemoDevice() ? demoBanner(false) : '') +
      '<h1 class="title">よみの れんしゅう<small>かんじを よんでみよう</small></h1>' +
      (notice ? '<p class="notice">' + esc(notice) + '</p>' : '') +
      '<ol class="stamps" aria-label="さいきんの 14にち">' + stamps + '</ol>' +
      '<div class="stats">' +
      '<div class="stat"><span>れんぞく</span><b>' + stats.streak + '</b><i>にち</i></div>' +
      '<div class="stat"><span>ぜんぶで</span><b>' + stats.total + '</b><i>にち</i></div>' +
      '</div>' +
      action +
      '<div class="foot">' +
      '<button class="text-btn" data-act="sound" aria-pressed="' + S.enabled() + '">' + soundLabel() + '</button>' +
      '<button class="text-btn" data-act="fx" aria-pressed="' + FX.enabled() + '">' + fxLabel() + '</button>' +
      '<button class="text-btn" data-act="parent">おうちのひと</button>' +
      '</div>' +
      '</section>';
    app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-act');
        if (a === 'start') { S.unlock(); startSession(); }
        else if (a === 'sound') {
          S.setEnabled(!S.enabled());
          b.setAttribute('aria-pressed', String(S.enabled()));
          b.textContent = soundLabel();
          if (S.enabled()) S.play('correct');
        }
        else if (a === 'fx') {
          FX.setEnabled(!FX.enabled());
          b.setAttribute('aria-pressed', String(FX.enabled()));
          b.textContent = fxLabel();
          if (FX.active()) {
            var r = b.getBoundingClientRect();
            FX.burst(r.left + r.width / 2, r.top + r.height / 2, 12, 80, 600);
          }
        }
        else if (a === 'parent') renderParent();
        else if (a === 'retry') {
          b.disabled = true;
          refreshQuestions().then(function () { renderHome(); },
            function () { renderHome('まだ つながりません。インターネットを たしかめてね。'); });
        }
      });
    });
  }

  function soundLabel() { return S.enabled() ? '🔊 おと オン' : '🔇 おと オフ'; }
  function fxLabel() { return FX.enabled() ? '✨ うごき オン' : '・ うごき オフ'; }

  /* ---------- がめん：もんだい ---------- */
  var session = null;
  var shownAt = 0, hiddenAt = 0, answered = false, hintUsed = false;
  // 画面が出てから WAIT_MS のあいだのタップは受け付けない（前の画面で押した指がそのまま当たるのを防ぐ）
  var WAIT_MS = 500;
  var blockedTaps = 0;
  function holdTaps(box) {
    var until = performance.now() + WAIT_MS;
    box.classList.add('is-wait');
    setTimeout(function () { box.classList.remove('is-wait'); }, WAIT_MS);
    return function () {
      if (performance.now() < until) { blockedTaps++; return false; }
      return true;
    };
  }

  function startSession() {
    if (isDemoDevice()) { startDemo(false); return; }
    var t = today();
    var s = load(KEYS.session, null);
    if (s && s.date === t && s.idx < s.items.length) {
      session = s;
    } else {
      if (L.gamesOn(load(KEYS.log, []), t) >= L.MAX_GAMES) { renderHome(); return; }
      var items = L.buildSession(questions(), load(KEYS.log, []), t);
      if (!items.length) { renderHome('もんだいが ありません。おうちのひとに きいてね。'); return; }
      session = { sid: uuid(), date: t, items: items, idx: 0, results: [] };
      save(KEYS.session, session);
    }
    renderQuiz();
  }

  // おためし：その日の本番と同じ決め方で出題し、記録はしない
  function startDemo(oneTime) {
    var t = today();
    var s = isDemoDevice() ? null : load(KEYS.session, null);
    var items = s && s.date === t && s.idx < s.items.length ?
      JSON.parse(JSON.stringify(s.items)) : L.buildSession(questions(), load(KEYS.log, []), t);
    if (!items.length) { renderParent('問題がありません。問題を読みなおしてください。'); return; }
    S.unlock();
    session = { sid: 'demo', date: t, items: items, idx: 0, results: [], demo: true, oneTime: oneTime };
    renderQuiz();
  }

  function stopDemo() {
    var oneTime = session && session.oneTime;
    session = null;
    if (oneTime) renderParent(); else renderHome();
  }

  function ballLeft(done, total) {
    return (4 + 86 * (total ? done / total : 0)).toFixed(1) + '%';
  }

  function renderQuiz() {
    screen = 'quiz';
    var it = session.items[session.idx];
    var total = session.items.length;
    answered = false;
    hintUsed = false;
    app.innerHTML =
      '<section class="quiz">' +
      (session.demo ? demoBanner(true) : '') +
      '<div class="topbar">' +
      '<div class="pitch" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + session.idx + '">' +
      '<span class="goal"></span><span class="ball" style="left:' + ballLeft(session.idx, total) + '">⚽</span></div>' +
      '<span class="count">' + (session.idx + 1) + ' / ' + total + '</span>' +
      '</div>' +
      (it.source === '日記' ? '<p class="badge">きみの日記から</p>' : '') +
      '<p class="sentence">' + L.sentenceHtml(it.sentence, it.word) + '</p>' +
      '<div class="hint-row">' + (it.hint ? '<button class="text-btn" data-act="hint">ヒントを みる</button>' : '') + '</div>' +
      '<div class="choices">' +
      it.choices.map(function (c, i) {
        return '<button class="chunky choice" data-i="' + i + '">' + esc(c.text) + '</button>';
      }).join('') +
      '</div>' +
      '<p class="praise" aria-live="polite"></p>' +
      '<div class="after"></div>' +
      '</section>';
    var sd = app.querySelector('[data-act="stop-demo"]');
    if (sd) sd.addEventListener('click', stopDemo);
    var hb = app.querySelector('[data-act="hint"]');
    if (hb) hb.addEventListener('click', function () {
      hintUsed = true;
      hb.parentNode.innerHTML = '<p class="hint">💡 ' + esc(it.hint) + '</p>';
    });
    blockedTaps = 0;
    var ready = holdTaps(app.querySelector('.choices'));
    app.querySelectorAll('.choice').forEach(function (b) {
      b.addEventListener('click', function () { if (ready()) answer(Number(b.getAttribute('data-i'))); });
    });
    shownAt = performance.now();
    hiddenAt = 0;
  }

  function answer(i) {
    if (answered) return;
    answered = true;
    var ms = Math.max(0, Math.round(performance.now() - shownAt));
    var it = session.items[session.idx];
    var ch = it.choices[i];
    var btns = app.querySelectorAll('.choice');
    btns.forEach(function (b, j) {
      b.disabled = true;
      if (it.choices[j].correct) b.classList.add('is-correct');
      else if (j === i) b.classList.add('is-picked');
      else b.classList.add('is-dim');
    });
    var total = session.items.length;
    var rec = {
      id: uuid(),
      ts: new Date().toISOString(),
      date: session.date,
      sid: session.sid,
      qno: session.idx + 1,
      qtotal: total,
      qid: it.qid,
      word: it.word,
      kanji: L.kanjiOf(it.word).join(''),
      type: it.type,
      correct: !!ch.correct,
      chosen: ch.text,
      chosenType: ch.type || '',
      reading: it.reading,
      ms: ms,
      hint: hintUsed,
      reason: it.reason,
      source: it.source || '',
      variant: it.variant || '例文',
      slen: L.sentenceLength(it.sentence),
      pos: i + 1,               // 押したボタンの位置（上から 1〜4）
      blocked: blockedTaps      // 早すぎて受け付けなかったタップの数
    };
    session.results.push({ reason: it.reason, correct: rec.correct });
    session.idx++;
    if (!session.demo) {
      addRecord(rec);
      save(KEYS.session, session);
      syncNow();
    }

    var ball = app.querySelector('.ball');
    if (ball) ball.style.left = ballLeft(session.idx, total);

    if (ch.correct) {
      // つづけて正解した数（間違えたら、なにも言わずに 0 にもどす）
      var combo = 0;
      for (var k = session.results.length - 1; k >= 0 && session.results[k].correct; k--) combo++;
      var praise = app.querySelector('.praise');
      var c = FX.callout(combo);
      if (FX.correct({ button: btns[i], section: app.querySelector('.quiz'), combo: combo })) {
        praise.innerHTML = '<span class="callout fx-lv' + c.level + '">' + esc(c.main) +
          (c.sub ? '<small>' + esc(c.sub) + '</small>' : '') + '</span>';
      } else {
        praise.textContent = PRAISE[Math.floor(Math.random() * PRAISE.length)];
      }
      S.play(combo >= 3 ? 'combo' : 'correct');
      if (navigator.vibrate) { try { navigator.vibrate(c.milestone ? [20, 60, 20] : 25); } catch (e) { /* なにもしない */ } }
      setTimeout(next, 850);
    } else {
      S.play('wrong');
      var after = app.querySelector('.after');
      after.innerHTML =
        '<div class="feedback" role="status">' +
        '<p class="answer">' + esc(it.word) + ' は「<strong>' + esc(it.reading) + '</strong>」</p>' +
        '<p class="again">また でてくるね。</p>' +
        (it.hint && !hintUsed ? '<p class="meaning">💡 ' + esc(it.hint) + '</p>' : '') +
        '</div>' +
        '<button class="chunky go next">つぎへ</button>';
      var nb = after.querySelector('.next');
      var nextReady = holdTaps(after);
      nb.addEventListener('click', function () { if (nextReady()) next(); });
      nb.focus({ preventScroll: true });
      after.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  function next() {
    if (screen !== 'quiz') return;
    if (session.idx >= session.items.length) finish();
    else renderQuiz();
  }

  function finish() {
    var res = session.results;
    var fresh = res.filter(function (r) { return r.reason === '新規' && r.correct; }).length;
    var review = res.filter(function (r) {
      return (r.reason === '復習' || r.reason === '確認' || r.reason === 'やりなおし') && r.correct;
    }).length;
    var total = session.items.length;
    var right = res.filter(function (r) { return r.correct; }).length;
    var score = L.finishTier(L.lastSession(load(KEYS.log, []), session.sid), right, total);
    if (session.demo) {
      var oneTime = session.oneTime;
      session = null;
      renderEnd(total, fresh, review, { oneTime: oneTime }, score);
      return;
    }
    save(KEYS.session, null);
    session = null;
    syncNow();
    renderEnd(total, fresh, review, null, score);
  }

  /* ---------- がめん：ゴール ---------- */
  function renderEnd(total, fresh, review, demo, score) {
    screen = 'end';
    var stats = L.dayStats(load(KEYS.log, []), today());
    var gameNo = demo ? 0 : L.gamesOn(load(KEYS.log, []), today());
    var bars = '';
    for (var i = 0; i < 12; i++) bars += '<i style="--h:' + (0.3 + ((i * 37) % 70) / 100).toFixed(2) + '"></i>';
    // 前回より下がったときは、前回の数字を出さない
    var plus = score.up > 0 ? '<small>まえより +' + score.up + '%</small>' : '';
    var badge = score.tier === 'perfect' ? '<p class="levelup is-perfect">PERFECT!' + (plus || '<small>ぜんもん せいかい</small>') + '</p>' :
      score.tier === 'up' ? '<p class="levelup">LEVEL UP!' + plus + '</p>' : '';
    app.innerHTML =
      '<section class="end tier-' + score.tier + '">' +
      (demo ? demoBanner(false) : '') +
      '<div class="stage" aria-hidden="true"><span class="beam l"></span><span class="beam r"></span>' +
      '<span class="beam c"></span><div class="eq">' + bars + '</div></div>' +
      '<p class="goal-word">FINISH!</p>' +
      '<p class="end-sub">' + total + 'もん やりきった！</p>' +
      '<div class="score-row">' +
      '<p class="score"><span>せいかい</span><b>' + score.pct + '</b><i>%</i></p>' + badge +
      '</div>' +
      (demo ? '<p class="notice">おためしなので、きろくは して いません。</p>' :
      '<div class="stats">' +
      '<div class="stat"><span>れんぞく</span><b>' + stats.streak + '</b><i>にち</i></div>' +
      '<div class="stat"><span>ぜんぶで</span><b>' + stats.total + '</b><i>にち</i></div>' +
      '</div>') +
      '<ul class="end-list">' +
      (gameNo >= 2 ? '<li>きょう ' + gameNo + 'かいめ' + (gameNo >= L.MAX_GAMES ? '。きょうは ここまで！' : '') + '</li>' : '') +
      (fresh ? '<li>はじめての ことば　' + fresh + 'こ せいかい</li>' : '') +
      (review ? '<li>ふくしゅう　' + review + 'こ できた</li>' : '') +
      '</ul>' +
      '<button class="chunky go" data-act="home">おわる</button>' +
      '</section>';
    app.querySelector('[data-act="home"]').addEventListener('click', function () {
      if (demo && demo.oneTime) renderParent(); else renderHome();
    });
    FX.finish({ section: app.querySelector('.end'), pct: score.pct, tier: score.tier });
    S.play('goal');
    if (score.tier !== 'base') {
      setTimeout(function () { if (screen === 'end') S.play('levelup'); }, 650);
    }
  }

  /* ---------- がめん：おうちのひと ---------- */
  function renderParent(msg, good) {
    screen = 'parent';
    FX.clear();
    var cfg = getConfig();
    var qc = load(KEYS.questions, null);
    var log = load(KEYS.log, []);
    var box = load(KEYS.outbox, []);
    app.innerHTML =
      '<section class="panel">' +
      '<h1>おうちのひと</h1>' +
      '<dl>' +
      '<dt>この端末</dt><dd>' + (isDemoDevice() ? 'おためし専用（記録しません）' : '本番用') + '</dd>' +
      '<dt>接続</dt><dd>' + (cfg ? '設定済み' : '未設定') + '</dd>' +
      '<dt>問題</dt><dd>' + (qc ? qc.items.length + '問（' + esc(new Date(qc.at).toLocaleString('ja-JP')) + ' に取得）' : 'まだ取得していません') + '</dd>' +
      '<dt>記録</dt><dd>' + log.length + '件</dd>' +
      '<dt>未送信</dt><dd>' + box.length + '件</dd>' +
      '</dl>' +
      '<p class="msg' + (msg ? (good ? ' good' : ' bad') : '') + '">' + esc(msg || '') + '</p>' +
      (isDemoDevice() ? '' : '<button class="chunky" data-act="demo">おためしで やってみる（記録しない）</button>') +
      '<button class="chunky" data-act="sync">記録をいま送る</button>' +
      '<button class="chunky" data-act="reload">問題を読みなおす</button>' +
      '<button class="chunky" data-act="resync">記録をシートに合わせる</button>' +
      (installPrompt ? '<button class="chunky" data-act="install">ホーム画面に追加</button>' : '') +
      '<button class="chunky" data-act="setup">接続先を設定しなおす</button>' +
      '<button class="chunky" data-act="demo-device">' + (isDemoDevice() ? 'おためし専用をやめる' : 'この端末をおためし専用にする') + '</button>' +
      '<button class="chunky go" data-act="back">もどる</button>' +
      '</section>';
    app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-act');
        if (a === 'back') renderHome();
        else if (a === 'setup') renderSetup();
        else if (a === 'demo') startDemo(true);
        else if (a === 'demo-device') {
          if (isDemoDevice()) {
            if (!confirm('この端末で答えた記録を、シートに送るようにもどします。子どもが使う端末だけで選んでください。')) return;
            save(KEYS.demoDevice, false);
            renderParent('本番用にもどしました。', true);
          } else {
            if (!confirm('この端末では、答えても記録しなくなります。子どものスマホでは選ばないでください。')) return;
            save(KEYS.demoDevice, true);
            b.disabled = true;
            loadHistory().then(function () { renderParent('おためし専用にしました。', true); });
          }
        }
        else if (a === 'sync') {
          b.disabled = true;
          syncNow().then(function (ok) {
            var left = load(KEYS.outbox, []).length;
            renderParent(ok && !left ? '送りました。' : '送れませんでした。通信を確認してください（未送信 ' + left + '件）。', ok && !left);
          });
        } else if (a === 'reload') {
          b.disabled = true;
          refreshQuestions().then(function (items) { renderParent(items.length + '問を読みこみました。', true); },
            function (e) { renderParent('読みこめませんでした：' + e.message); });
        } else if (a === 'resync') {
          if (!confirm('この端末の記録を、スプレッドシートの「結果」と同じにします。シートで消した記録は、この端末からも消えます。')) return;
          b.disabled = true;
          reconcileLog(true).then(function (n) {
            var left = load(KEYS.outbox, []).length;
            renderParent('シートに合わせました（記録 ' + n + '件' + (left ? '、うち未送信 ' + left + '件' : '') + '）。', true);
          }, function () { renderParent('つながりませんでした。通信を確認してください。'); });
        } else if (a === 'install' && installPrompt) {
          installPrompt.prompt();
          installPrompt = null;
        }
      });
    });
  }

  /* ---------- がめん：はじめのせってい ---------- */
  function renderSetup(msg) {
    screen = 'setup';
    var cfg = getConfig() || { url: '', key: '' };
    app.innerHTML =
      '<section class="panel">' +
      '<h1>はじめの設定（おうちのひと）</h1>' +
      '<p>Apps Script の「ウェブアプリの URL」と「アクセスキー」を入れてください。パソコンで <b>setup.html</b> を開くと、QRコードを読むだけで設定できます。</p>' +
      '<label for="f-url">ウェブアプリの URL</label>' +
      '<input id="f-url" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(cfg.url) + '">' +
      '<label for="f-key">アクセスキー</label>' +
      '<input id="f-key" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(cfg.key) + '">' +
      '<p class="msg bad">' + esc(msg || '') + '</p>' +
      '<button class="chunky go" data-act="save">保存してつなぐ</button>' +
      (getConfig() ? '<button class="chunky" data-act="back">もどる</button>' : '') +
      '</section>';
    var back = app.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', function () { renderParent(); });
    app.querySelector('[data-act="save"]').addEventListener('click', function (ev) {
      var url = app.querySelector('#f-url').value.trim();
      var key = app.querySelector('#f-key').value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
        renderSetup('URL は https://script.google.com/ で始まるものを入れてください。');
        return;
      }
      if (!key) { renderSetup('アクセスキーを入れてください。'); return; }
      ev.target.disabled = true;
      save(KEYS.config, { url: url, key: key });
      connectAndGo(function (m) { renderSetup(m); });
    });
  }

  function connectAndGo(onFail) {
    api('ping').then(function () {
      return Promise.all([refreshQuestions(), loadHistory(true)]);
    }).then(function () {
      syncNow();
      renderHome();
    }).catch(function (e) {
      var m = e && e.message === 'bad-key' ? 'アクセスキーがちがいます。' :
        'つながりませんでした（' + (e && e.message ? e.message : 'error') + '）。URL と公開の設定を確認してください。';
      onFail(m);
    });
  }

  /* ---------- はじまり ---------- */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });
  window.addEventListener('online', function () { syncNow(); });
  var hiddenDay = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = performance.now();
      hiddenDay = today();
      return;
    }
    // 問題の途中で画面を離れていたら、そのあいだは回答時間に入れない
    if (screen === 'quiz' && !answered && hiddenAt) shownAt += performance.now() - hiddenAt;
    hiddenAt = 0;
    syncNow();
    if (screen === 'home' || (screen === 'end' && hiddenDay !== today())) renderHome();
  });

  // 新しい版が届いたら、ホームにいるときに読みこみなおす（問題の途中では待つ）
  var reloadPending = false;
  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (screen === 'home') location.reload(); else reloadPending = true;
    });
    navigator.serviceWorker.register('sw.js').catch(function () { /* オフライン機能なしで動く */ });
  }

  // すでに開いているページで せっていリンクを開いたとき
  window.addEventListener('hashchange', function () {
    if (readHashConfig()) {
      app.innerHTML = '<section class="panel"><h1>せつぞく ちゅう…</h1></section>';
      connectAndGo(function (m) { renderSetup(m); });
    }
  });

  var fromLink = readHashConfig();
  if (!getConfig()) {
    renderSetup();
  } else if (fromLink) {
    app.innerHTML = '<section class="panel"><h1>せつぞく ちゅう…</h1></section>';
    connectAndGo(function (m) { renderSetup(m); });
  } else {
    renderHome();
    Promise.all([
      refreshQuestions().catch(function () { return null; }),
      loadHistory()
    ]).then(function () {
      if (screen === 'home') renderHome();
      syncNow();
    });
  }
})();
