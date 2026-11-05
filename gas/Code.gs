/**
 * 漢字読みアプリ用の API（スプレッドシートに紐づけた Apps Script に貼る）
 *
 * はじめに1回だけ setup() を実行する。
 *   ・「問題」「結果」「テスト記録」タブを作る
 *   ・アクセスキーを作って「実行ログ」に出す
 *   ・Seed.gs があれば、最初の問題を「問題」タブに入れる
 * そのあと「デプロイ → 新しいデプロイ → ウェブアプリ」で公開する。
 */

var SHEET_Q = '問題';
var SHEET_R = '結果';
var SHEET_T = 'テスト記録';
var TZ = 'Asia/Tokyo';

var Q_HEADERS = ['ID', '種類', '語', '読み', '例文', '誤答1', '誤答2', '誤答3', '誤答の種類', 'ヒント',
  '別の例文1', '別の例文2', '字', '学年', '教科', '出典', '有効', '追加日', 'メモ'];
var R_HEADERS = ['記録ID', '日時', '日付', 'セッション', '何問目', '全問数', '問題ID', '語', '字', '問題の種類',
  '正誤', '選んだ選択肢', '誤答の種類', '正しい読み', '回答時間(秒)', 'ヒント', '出題区分', '出典'];
var T_HEADERS = ['日付', '教科', '単元', '問題番号', '答え方の形式', '結果', 'ミスの種類', '正しい答え',
  '書いた答え', 'メモ', '問題データに追加'];

// 学年別漢字（小1〜小3）。ここにない字は「4」（小4以上）にする
var GRADE_1 = '一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六';
var GRADE_2 = '引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話';
var GRADE_3 = '悪安暗医委意育員院飲運泳駅央横屋温化荷界開階寒感漢館岸起期客究急級宮球去橋業曲局銀区苦具君係軽血決研県庫湖向幸港号根祭皿仕死使始指歯詩次事持式実写者主守取酒受州拾終習集住重宿所暑助昭消商章勝乗植申身神真深進世整昔全相送想息速族他打対待代第題炭短談着注柱丁帳調追定庭笛鉄転都度投豆島湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆氷表秒病品負部服福物平返勉放味命面問役薬由油有遊予羊洋葉陽様落流旅両緑礼列練路和';

/* ---------- はじめの準備 ---------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());

  // 何も入っていないシートが1枚だけなら、それを「問題」にする
  var sheets = ss.getSheets();
  if (!ss.getSheetByName(SHEET_Q) && sheets.length === 1 && sheets[0].getLastRow() === 0) {
    sheets[0].setName(SHEET_Q);
  }
  ensureSheet_(ss, SHEET_Q, Q_HEADERS);
  ensureSheet_(ss, SHEET_R, R_HEADERS);
  ensureSheet_(ss, SHEET_T, T_HEADERS);

  var key = props.getProperty('ACCESS_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('ACCESS_KEY', key);
  }
  var added = (typeof SEED !== 'undefined') ? importSeed_(SEED) : 0;

  console.log('アクセスキー：' + key);
  console.log('追加した問題：' + added + '問（問題タブの合計 ' + countQuestions_() + '問）');
}

/** あとから Seed.gs を差しかえたときに実行する（同じ語と読みの問題は入れない） */
function addSeed() {
  var added = (typeof SEED !== 'undefined') ? importSeed_(SEED) : 0;
  console.log('追加した問題：' + added + '問（問題タブの合計 ' + countQuestions_() + '問）');
}

/** アクセスキーをもう一度見たいとき */
function showKey() {
  console.log('アクセスキー：' + PropertiesService.getScriptProperties().getProperty('ACCESS_KEY'));
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var lastCol = sh.getLastColumn();
  var cur = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  if (cur.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    headers.forEach(function (h) {
      if (cur.indexOf(h) < 0) {
        sh.getRange(1, cur.length + 1).setValue(h).setFontWeight('bold');
        cur.push(h);
      }
    });
  }
  return sh;
}

function grade_(word) {
  var g = 0;
  String(word).split('').forEach(function (c) {
    if (!/[㐀-鿿]/.test(c)) return;
    var n = GRADE_1.indexOf(c) >= 0 ? 1 : GRADE_2.indexOf(c) >= 0 ? 2 : GRADE_3.indexOf(c) >= 0 ? 3 : 4;
    if (n > g) g = n;
  });
  return g || '';
}

function kanjiOf_(word) {
  return (String(word).match(/[㐀-鿿々]/g) || []).join('');
}

/** SEED の1行：[語, 読み, 例文, 誤答1, 誤答2, 誤答3, 誤答の種類, ヒント, 教科, 出典] */
function importSeed_(seed) {
  var sh = book_().getSheetByName(SHEET_Q);
  var map = headerMap_(sh);
  var data = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() : [];
  var have = {};
  var maxId = 0;
  data.forEach(function (r) {
    have[r[map['語']] + '|' + r[map['読み']]] = true;
    var m = String(r[map['ID']]).match(/(\d+)/);
    if (m) maxId = Math.max(maxId, Number(m[1]));
  });
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var width = sh.getLastColumn();
  var rows = [];
  seed.forEach(function (s) {
    var k = s[0] + '|' + s[1];
    if (have[k]) return;
    have[k] = true;
    maxId++;
    var row = new Array(width).fill('');
    var set = function (h, v) { if (map[h] !== undefined) row[map[h]] = v; };
    set('ID', 'q' + ('000' + maxId).slice(-4));
    set('種類', '読み');
    set('語', s[0]);
    set('読み', s[1]);
    set('例文', s[2]);
    set('誤答1', s[3]);
    set('誤答2', s[4]);
    set('誤答3', s[5]);
    set('誤答の種類', s[6]);
    set('ヒント', s[7]);
    set('字', kanjiOf_(s[0]));
    set('学年', grade_(s[0]));
    set('教科', s[8] || '');
    set('出典', s[9] || '基本');
    set('有効', true);
    set('追加日', today);
    rows.push(row);
  });
  if (rows.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, width).setValues(rows);
    sh.getRange(start, map['有効'] + 1, rows.length, 1).insertCheckboxes();
  }
  return rows.length;
}

/* ---------- API ---------- */

function doGet() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var key = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
    if (!key || body.key !== key) return json_({ ok: false, error: 'bad-key' });
    switch (body.action) {
      case 'ping': out = { ok: true, questions: countQuestions_() }; break;
      case 'questions': out = { ok: true, items: readQuestions_() }; break;
      case 'log': out = { ok: true, ids: writeResults_(body.rows || []) }; break;
      case 'history': out = { ok: true, rows: readHistory_() }; break;
      default: out = { ok: false, error: 'unknown-action' };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function headerMap_(sh) {
  var heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  heads.forEach(function (h, i) { map[String(h).trim()] = i; });
  return map;
}

function rowsOf_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { map: sh ? headerMap_(sh) : {}, rows: [], sheet: sh };
  return {
    map: headerMap_(sh),
    rows: sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues(),
    sheet: sh
  };
}

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}

function countQuestions_() {
  return readQuestions_().length;
}

function readQuestions_() {
  var t = rowsOf_(SHEET_Q);
  var m = t.map;
  var get = function (r, h) { return m[h] === undefined ? '' : str_(r[m[h]]); };
  var items = [];
  t.rows.forEach(function (r) {
    var active = m['有効'] === undefined ? true : r[m['有効']];
    if (active === false || String(active).toUpperCase() === 'FALSE') return;
    var q = {
      id: get(r, 'ID'),
      type: get(r, '種類') || '読み',
      word: get(r, '語'),
      reading: get(r, '読み'),
      sentence: get(r, '例文'),
      wrongs: [get(r, '誤答1'), get(r, '誤答2'), get(r, '誤答3')],
      wrongTypes: get(r, '誤答の種類').split(/[,、，]/).map(function (s) { return s.trim(); }),
      hint: get(r, 'ヒント'),
      alts: [get(r, '別の例文1'), get(r, '別の例文2')].filter(String),
      kanji: get(r, '字'),
      grade: get(r, '学年'),
      subject: get(r, '教科'),
      source: get(r, '出典')
    };
    if (!q.id || !q.word || !q.reading || !q.sentence) return;
    if (q.wrongs.some(function (w) { return !w; })) return;
    items.push(q);
  });
  return items;
}

function writeResults_(rows) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = book_();
    var sh = ss.getSheetByName(SHEET_R) || ensureSheet_(ss, SHEET_R, R_HEADERS);
    var map = headerMap_(sh);
    var idCol = map['記録ID'];
    var have = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, idCol + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { have[r[0]] = true; });
    }
    var width = sh.getLastColumn();
    var out = [];
    var ids = [];
    rows.forEach(function (x) {
      if (!x || !x.id) return;
      ids.push(String(x.id));
      if (have[x.id]) return;
      have[x.id] = true;
      var row = new Array(width).fill('');
      var set = function (h, v) { if (map[h] !== undefined) row[map[h]] = v; };
      set('記録ID', String(x.id));
      set('日時', x.ts ? new Date(x.ts) : new Date());
      set('日付', String(x.date || ''));
      set('セッション', String(x.sid || ''));
      set('何問目', Number(x.qno) || '');
      set('全問数', Number(x.qtotal) || '');
      set('問題ID', String(x.qid || ''));
      set('語', String(x.word || ''));
      set('字', String(x.kanji || kanjiOf_(x.word || '')));
      set('問題の種類', String(x.type || '読み'));
      set('正誤', x.correct ? '正解' : '不正解');
      set('選んだ選択肢', String(x.chosen || ''));
      set('誤答の種類', String(x.chosenType || ''));
      set('正しい読み', String(x.reading || ''));
      set('回答時間(秒)', Math.round((Number(x.ms) || 0) / 100) / 10);
      set('ヒント', x.hint ? '使った' : '');
      set('出題区分', String(x.reason || ''));
      set('出典', String(x.source || ''));
      out.push(row);
    });
    if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, width).setValues(out);
    return ids;
  } finally {
    lock.releaseLock();
  }
}

function readHistory_() {
  var t = rowsOf_(SHEET_R);
  var m = t.map;
  return t.rows.map(function (r) {
    var get = function (h) { return m[h] === undefined ? '' : r[m[h]]; };
    var ts = get('日時');
    return {
      id: str_(get('記録ID')),
      ts: ts instanceof Date ? ts.toISOString() : str_(ts),
      date: str_(get('日付')),
      sid: str_(get('セッション')),
      qno: Number(get('何問目')) || 0,
      qtotal: Number(get('全問数')) || 0,
      qid: str_(get('問題ID')),
      word: str_(get('語')),
      kanji: str_(get('字')),
      type: str_(get('問題の種類')) || '読み',
      correct: str_(get('正誤')) === '正解',
      chosen: str_(get('選んだ選択肢')),
      chosenType: str_(get('誤答の種類')),
      reading: str_(get('正しい読み')),
      ms: Math.round((Number(get('回答時間(秒)')) || 0) * 1000),
      hint: !!str_(get('ヒント')),
      reason: str_(get('出題区分')),
      source: str_(get('出典'))
    };
  }).filter(function (x) { return x.id && x.word; });
}
