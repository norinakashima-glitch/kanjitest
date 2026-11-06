/*
 * 読み上げ：まちがえたときに、正しい読みを日本語の声で読む（端末の読み上げ機能を使う。通信はしない）
 * - 「おと」がオフなら読まない
 * - 端末に日本語の声がないときは、なにもしない（英語の声で変な読み方をしないため）
 */
(function (root) {
  'use strict';
  var synth = root.speechSynthesis;
  var voice = null;

  function pick() {
    if (!synth || !synth.getVoices) return null;
    var vs = synth.getVoices() || [];
    var ja = vs.filter(function (v) { return /^ja([-_]|$)/i.test(v.lang || ''); });
    if (!ja.length) return null;
    var jp = ja.filter(function (v) { return /^ja[-_]JP$/i.test(v.lang); });
    var list = jp.length ? jp : ja;
    var local = list.filter(function (v) { return v.localService; });
    return (local.length ? local : list)[0];
  }
  function refresh() { voice = pick(); return voice; }
  if (synth) {
    refresh();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
    else synth.onvoiceschanged = refresh;
  }

  function ready() { return !!(synth && (voice || refresh())); }
  function voiceName() { return ready() ? voice.name + '（' + voice.lang + '）' : ''; }

  function stop() { try { if (synth) synth.cancel(); } catch (e) { /* なにもしない */ } }

  // ひらがなの読みを読む。読めたら true
  function say(text, opts) {
    opts = opts || {};
    if (!text || !ready()) return false;
    if (root.KanjiSound && !root.KanjiSound.enabled()) return false;
    try {
      stop();
      var u = new root.SpeechSynthesisUtterance(String(text));
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = opts.rate || 0.85;
      u.pitch = 1;
      u.volume = 1;
      synth.speak(u);
      return true;
    } catch (e) { return false; }
  }

  root.KanjiVoice = { ready: ready, voiceName: voiceName, say: say, stop: stop };
})(typeof window !== 'undefined' ? window : this);
