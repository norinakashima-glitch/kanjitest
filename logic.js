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
  // 1日にできる回数。毎日の目標は1回で、2〜15回目はおまけ
  var MAX_GAMES = 15;
  var TYPE_READING = '読み';
  // 逆向き（ひらがなを見て漢字を選ぶ）。読みで正解できた語だけ、1回に最大5問
  var TYPE_REVERSE = '逆';
  var MAX_REVERSE = 5;
  var READ_MS = 1000; // これより速い正解は「読めた」に数えない
  // 「演出」が「静か」の語（物語の悲しい場面など）は、1回に最大5問。正解してもはでな演出をしない
  var MAX_QUIET = 5;
  // 早押しの回：1問の時間の真ん中が1秒未満の回。記録は残すが、覚えた度合い（間隔反復・やりなおし・逆向きにできる語）には数えない。画面には何も出さない
  var FAST_GAME_MS = 1000;

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

  /* 早押しの回のセッションID。時間は「結果」タブと同じく0.1秒単位にまるめてから真ん中を出す（アプリとシートで判定をそろえる） */
  function fastSessions(log) {
    var by = {};
    log.forEach(function (r) {
      if (!r.sid || r.ms === undefined || r.ms === null || r.ms === '' || isNaN(Number(r.ms))) return;
      (by[r.sid] || (by[r.sid] = [])).push(Math.round(Number(r.ms) / 100));
    });
    var fast = {};
    Object.keys(by).forEach(function (sid) {
      var a = by[sid].sort(function (x, y) { return x - y; }), n = a.length, m = Math.floor(n / 2);
      var med = n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
      if (med * 100 < FAST_GAME_MS) fast[sid] = true;
    });
    return fast;
  }

  /* 覚えた度合いに数える記録（早押しの回をのぞく） */
  function countedLog(log) {
    var fast = fastSessions(log);
    return log.filter(function (r) { return !(r.sid && fast[r.sid]); });
  }

  /* 回答の記録から、語ごとの状態を作り直す。
   * status: learning（間違えて出し直し中） / check（初回正解、確認待ち） / done（卒業）
   * 期限より前に正解しても（正解済みの語として出たとき）、段階は進めない。
   */
  function buildState(log, type) {
    type = type || TYPE_READING;
    var sorted = log.slice().sort(function (a, b) {
      return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
    });
    var st = {};
    sorted.forEach(function (r) {
      if ((r.type || TYPE_READING) !== type) return;
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

  // 例文と「別の例文1〜5」から1つ選ぶ。新しい語はいつもの例文
  function pickVariant(q, reason, rng, allowTest) {
    // 読みの問題の復習と2週間後の確認では、学校のテストに近い文（テスト文）があればそれを出す
    if (allowTest && q.test && (reason === '復習' || reason === '確認')) return { text: q.test, name: 'テスト文' };
    var variants = [{ text: q.sentence, name: '例文' }];
    for (var n = 1; n <= 5; n++) {
      var t = q['alt' + n] !== undefined ? q['alt' + n] : (n <= 2 ? (q.alts || [])[n - 1] : '');
      if (t) variants.push({ text: t, name: '別の例文' + n });
    }
    return reason === '新規' ? variants[0] : variants[Math.floor(rng() * variants.length)];
  }

  // 逆向きの1問：例文の［語］を［よみ］にかえて、漢字を4つから選ぶ
  function makeReverseItem(q, k, reason, rng) {
    var v = pickVariant(q, reason === '新規' ? '' : reason, rng);
    var text = String(v.text);
    text = text.indexOf('［' + q.word + '］') >= 0 ? text.replace('［' + q.word + '］', '［' + q.reading + '］')
      : text.replace(q.word, '［' + q.reading + '］');
    var choices = [{ text: q.word, correct: true, type: '' }];
    for (var i = 0; i < 3; i++) choices.push({ text: q.rwrongs[i], correct: false, type: '' });
    return {
      qid: q.id, key: k, word: q.word, reading: q.reading, type: TYPE_REVERSE,
      sentence: text, variant: v.name, choices: shuffle(choices, rng), hint: q.hint || '',
      source: q.source || '', reason: reason, grade: Number(q.grade) || 9, quiet: !!q.quiet
    };
  }

  function makeItem(k, reason, groups, rng) {
    var qs = groups[k];
    var q;
    if (reason === '新規') {
      q = qs.filter(function (x) { return x.source === '日記'; })[0] || qs[0];
    } else {
      q = qs[Math.floor(rng() * qs.length)];
    }
    // 新しい語はいつもの例文、復習では「別の例文」もまぜる（復習と確認でテスト文があればテスト文）。どれを出したかは記録に残す
    var v = pickVariant(q, reason, rng, true);
    var choices = [{ text: q.reading, correct: true, type: '' }];
    for (var i = 0; i < 3; i++) {
      choices.push({ text: q.wrongs[i], correct: false, type: (q.wrongTypes && q.wrongTypes[i]) || '' });
    }
    return {
      qid: q.id, key: k, word: q.word, reading: q.reading, type: TYPE_READING,
      sentence: v.text, variant: v.name, choices: shuffle(choices, rng), hint: q.hint || '',
      source: q.source || '', reason: reason, grade: Number(q.grade) || 9,
      quiet: qs.some(function (x) { return !!x.quiet; })
    };
  }

  /* 今日の30問を作る */
  function buildSession(questions, log, today, rng) {
    rng = rng || Math.random;
    log = countedLog(log);
    var g = groupQuestions(questions);
    var st = buildState(log);
    var rank = {};
    g.order.forEach(function (k, i) { rank[k] = i; });

    // retry：今日まちがえて、まだ今日のうちに正解していない語（2回目以降で先に出す）
    var retry = [], due = [], known = [], fresh = [];
    g.order.forEach(function (k) {
      var s = st[k];
      if (!s) { fresh.push(k); return; }
      if (s.status === 'learning' && s.last === today && !s.lastCorrect) retry.push(k);
      else if ((s.status === 'learning' || s.status === 'check') && s.due <= today) due.push(k);
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
    retry.sort(function (a, b) { return (st[b].wrong - st[a].wrong) || (rank[a] - rank[b]); });
    fresh.sort(function (a, b) {
      var da = g.groups[a].some(function (q) { return q.source === '日記'; }) ? 0 : 1;
      var db = g.groups[b].some(function (q) { return q.source === '日記'; }) ? 0 : 1;
      return (da - db) || (rank[a] - rank[b]);
    });
    known = shuffle(known, rng).sort(function (a, b) {
      return st[a].last < st[b].last ? -1 : st[a].last > st[b].last ? 1 : 0;
    });

    // 逆向きにできる語：読みで（1秒以上かけて）正解したことがあり、漢字の選択肢がそろっている語
    var readOk = {};
    log.forEach(function (r) {
      if ((r.type || TYPE_READING) === TYPE_READING && r.correct && (r.ms === undefined || Number(r.ms) >= READ_MS)) {
        readOk[itemKey(r.word, r.reading)] = true;
      }
    });
    var revCand = g.order.filter(function (k) {
      return readOk[k] && g.groups[k].some(function (q) { return q.rwrongs && q.rwrongs.length >= 3 && q.rwrongs.every(Boolean); });
    });
    var nRev = Math.min(MAX_REVERSE, revCand.length);

    var N = SESSION_SIZE - nRev;
    due = retry.concat(due);
    // 「静か」の語は1回に MAX_QUIET 問まで。こえた分は次の回にまわす
    var isQuiet = function (k) { return g.groups[k].some(function (q) { return !!q.quiet; }); };
    var quietLeft = MAX_QUIET, taken = {};
    var take = function (list, n) {
      var out = [];
      for (var i = 0; i < list.length && out.length < n; i++) {
        var k = list[i];
        if (taken[k]) continue;
        if (isQuiet(k)) { if (quietLeft <= 0) continue; quietLeft--; }
        taken[k] = true;
        out.push(k);
      }
      return out;
    };
    var rev = take(due, MAX_REVIEW);
    var kn = take(known, KNOWN);
    var nw = take(fresh, Math.max(0, N - rev.length - kn.length));
    // 新しい語が足りないときは、正解済みの残り → 復習の残り の順で埋める
    // （苦手な語の復習は MAX_REVIEW 問までにして、正解できる語を多くする。苦手な語ばかりの回にしない）
    kn = kn.concat(take(known, N - rev.length - kn.length - nw.length));
    rev = rev.concat(take(due, N - rev.length - kn.length - nw.length));

    var picks = [];
    rev.forEach(function (k) {
      var reason = retry.indexOf(k) >= 0 ? 'やりなおし' : st[k].status === 'check' ? '確認' : '復習';
      picks.push({ k: k, reason: reason });
    });
    kn.forEach(function (k) { picks.push({ k: k, reason: '正解済み' }); });
    nw.forEach(function (k) { picks.push({ k: k, reason: '新規' }); });

    var items = picks.map(function (p) { return makeItem(p.k, p.reason, g.groups, rng); });

    // 逆向き：期限が来た語 → まだ逆向きで出していない語 → 前に正解した語（古い順）。読みで出す語とは重ねない
    if (nRev) {
      var used = {};
      picks.forEach(function (p) { used[p.k] = true; });
      var rst = buildState(log, TYPE_REVERSE);
      var rDue = [], rFresh = [], rKnown = [];
      revCand.forEach(function (k) {
        if (used[k]) return;
        if (isQuiet(k) && quietLeft <= 0) return;
        var s = rst[k];
        if (!s) rFresh.push(k);
        else if ((s.status === 'learning' || s.status === 'check') && s.due <= today) rDue.push(k);
        else if (!(s.status === 'learning' && !s.lastCorrect)) rKnown.push(k);
      });
      rKnown.sort(function (a, b) { return rst[a].last < rst[b].last ? -1 : rst[a].last > rst[b].last ? 1 : 0; });
      var rPick = [];
      rDue.concat(shuffle(rFresh, rng), rKnown).forEach(function (k) {
        if (rPick.length >= nRev) return;
        if (isQuiet(k)) { if (quietLeft <= 0) return; quietLeft--; }
        rPick.push(k);
      });
      rPick.forEach(function (k) {
        var s = rst[k];
        var reason = !s ? '新規' : (s.status === 'learning' || s.status === 'check') && s.due <= today ? '復習' : '正解済み';
        var qs = g.groups[k].filter(function (q) { return q.rwrongs && q.rwrongs.length >= 3 && q.rwrongs.every(Boolean); });
        items.push(makeReverseItem(qs[Math.floor(rng() * qs.length)], k, reason, rng));
      });
      // 逆向きの語が足りないときは、読みの問題で30問にする
      var extra = fresh.concat(due, known).filter(function (k) {
        return !used[k] && !taken[k] && rPick.indexOf(k) < 0;
      });
      while (items.length < SESSION_SIZE && extra.length) {
        var k2 = extra.shift();
        if (taken[k2]) continue;
        if (isQuiet(k2)) { if (quietLeft <= 0) continue; quietLeft--; }
        taken[k2] = true;
        items.push(makeItem(k2, st[k2] ? '正解済み' : '新規', g.groups, rng));
      }
    }
    // 1問目は、できるだけ前に正解した語にする（はじめに1つ決まると取りかかりやすい）
    // 正解済みの語がないとき（はじめの日など）は、いちばん学年の低い語にする
    var first = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].reason === '正解済み' && items[i].type === TYPE_READING) { first = items.splice(i, 1)[0]; break; }
    }
    if (!first && items.length) {
      var low = -1;
      items.forEach(function (it, j) {
        if (it.type === TYPE_READING && (low < 0 || it.grade < items[low].grade)) low = j;
      });
      if (low < 0) low = 0;
      first = items.splice(low, 1)[0];
    }
    items = spreadOut(shuffle(items, rng));
    if (first) items.unshift(first);
    return items;
  }

  /* きろくの画面に出すもの（早押しの回は数えない。読みの問題だけ）
     - total：読めた語の数（1秒以上かけて正解したことがある語。「集計_日」の「読めた語」と同じ数え方）
     - days：やった日ごとの、その日までの読めた語の数（合計なので下がらない）。新しい日から最大 maxDays 日
     - first：はじめの日の終わりの数
     - wins：前にまちがえたことがあって、いちばん新しい答えが正解の語から、ランダムに3つ */
  function progress(questions, log, rng, maxDays) {
    rng = rng || Math.random;
    maxDays = maxDays || 7;
    var g = groupQuestions(questions);
    var recs = countedLog(log).filter(function (r) { return (r.type || TYPE_READING) === TYPE_READING; })
      .sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    var read = {}, readN = 0, wrong = {}, lastOk = {}, days = [];
    recs.forEach(function (r) {
      var k = itemKey(r.word, r.reading);
      var slow = r.ms === undefined || r.ms === null || r.ms === '' || Math.round(Number(r.ms) / 100) * 100 >= READ_MS;
      if (r.correct && slow && !read[k] && g.groups[k]) { read[k] = true; readN++; }
      if (!r.correct) wrong[k] = (wrong[k] || 0) + 1;
      lastOk[k] = !!r.correct;
      var d = days[days.length - 1];
      if (d && d.date === r.date) d.count = readN;
      else days.push({ date: r.date, count: readN });
    });
    var pick = function (min) {
      return g.order.filter(function (k) { return (wrong[k] || 0) >= min && lastOk[k]; });
    };
    var cand = pick(2);
    if (cand.length < 3) cand = pick(1);
    var wins = shuffle(cand, rng).slice(0, 3).map(function (k) {
      var q = g.groups[k][0];
      return { word: q.word, reading: q.reading };
    });
    return {
      total: readN,
      first: days.length ? days[0].count : 0,
      days: days.slice(-maxDays),
      wins: wins
    };
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

  /* その日に最後までやった回数 */
  function gamesOn(log, date) {
    var sids = {};
    log.forEach(function (r) {
      if (r.date === date && r.qno && r.qtotal && Number(r.qno) === Number(r.qtotal)) sids[r.sid || r.id || r.ts] = true;
    });
    return Object.keys(sids).length;
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
    TYPE_READING: TYPE_READING, TYPE_REVERSE: TYPE_REVERSE, MAX_REVERSE: MAX_REVERSE, MAX_QUIET: MAX_QUIET,
    MAX_REVIEW: MAX_REVIEW, KNOWN: KNOWN, MAX_GAMES: MAX_GAMES, gamesOn: gamesOn,
    FAST_GAME_MS: FAST_GAME_MS, fastSessions: fastSessions, countedLog: countedLog, progress: progress,
    localDate: localDate, addDays: addDays, itemKey: itemKey, kanjiOf: kanjiOf,
    buildState: buildState, buildSession: buildSession, dayStats: dayStats,
    percent: percent, lastSession: lastSession, finishTier: finishTier,
    sentenceHtml: sentenceHtml, sentenceLength: sentenceLength, escapeHtml: escapeHtml
  };
});
