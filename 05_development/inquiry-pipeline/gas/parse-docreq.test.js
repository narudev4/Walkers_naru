/**
 * parseDocRequest の実データテスト。本文はすべて Gmail から取得した実物。
 *   実行: node parse-docreq.test.js
 */
var parseDocRequest = require('./parse.js').parseDocRequest;

var CASES = [
  {
    label: '渡辺さんの転送メール（引用記号なし・7/26 コマースグロース）',
    body: '---------- Forwarded message ---------\nFrom: WalkersHP-資料請求フォーム <support@walker-s.co.jp>\nDate: 2026年7月26日(日) 12:07\nSubject: 【WalkersHP】資料がダウンロードされました\nTo: <atsushi.watanabe@walker-s.co.jp>, <houta.yamaguchi@walker-s.co.jp>\n\n\nホームページの資料請求フォームから送信がありました。\n\nお名前：佐藤里奈\n貴社名：コマースグロース\nメールアドレス：satorina@comercegrowth.com\n電話番号：09012345678\nご希望の資料：会社概要資料、AIコンサルティング資料、システム開発資料\nご興味のある事業内容：システム開発・Webサービス開発、その他\nシステム開発・Webサービス開発のご予算：〜200万円\nモバイルアプリ開発のご予算：〜200万円\nホームページ・LP制作のご予算：〜20万円\nお役立ち情報の配信：希望する\n',
    expect: {
      name: '佐藤里奈',
      company: 'コマースグロース',
      email: 'satorina@comercegrowth.com',
      phone: '09012345678'
    },
    expectFields: {
      'ご希望の資料': '会社概要資料、AIコンサルティング資料、システム開発資料',
      'ご興味のある事業内容': 'システム開発・Webサービス開発、その他',
      'システム開発・Webサービス開発のご予算': '〜200万円'
    }
  },
  {
    label: '引用記号付きの転送（7/9 StockSun・「ご希望の資料」なし）',
    body: '> ホームページの資料請求フォームから送信がありました。\n>\n> お名前：宇田 晃平\n> 貴社名：StockSun株式会社\n> メールアドレス：StockSun.info@gmail.com\n> 電話番号：080-6421-7280\n> ご興味のある事業内容：その他\n> システム開発・Webサービス開発のご予算：未定\n> モバイルアプリ開発のご予算：未定\n> ホームページ・LP制作のご予算：未定\n> お役立ち情報の配信：希望する\n>\n',
    expect: {
      name: '宇田 晃平',
      company: 'StockSun株式会社',
      email: 'StockSun.info@gmail.com',
      phone: '080-6421-7280'
    },
    expectFields: { 'ご興味のある事業内容': 'その他' },
    expectNoField: 'ご希望の資料'
  },
  {
    label: '転送されていない元メール（直接受信を想定）',
    body: 'ホームページの資料請求フォームから送信がありました。\n\nお名前：山田太郎\n貴社名：株式会社テスト\nメールアドレス：test@example.co.jp\n電話番号：03-1234-5678\nご興味のある事業内容：ホームページ・LP制作\nホームページ・LP制作のご予算：50万円〜100万円\nお役立ち情報の配信：希望しない\n',
    expect: {
      name: '山田太郎', company: '株式会社テスト',
      email: 'test@example.co.jp', phone: '03-1234-5678'
    }
  },
  {
    label: '貴社名なし（個人からの請求）',
    body: 'ホームページの資料請求フォームから送信がありました。\n\nお名前：個人 太郎\nメールアドレス：kojin@example.com\nご興味のある事業内容：その他\n',
    expect: { name: '個人 太郎', company: '', email: 'kojin@example.com', phone: '' }
  },
  {
    label: '不正: メールアドレスが壊れている → null',
    body: 'お名前：壊れ太郎\n貴社名：株式会社壊れ\nメールアドレス：not-an-email\n',
    expectNull: true
  },
  {
    label: '不正: 空文字 → null',
    body: '',
    expectNull: true
  }
];

var pass = 0, fail = 0;
CASES.forEach(function (c) {
  var got = parseDocRequest(c.body);

  if (c.expectNull) {
    if (got === null) { console.log('  OK   ' + c.label); pass++; }
    else { console.log('  FAIL ' + c.label + ' → null を期待したが ' + JSON.stringify(got)); fail++; }
    return;
  }
  if (got === null) { console.log('  FAIL ' + c.label + ' → null が返った'); fail++; return; }

  var bad = [];
  Object.keys(c.expect).forEach(function (k) {
    if (got[k] !== c.expect[k]) bad.push(k + ': 期待"' + c.expect[k] + '" 実際"' + got[k] + '"');
  });
  Object.keys(c.expectFields || {}).forEach(function (k) {
    if (got.fields[k] !== c.expectFields[k]) {
      bad.push('fields.' + k + ': 期待"' + c.expectFields[k] + '" 実際"' + got.fields[k] + '"');
    }
  });
  if (c.expectNoField && (c.expectNoField in got.fields)) {
    bad.push('fields.' + c.expectNoField + ' が存在すべきでない');
  }

  if (bad.length === 0) { console.log('  OK   ' + c.label); pass++; }
  else { console.log('  FAIL ' + c.label); bad.forEach(function (b) { console.log('         ' + b); }); fail++; }
});

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
