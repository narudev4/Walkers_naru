#!/usr/bin/env node
/**
 * 適用スクリプト。
 * - 既定は dry-run（書き込みなし）。実書き込みは --apply。
 * - 1件だけ試すには --only=<videoId>。
 * - 各動画は更新直前に最新 snippet を取り直し、title / categoryId / tags 等を保持したまま
 *   description 内の bit.ly のみを置換する（videos.update は snippet 全体送信で他項目が
 *   消えるため、現値を維持する）。
 * - newUrl が不明な mapping を含む動画はスキップ（誤爆防止）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { getAuthedClient } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'report.json');

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

function replaceLinks(desc, mappings) {
  let out = desc;
  for (const m of mappings) {
    if (!m.newUrl) continue;
    out = out.split(m.short).join(m.newUrl);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error('report.json がありません。先に `npm run discover` を実行してください。');
  }
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
  let targets = report.affected;
  if (ONLY) targets = targets.filter((a) => a.videoId === ONLY);
  if (!targets.length) {
    console.log('対象がありません。');
    return;
  }

  const auth = await getAuthedClient();
  const yt = google.youtube({ version: 'v3', auth });

  let updated = 0, skipped = 0;
  for (const a of targets) {
    if (a.mappings.some((m) => !m.newUrl)) {
      console.warn(`⚠️ 不明リンクありスキップ: ${a.title} (${a.videoId})`);
      skipped++;
      continue;
    }
    // 最新 snippet を取り直す
    const r = await yt.videos.list({ part: ['snippet'], id: [a.videoId] });
    const v = r.data.items?.[0];
    if (!v) { console.warn(`動画なしスキップ: ${a.videoId}`); skipped++; continue; }
    const sn = v.snippet;
    const oldDesc = sn.description || '';
    const newDesc = replaceLinks(oldDesc, a.mappings);

    if (newDesc === oldDesc) {
      console.log(`変更なし: ${sn.title} (${a.videoId})`);
      skipped++;
      continue;
    }

    console.log(`\n■ ${sn.title} (${a.videoId})`);
    for (const m of a.mappings) console.log(`   ${m.short} → ${m.newUrl}`);

    if (!APPLY) {
      console.log('   [dry-run] 書き込みなし');
      continue;
    }

    const requestBody = {
      id: a.videoId,
      snippet: {
        title: sn.title,
        categoryId: sn.categoryId,
        description: newDesc,
      },
    };
    if (sn.tags) requestBody.snippet.tags = sn.tags;
    if (sn.defaultLanguage) requestBody.snippet.defaultLanguage = sn.defaultLanguage;
    if (sn.defaultAudioLanguage) requestBody.snippet.defaultAudioLanguage = sn.defaultAudioLanguage;

    await yt.videos.update({ part: ['snippet'], requestBody });
    console.log('   ✅ 更新しました');
    updated++;
  }

  console.log(`\n結果: 更新 ${updated} / スキップ ${skipped} / 対象 ${targets.length}`);
  if (!APPLY) console.log('※ これは dry-run です。実行するには `node apply.js --apply`（1件試すなら --only=<videoId> 併用）');
}

main().catch((e) => { console.error(e); process.exit(1); });
