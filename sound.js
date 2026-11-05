/*
 * 効果音（音声ファイルは使わず、その場で音を作る。オフラインでも鳴る）
 * 正解：明るい2音／間違い：やわらかい1音（ブザーにしない）／ゴール：短いファンファーレ
 * 3問つづけて正解：2音にビート（キックとクラップ）をのせる／前回より上がった日：ビートつきのファンファーレ
 */
(function (root) {
  'use strict';
  var KEY = 'kt_sound';
  var ctx = null;

  function enabled() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても続ける */ }
  }

  // スマホでは、タップのあとでないと音が出せないため、最初のタップで準備する
  function unlock() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  }

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    var t0 = ctx.currentTime + start;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    var peak = opts.volume || 0.18;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // ドン（キック）
  function kick(start, volume) {
    var t0 = ctx.currentTime + start;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.13);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume || 0.35, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  // パン（クラップ）：ざらざらした音を短く
  var noise = null;
  function clap(start, volume) {
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = ctx.currentTime + start;
    var src = ctx.createBufferSource();
    var bp = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    src.buffer = noise;
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 0.9;
    var v = volume || 0.22;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(v, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(v * 0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(v, t0 + 0.028);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + 0.2);
  }

  function play(name) {
    if (!enabled()) return;
    unlock();
    if (!ctx) return;
    try {
      if (name === 'correct') {
        tone(784, 0, 0.12, { type: 'triangle', volume: 0.2 });      // ソ
        tone(1175, 0.09, 0.22, { type: 'triangle', volume: 0.2 });  // レ（上）
      } else if (name === 'combo') {
        kick(0, 0.32);
        tone(784, 0, 0.12, { type: 'triangle', volume: 0.2 });
        tone(1175, 0.09, 0.22, { type: 'triangle', volume: 0.2 });
        clap(0.24, 0.2);
        kick(0.36, 0.26);
      } else if (name === 'levelup') {
        [0, 0.5].forEach(function (t) { kick(t, 0.32); });
        [0.25, 0.75].forEach(function (t) { clap(t, 0.2); });
        [784, 988, 1175, 1568].forEach(function (f, i) { tone(f, i * 0.09, 0.16, { type: 'square', volume: 0.06 }); });
        [784, 988, 1175].forEach(function (f) { tone(f, 0.42, 0.5, { type: 'triangle', volume: 0.1 }); });
      } else if (name === 'wrong') {
        tone(392, 0, 0.28, { type: 'sine', volume: 0.12 });         // ひくめの ソ を1回だけ
      } else if (name === 'goal') {
        var notes = [523, 659, 784, 1047];                           // ド ミ ソ ド
        notes.forEach(function (f, i) { tone(f, i * 0.11, 0.18, { type: 'triangle', volume: 0.18 }); });
        [523, 659, 784, 1047].forEach(function (f) { tone(f, 0.48, 0.6, { type: 'triangle', volume: 0.09 }); });
      }
    } catch (e) { /* 音が出なくてもアプリは止めない */ }
  }

  root.KanjiSound = { play: play, unlock: unlock, enabled: enabled, setEnabled: setEnabled };
})(typeof self !== 'undefined' ? self : this);
