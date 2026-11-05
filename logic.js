/*
 * 出題・間隔反復・日数の計算（画面に関係しない部分）
 * ブラウザでは window.KanjiLogic、Node では require で使う。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KanjiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 間違えた語の出し直し：1日後 → 3日後 → 7日後 → 14日後 → 30日後 → 卒業
  var INTERVALS = [1, 3, 7, 14, 30];
  // 初めて見て正解した語は、14日後に1回だけ確認する
  var CHECK_DAYS = 14;
  var SESSION_SIZE = 30;
  // 1回の配分：期限が来た復習 最大15、前に正解した語 5、残りを新しい語
  var MAX_REVIEW = 15;
  var KNOWN = 5;
  var TYPE_READING = '読み';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function localDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    return localDate(new Date(p[0], p[1] - 1, p[2] + n));
  }

  function itemKey(word, reading) { return word + '|' + reading; }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 回答の記録から、語ごとの状態を作り直す。
   * status: learning（間違えて出し直し中） / check（初回正解、確認待ち） / done（卒業）
   * 期限より前に正解しても（正解済みの語として出たとき）、段階は進めない。
   */
  function buildState(log) {
    var sorted = log.slice().sort(function (a, b) {
      return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
    });
    var st = {};
    sorted.forEach(function (r) {
      if (r.type && r.type !== TYPE_READING) return;
      var k = itemKey(r.word, r.reading);
      var s = st[k];
      if (!s) {
        s = st[k] = { key: k, status: 'new', step: -1, due: null, seen: 0,
          correct: 0, wrong: 0, last: null, lastCorrect: null };
      }
      var d = r.date;
      if (!r.correct) {
        s.status = 'learning';
        s.step = 0;
        s.due = addDays(d, INTERVALS[0]);
        s.wrong++;
      } else {
        s.correct++;
        if (s.status === 'new') {
          s.status = 'check';
          s.due = addDays(d, CHECK_DAYS);
        } else if (s.status === 'check') {
          if (d >= s.due) { s.status = 'done'; s.due = null; }
        } else if (s.status === 'learning') {
          if (d >= s.due) {
            s.step++;
            if (s.step >= INTERVALS.length) { s.status = 'done'; s.due = null; }
            else s.due = addDays(d, INTERVALS[s.step]);
          }
        }
      }
      s.seen++;
      s.last = d;
      s.lastCorrect = !!r.correct;
    });
    return st;
  }

  function groupQuestions(questions) {
    var groups = {};
    var order = [];
    questions.forEach(function (q) {
      if ((q.type || TYPE_READING) !== TYPE_READING) return;
      if (!q.word || !q.reading || !q.sentence || !q.wrongs || q.wrongs.length < 3) return;
      var k = itemKey(q.word, q.reading);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(q);
    });
    return { groups: groups, order: order };
  }

  function kanjiOf(word) {
    return (word.match(/[㐀-鿿豈-﫿々]/g) || []);
  }

  // 同じ字が続かないように並べ替える（できる範囲で）
  function spreadOut(list) {
    var a = list.slice();
    for (var i = 1; i < a.length; i++) {
      var prev = kanjiOf(a[i - 1].word);
      var share = kanjiOf(a[i].word).some(function (c) { return prev.indexOf(c) >= 0; });
      if (!share) continue;
      for (var j = i + 1; j < a.length; j++) {
        var cand = kanjiOf(a[j].word);
        if (!cand.some(function (c) { return prev.indexOf(c) >= 0; })) {
          var t = a[i]; a[i] = a[j]; a[j] = t;
          break;
        }
      }
    }
    return a;
  }

  function makeItem(k, reason, groups, rng) {
    var qs = groups[k];
    var q;
    if (reason === '新規') {
      q = qs.filter(function (x) { return x.source === '日記'; })[0] || qs[0];
    } else {
      q = qs[Math.floor(rng() * qs.length)];
    }
    // 新しい語はいつもの例文、復習では「別の例文」もまぜる。どれを出したかは記録に残す
    var a1 = q.alt1 !== undefined ? q.alt1 : (q.alts || [])[0];
    var a2 = q.alt2 !== undefined ? q.alt2 : (q.alts || [])[1];
    var variants = [{ text: q.sentence, name: '例文' }];
    if (a1) variants.push({ text: a1, name: '別の例文1' });
    if (a2) variants.push({ text: a2, name: '別の例文2' });
    var v = reason === '新規' ? variants[0] : variants[Math.floor(rng() * variants.length)];
    var choices = [{ text: q.reading, correct: true, type: '' }];
    for (var i = 0; i < 3; i++) {
      choices.push({ text: q.wrongs[i], correct: false, type: (q.wrongTypes && q.wrongTypes[i]) || '' });
    }
    return {
      qid: q.id, key: k, word: q.word, reading: q.reading, type: TYPE_READING,
      sentence: v.text, variant: v.name, choices: shuffle(choices, rng), hint: q.hint || '',
      source: q.source || '', reason: reason, grade: Number(q.grade) || 9
    };
  }

  /* 今日の30問を作る */
  function buildSession(questions, log, today, rng) {
    rng = rng || Math.random;
    var g = groupQuestions(questions);
    var st = buildState(log);
    var rank = {};
    g.order.forEach(function (k, i) { rank[k] = i; });

    var due = [], known = [], fresh = [];
    g.order.forEach(function (k) {
      var s = st[k];
      if (!s) { fresh.push(k); return; }
      if ((s.status === 'learning' || s.status === 'check') && s.due <= today) due.push(k);
      else if (s.status === 'done' || s.status === 'check' ||
               (s.status === 'learning' && s.lastCorrect)) known.push(k);
    });

    due.sort(function (a, b) {
      var A = st[a], B = st[b];
      var pa = A.status === 'learning' ? 0 : 1, pb = B.status === 'learning' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (A.due !== B.due) return A.due < B.due ? -1 : 1;
      return B.wrong - A.wrong;
    });
    fresh.sort(function (a, b) {
      var da = g.groups[a].some(function (q) { return q.source === '日記'; }) ? 0 : 1;
      var db = g.groups[b].some(function (q) { return q.source === '日記'; }) ? 0 : 1;
      return (da - db) || (rank[a] - rank[b]);
    });
    known = shuffle(known, rng).sort(function (a, b) {
      return st[a].last < st[b].last ? -1 : st[a].last > st[b].last ? 1 : 0;
    });

    var N = SESSION_SIZE;
    var rev = due.slice(0, MAX_REVIEW);
    var kn = known.slice(0, KNOWN);
    var nw = fresh.slice(0, Math.max(0, N - rev.length - kn.length));
    // 足りないときは、復習の残り → 正解済みの残り の順で埋める
    var extraDue = due.slice(rev.length);
    while (rev.length + kn.length + nw.length < N && extraDue.length) rev.push(extraDue.shift());
    var extraKnown = known.slice(kn.length);
    while (rev.length + kn.length + nw.length < N && extraKnown.length) kn.push(extraKnown.shift());

    var picks = [];
    rev.forEach(function (k) { picks.push({ k: k, reason: st[k].status === 'check' ? '確認' : '復習' }); });
    kn.forEach(function (k) { picks.push({ k: k, reason: '正解済み' }); });
    nw.forEach(function (k) { picks.push({ k: k, reason: '新規' }); });

    var items = picks.map(function (p) { return makeItem(p.k, p.reason, g.groups, rng); });
    // 1問目は、できるだけ前に正解した語にする（はじめに1つ決まると取りかかりやすい）
    // 正解済みの語がないとき（はじめの日など）は、いちばん学年の低い語にする
    var first = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].reason === '正解済み') { first = items.splice(i, 1)[0]; break; }
    }
    if (!first && items.length) {
      var low = 0;
      items.forEach(function (it, j) { if (it.grade < items[low].grade) low = j; });
      first = items.splice(low, 1)[0];
    }
    items = spreadOut(shuffle(items, rng));
    if (first) items.unshift(first);
    return items;
  }

  /* 連続日数と合計日数（30問を最後までやった日を数える） */
  function dayStats(log, today) {
    var done = {};
    log.forEach(function (r) {
      if (r.qno && r.qtotal && Number(r.qno) === Number(r.qtotal)) done[r.date] = true;
    });
    var streak = 0;
    var d = done[today] ? today : addDays(today, -1);
    while (done[d]) { streak++; d = addDays(d, -1); }
    return { streak: streak, total: Object.keys(done).length, doneToday: !!done[today], days: done };
  }

  function percent(c, t) { return t ? Math.round(c * 100 / t) : 0; }

  /* いちばん最近、最後までやった回（今の回はのぞく）。同じ問題の記録が2つあっても1つと数える */
  function lastSession(log, excludeSid) {
    var by = {};
    log.forEach(function (r) {
      if (!r.sid || r.sid === excludeSid) return;
      var s = by[r.sid] || (by[r.sid] = { sid: r.sid, q: {}, total: 0, done: false, ts: '', date: r.date });
      if (r.qno) s.q[r.qno] = !!r.correct;
      if (r.qno && r.qtotal && Number(r.qno) === Number(r.qtotal)) { s.done = true; s.total = Number(r.qtotal); }
      if (String(r.ts || '') > s.ts) { s.ts = String(r.ts || ''); s.date = r.date; }
    });
    var best = null;
    Object.keys(by).forEach(function (k) {
      var s = by[k];
      if (s.done && (!best || s.ts > best.ts)) best = s;
    });
    if (!best) return null;
    var c = 0;
    Object.keys(best.q).forEach(function (n) { if (best.q[n]) c++; });
    return { sid: best.sid, date: best.date, correct: c, total: best.total, pct: percent(c, best.total) };
  }

  /* おわりの演出の段階。完走のお祝い（base）は毎回。前回より正答率が上がったら up、全問正解は perfect */
  function finishTier(prev, correct, total) {
    var pct = percent(correct, total);
    var up = prev ? pct - prev.pct : null;
    var tier = total && correct === total ? 'perfect' : (prev && up > 0 ? 'up' : 'base');
    return { tier: tier, pct: pct, up: up };
  }

  /* 画面に出る字の数（空白、［ ］、ふりがなは数えない） */
  function sentenceLength(sentence) {
    return String(sentence).replace(/\{([^|}]+)\|[^}]+\}/g, '$1').replace(/[\s［］]/g, '').length;
  }

  /* 例文の表示用：［語］を目立たせ、{字|よみ} をふりがなにする */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sentenceHtml(sentence, word) {
    var s = String(sentence);
    if (s.indexOf('［') < 0 && word && s.indexOf(word) >= 0) {
      s = s.replace(word, '［' + word + '］');
    }
    var out = '';
    var re = /［([^］]+)］|\{([^|}]+)\|([^}]+)\}/g;
    var last = 0, m;
    while ((m = re.exec(s))) {
      out += escapeHtml(s.slice(last, m.index));
      if (m[1]) out += '<mark class="target">' + escapeHtml(m[1]) + '</mark>';
      else out += '<ruby>' + escapeHtml(m[2]) + '<rt>' + escapeHtml(m[3]) + '</rt></ruby>';
      last = re.lastIndex;
    }
    out += escapeHtml(s.slice(last));
    return out;
  }

  return {
    INTERVALS: INTERVALS, CHECK_DAYS: CHECK_DAYS, SESSION_SIZE: SESSION_SIZE,
    MAX_REVIEW: MAX_REVIEW, KNOWN: KNOWN,
    localDate: localDate, addDays: addDays, itemKey: itemKey, kanjiOf: kanjiOf,
    buildState: buildState, buildSession: buildSession, dayStats: dayStats,
    percent: percent, lastSession: lastSession, finishTier: finishTier,
    sentenceHtml: sentenceHtml, sentenceLength: sentenceLength, escapeHtml: escapeHtml
  };
});
