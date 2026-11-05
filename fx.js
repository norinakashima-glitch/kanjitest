/*
 * 演出（ダンス）
 * 正解：粒がはじけて、英語のかけ声。3・5・10問つづけて正解すると強くなる（0.85秒以内に消える）
 * おわり：ステージのライトと紙ふぶき。前回より上がった日・全問正解の日は、もう一段たす
 * 動きを減らす設定の端末や、ホームで「うごき オフ」にしたときは出さない
 */
(function (root) {
  'use strict';
  var KEY = 'kt_fx';
  var CALLS = ['NICE!', 'GREAT!', 'YEAH!', 'FRESH!', 'SMOOTH!', 'CLEAN!', 'ON BEAT!'];
  var COLORS = ['#FF4FA3', '#22D3EE', '#FFD23F', '#A78BFA', '#7ED957'];
  var SHAPES = ['♪', '★', '✦', '●', '♫'];
  var MILESTONES = [3, 5, 10, 15, 20, 25, 30];

  function enabled() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても続ける */ }
  }
  function reduced() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function active() { return enabled() && !reduced(); }
  function canAnimate() { return typeof Element !== 'undefined' && !!Element.prototype.animate; }

  // 0：ふつう 1：3問つづけて 2：5問 3：10問
  function level(combo) { return combo >= 10 ? 3 : combo >= 5 ? 2 : combo >= 3 ? 1 : 0; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function callout(combo) {
    var milestone = MILESTONES.indexOf(combo) >= 0;
    return {
      main: milestone ? combo + ' COMBO!' : pick(CALLS),
      sub: milestone ? (combo >= 10 ? 'ON FIRE!' : '') : (combo >= 3 ? combo + ' COMBO' : ''),
      level: level(combo),
      milestone: milestone
    };
  }

  function layer() {
    var el = document.querySelector('.fx-layer');
    if (!el) {
      el = document.createElement('div');
      el.className = 'fx-layer';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  }
  function clear() {
    var el = document.querySelector('.fx-layer');
    if (el) el.innerHTML = '';
  }
  function later(el, ms) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms); }

  // (x, y) から粒を n こ はじけさせる
  function burst(x, y, n, spread, dur) {
    if (!canAnimate()) return;
    var box = layer();
    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      p.className = 'fx-p';
      p.textContent = pick(SHAPES);
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.color = COLORS[i % COLORS.length];
      p.style.fontSize = Math.round(16 + Math.random() * 16) + 'px';
      box.appendChild(p);
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      var d = spread * (0.55 + Math.random() * 0.5);
      var dx = Math.cos(a) * d, dy = Math.sin(a) * d * 0.8 - 18;
      var rot = Math.round(Math.random() * 200 - 100);
      var t = dur * (0.8 + Math.random() * 0.2);
      p.animate([
        { transform: 'translate(0,0) scale(.3)', opacity: 1 },
        { transform: 'translate(' + (dx * 0.85) + 'px,' + (dy * 0.85) + 'px) scale(1.15) rotate(' + rot + 'deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate(' + dx + 'px,' + (dy + 26) + 'px) scale(.8) rotate(' + rot + 'deg)', opacity: 0 }
      ], { duration: t, easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'forwards' });
      later(p, t + 40);
    }
  }

  // 上から紙ふぶきを降らせる
  function rain(n, span) {
    if (!canAnimate()) return;
    var box = layer();
    var w = root.innerWidth || 400, h = root.innerHeight || 800;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      p.className = 'fx-confetti';
      p.style.left = Math.round(Math.random() * w) + 'px';
      p.style.background = COLORS[i % COLORS.length];
      if (i % 3 === 0) p.style.borderRadius = '50%';
      box.appendChild(p);
      var delay = Math.round(Math.random() * span * 0.6);
      var t = Math.round(1500 + Math.random() * 900);
      var sway = Math.round(Math.random() * 120 - 60);
      p.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + sway + 'px,' + (h * 0.55) + 'px) rotate(' + (360 + Math.random() * 360) + 'deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate(' + (-sway / 2) + 'px,' + (h + 40) + 'px) rotate(' + (720 + Math.random() * 360) + 'deg)', opacity: 0.6 }
      ], { duration: t, delay: delay, easing: 'linear', fill: 'both' });
      later(p, delay + t + 60);
    }
  }

  function flash(cls, ms) {
    var el = document.createElement('div');
    el.className = cls;
    layer().appendChild(el);
    later(el, ms);
    return el;
  }

  /* 正解したとき。演出を出したら true（出さないときは、いつもの「せいかい！」にする） */
  function correct(o) {
    if (!active()) return false;
    var lv = level(o.combo || 0);
    if (o.section) o.section.classList.add('fx-hit', 'fx-lv' + lv);
    if (o.button && o.button.getBoundingClientRect) {
      var b = o.button.getBoundingClientRect();
      burst(b.left + b.width / 2, b.top + b.height / 2, 10 + lv * 6, 90 + lv * 35, 640 + lv * 40);
    }
    if (lv >= 1) flash('fx-glow fx-lv' + lv, 820);
    if (lv >= 2) {
      var eq = flash('fx-eq', 820);
      for (var i = 0; i < 14; i++) {
        var bar = document.createElement('i');
        bar.style.setProperty('--h', (0.35 + Math.random() * 0.65).toFixed(2));
        bar.style.animationDelay = (i % 3) * 40 + 'ms';
        eq.appendChild(bar);
      }
    }
    return true;
  }

  // 正答率を 0 から数えあげる
  function countUp(el, to, ms) {
    if (!el) return;
    if (!root.requestAnimationFrame) { el.textContent = String(to); return; }
    var t0 = null;
    el.textContent = '0';
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / ms);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) root.requestAnimationFrame(step);
    }
    root.requestAnimationFrame(step);
  }

  /* おわりの画面。tier：base（毎回）／up（前回より上がった）／perfect（全問正解） */
  function finish(o) {
    if (!active() || !o.section) return false;
    o.section.classList.add('fx-on');
    var st = o.section.querySelector('.stage');
    if (st) {
      var r = st.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height * 0.55, 26, 170, 1100);
    }
    countUp(o.section.querySelector('.score b'), o.pct, 700);
    if (o.tier === 'up' || o.tier === 'perfect') {
      setTimeout(function () {
        if (!o.section.isConnected) return;
        rain(o.tier === 'perfect' ? 90 : 60, 2600);
        var lu = o.section.querySelector('.levelup');
        if (lu) {
          var b = lu.getBoundingClientRect();
          burst(b.left + b.width / 2, b.top + b.height / 2, 18, 120, 800);
        }
      }, 650);
    }
    return true;
  }

  root.KanjiFx = {
    enabled: enabled, setEnabled: setEnabled, active: active, level: level,
    callout: callout, correct: correct, finish: finish, burst: burst, clear: clear
  };
})(typeof self !== 'undefined' ? self : this);
