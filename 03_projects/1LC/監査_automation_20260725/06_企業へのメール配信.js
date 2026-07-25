let config = input.config();
let rec_house_name = config.rec_house_name;
let rec_house_url = config.rec_house_url;

// 安全チェック（要素数が一致しない場合は短い方に合わせる）
let length = Math.min(rec_house_name.length, rec_house_url.length);

// 各物件情報を HTML リンク形式で連結
let outputLines = [];
for (let i = 0; i < length; i++) {
    let name = rec_house_name[i] || '';
    let url = rec_house_url[i] || '';
    outputLines.push(`[${name}](${url})`);
}

// 改行を <br> に変換してGmail用に整形
let result = outputLines.join(' <br>\n');

output.set("house_links_html", result);
