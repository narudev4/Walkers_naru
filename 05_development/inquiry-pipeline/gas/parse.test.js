/**
 * parse.js の実データテスト。
 * 本文はすべて Gmail から実際に取得した問い合わせメールの原文。
 *   実行: node parse.test.js
 */
var parseInquiry = require('./parse.js').parseInquiry;

var CASES = [
  {
    label: 'T2ハウス（長文・電話番号あり）',
    body: 'お名前湯原 拓人貴社名株式会社Ｔ２ハウスメールアドレスt.yuhara.t2@gmail.com電話番号08052161446お問い合わせ内容ご担当者様 株式会社T2ハウスの湯原と申します。 現在、生成AIを活用した社内業務の効率化および営業支援の仕組みを構築したいと考えており、伴走いただけるパートナー企業を探しております。 一度オンラインにてお打ち合わせのお時間をいただけますと幸いです。 よろしくお願いいたします。株式会社Walkers から送信',
    expect: {
      name: '湯原 拓人',
      company: '株式会社Ｔ２ハウス',
      email: 't.yuhara.t2@gmail.com',
      phone: '08052161446'
    }
  },
  {
    label: '前田様（1行・電話番号なし・貴社名が「未定」）',
    body: 'お名前前田 藍貴社名未定メールアドレスmaedaaoi1@gmail.comお問い合わせ内容アプリの開発費用の相談株式会社Walkers から送信',
    expect: {
      name: '前田 藍',
      company: '未定',
      email: 'maedaaoi1@gmail.com',
      phone: '',
      content: 'アプリの開発費用の相談'
    }
  },
  {
    label: '阿弥陀寺教育学園（短文）',
    body: 'お名前石井麻美貴社名学校法人阿弥陀寺教育学園メールアドレスa-141@930.or.jp電話番号07043327389お問い合わせ内容専門学校事務の自動化を検討しています。 再試のチケット販売や奨学金対応、証明書発行などになります。株式会社Walkers から送信',
    expect: {
      name: '石井麻美',
      company: '学校法人阿弥陀寺教育学園',
      email: 'a-141@930.or.jp',
      phone: '07043327389'
    }
  },
  {
    label: '鯉幟（ハイフンなし電話番号）',
    body: 'お名前大森正人貴社名鯉幟株式会社メールアドレスmega@koinobori.tokyo電話番号07039938008お問い合わせ内容当方、宅建業者です。 事業者や投資家向けの不動産売買仲介を行っています。 相続シミュレーターwebサイトや営業ツール(物件DB、顧客購入条件DB、他)を自作してますが、限界がありサポートを受けたい。株式会社Walkers から送信',
    expect: {
      name: '大森正人',
      company: '鯉幟株式会社',
      email: 'mega@koinobori.tokyo',
      phone: '07039938008'
    }
  },
  {
    label: 'ripla（本文中にハイフン入り電話番号・URL を含む）',
    body: 'お名前張田谷 魁人貴社名株式会社riplaメールアドレスinfo@ripla.co.jp電話番号090-9239-9885お問い合わせ内容株式会社Walkers ご担当者様 突然のご連絡失礼いたします。 株式会社ripla（https://www.ripla.co.jp/）の張田谷と申します。 ご検討いただけましたら幸いです。株式会社Walkers から送信',
    expect: {
      name: '張田谷 魁人',
      company: '株式会社ripla',
      email: 'info@ripla.co.jp',
      phone: '090-9239-9885'
    }
  },
  {
    label: 'センス・インターナショナル（本文末尾に署名ブロックあり）',
    body: 'お名前大鹿徳夫貴社名株式会社センス・インターナショナルメールアドレスinfo@sense-inter.com電話番号08042366260お問い合わせ内容初めまして。 大阪で飲食店向けのPRをしている会社です。 WEBアプリを作成した場合のお見積もりをお願いできれば助かります。 【予算】 50万希望 ＝＝＝＝＝＝＝＝＝ 株式会社センス・インターナショナル 大鹿徳夫 TEL 06-4792-8968 E-ｍail info@sense-inter.com HP：https://sense-inter.com株式会社Walkers から送信',
    expect: {
      name: '大鹿徳夫',
      company: '株式会社センス・インターナショナル',
      email: 'info@sense-inter.com',
      phone: '08042366260'
    }
  },
  {
    label: '英語スパム（＋記号入り電話番号）',
    body: 'お名前Larhonda Bannerman貴社名Larhonda Bannermanメールアドレスandrewericjohn.s.o.n.0.2@gmail.com電話番号+1 (708) 726-4786お問い合わせ内容Hey there, As an investment representative, I work with a US-based investment company. Best, Larhonda Bannerman株式会社Walkers から送信',
    expect: {
      name: 'Larhonda Bannerman',
      company: 'Larhonda Bannerman',
      email: 'andrewericjohn.s.o.n.0.2@gmail.com',
      phone: '+1 (708) 726-4786'
    }
  },
  {
    label: '改行が含まれるケース（HTML変換で改行が入った場合）',
    body: 'お名前山田太郎\n貴社名株式会社テスト\nメールアドレスtest@example.co.jp\n電話番号03-1234-5678\nお問い合わせ内容改行入りの本文です。\n二行目です。\n株式会社Walkers から送信',
    expect: {
      name: '山田太郎',
      company: '株式会社テスト',
      email: 'test@example.co.jp',
      phone: '03-1234-5678'
    }
  },
  {
    label: '本文中に「お問い合わせ内容」という語が再出現するケース',
    body: 'お名前佐藤花子貴社名株式会社サンプルメールアドレスsato@sample.jp電話番号0312345678お問い合わせ内容先日のお問い合わせ内容について追記します。見積をお願いします。株式会社Walkers から送信',
    expect: {
      name: '佐藤花子',
      company: '株式会社サンプル',
      email: 'sato@sample.jp',
      phone: '0312345678',
      content: '先日のお問い合わせ内容について追記します。見積をお願いします。'
    }
  },
  {
    label: '不正データ: メールアドレスが壊れている → null を返すべき',
    body: 'お名前壊れ太郎貴社名株式会社壊れメールアドレスnot-an-email電話番号000お問い合わせ内容テスト株式会社Walkers から送信',
    expectNull: true
  },
  {
    label: '不正データ: 空文字 → null を返すべき',
    body: '',
    expectNull: true
  }
];

var pass = 0, fail = 0;

CASES.forEach(function (c) {
  var got = parseInquiry(c.body);

  if (c.expectNull) {
    if (got === null) {
      console.log('  OK   ' + c.label);
      pass++;
    } else {
      console.log('  FAIL ' + c.label + ' → null を期待したが ' + JSON.stringify(got));
      fail++;
    }
    return;
  }

  if (got === null) {
    console.log('  FAIL ' + c.label + ' → null が返った');
    fail++;
    return;
  }

  var bad = [];
  Object.keys(c.expect).forEach(function (k) {
    if (got[k] !== c.expect[k]) {
      bad.push(k + ': 期待 "' + c.expect[k] + '" / 実際 "' + got[k] + '"');
    }
  });

  if (bad.length === 0) {
    console.log('  OK   ' + c.label);
    pass++;
  } else {
    console.log('  FAIL ' + c.label);
    bad.forEach(function (b) { console.log('         ' + b); });
    fail++;
  }
});

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
