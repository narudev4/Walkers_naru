/**
 * WalkersHP 問い合わせフォーム通知メールのパーサー
 *
 * 本文はラベルと値が区切り文字なしで連結されている:
 *   お名前{氏名}貴社名{社名}メールアドレス{email}電話番号{tel}お問い合わせ内容{本文}株式会社Walkers から送信
 *
 * 電話番号は任意フィールドで、存在しないことがある（実例: 前田様）。
 * GAS の V8 ランタイムで動作する（ES2017 相当）。
 */

var LABELS = ['お名前', '貴社名', 'メールアドレス', '電話番号', 'お問い合わせ内容'];
var FOOTER = '株式会社Walkers から送信';

/**
 * 問い合わせ本文をパースする。
 * @param {string} body プレーンテキスト化した本文
 * @return {{name:string, company:string, email:string, phone:string, content:string}|null}
 *         必須フィールドが欠けている場合は null
 */
function parseInquiry(body) {
  if (!body) return null;

  // 改行・全角スペースを潰して1行に正規化する。
  // HTML からのテキスト変換で改行位置が安定しないため。
  var text = String(body).replace(/\r\n|\r|\n/g, ' ').replace(/　/g, ' ');

  // 末尾のフッターを除去。フッターが無い場合も処理は続行する。
  var footerAt = text.lastIndexOf(FOOTER);
  if (footerAt !== -1) text = text.slice(0, footerAt);

  // 各ラベルの出現位置を求める。
  // 「お問い合わせ内容」本文の中にラベル文字列が現れても誤検出しないよう、
  // 常に直前のラベルより後ろから探す（左から順に確定させる）。
  var positions = {};
  var cursor = 0;
  for (var i = 0; i < LABELS.length; i++) {
    var label = LABELS[i];
    var at = text.indexOf(label, cursor);
    if (at === -1) {
      positions[label] = -1;   // 任意フィールド（電話番号）は欠けうる
      continue;
    }
    positions[label] = at;
    cursor = at + label.length;
  }

  // 必須フィールドの検証
  if (positions['お名前'] === -1 ||
      positions['貴社名'] === -1 ||
      positions['メールアドレス'] === -1 ||
      positions['お問い合わせ内容'] === -1) {
    return null;
  }

  // あるラベルの値 = そのラベル直後 〜 次に出現する（存在する）ラベルの手前
  function valueOf(label) {
    var start = positions[label];
    if (start === -1) return '';
    start += label.length;

    var end = text.length;
    for (var j = LABELS.indexOf(label) + 1; j < LABELS.length; j++) {
      if (positions[LABELS[j]] !== -1) {
        end = positions[LABELS[j]];
        break;
      }
    }
    return text.slice(start, end).trim();
  }

  var result = {
    name: valueOf('お名前'),
    company: valueOf('貴社名'),
    email: valueOf('メールアドレス'),
    phone: valueOf('電話番号'),
    content: valueOf('お問い合わせ内容')
  };

  // メールアドレスの妥当性だけは確認する。ここが壊れると返信先を誤る。
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) return null;

  return result;
}

// GAS 側からは parseInquiry() をそのまま呼ぶ。
// 以下は Node.js でテストするときだけ使う。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseInquiry: parseInquiry };
}

// ===== 資料請求フォーム =====

/**
 * 資料請求フォーム通知メールのパーサー
 *
 * 問い合わせフォームと違い、ラベルと値が全角コロンで区切られ改行されている:
 *   お名前：佐藤里奈
 *   貴社名：コマースグロース
 *   ...
 *
 * フィールドは可変（「ご希望の資料」が無い送信もある）。
 * 渡辺さんが転送したメール（Fwd:）も処理できるよう、引用記号と転送ヘッダを除去する。
 *
 * @return {{name,company,email,phone,fields:Object,rawLines:Array}|null}
 */
function parseDocRequest(body) {
  if (!body) return null;

  var text = String(body).replace(/\r\n|\r/g, '\n');

  // 転送メールの場合、転送ヘッダより後ろだけを見る
  var fwdMarkers = ['---------- Forwarded message ---------', '---------- 転送メッセージ ---------'];
  for (var f = 0; f < fwdMarkers.length; f++) {
    var at = text.indexOf(fwdMarkers[f]);
    if (at !== -1) text = text.slice(at + fwdMarkers[f].length);
  }

  // 引用記号を除去（転送方法によって付くことがある）
  var lines = text.split('\n').map(function (l) {
    return l.replace(/^[\s>]+/, '').replace(/\s+$/, '');
  });

  var fields = {};
  var order = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;
    // 全角コロンまたは半角コロンで1回だけ分割する
    var m = line.match(/^([^：:]{1,40})[：:]\s*(.*)$/);
    if (!m) continue;
    var key = m[1].trim();
    var val = m[2].trim();
    // メールヘッダ行（From: 等）は対象外
    if (/^(From|To|Cc|Date|Subject|件名|日付)$/i.test(key)) continue;
    if (!val) continue;
    if (!(key in fields)) order.push(key);
    fields[key] = val;
  }

  var email = fields['メールアドレス'] || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!fields['お名前']) return null;

  return {
    name: fields['お名前'],
    company: fields['貴社名'] || '',
    email: email,
    phone: fields['電話番号'] || '',
    fields: fields,
    order: order
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.parseDocRequest = parseDocRequest;
}
