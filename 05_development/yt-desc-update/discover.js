#!/usr/bin/env node
/**
 * 調査スクリプト（書き込みなし）。
 * 1. 認証チャンネルが対象と一致するか確認
 * 2. uploads プレイリストから全動画IDを収集
 * 3. 各動画の概要欄を取得し bit.ly リンクを抽出
 * 4. 各 bit.ly の転送先を解決し、最新の裸URLへの対応付けを算出
 * 5. report.json に出力 + サマリを表示
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { getAuthedClient, TARGET_CHANNEL_ID } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'report.json');

// 最新の正規URL（UTM なし）
const BARE = {
  contact: 'https://walker-s.co.jp/contact/',
  development: 'https://walker-s.co.jp/development/',
  simulation: 'https://simulation.walker-s.co.jp/matching-app/',
};

function classify(finalUrl) {
  try {
    const u = new URL(finalUrl);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'simulation.walker-s.co.jp') return BARE.simulation;
    if (host === 'walker-s.co.jp') {
      if (u.pathname.startsWith('/contact')) return BARE.contact;
      if (u.pathname.startsWith('/development')) return BARE.development;
    }
    return null; // 不明 → 手動確認
  } catch {
    return null;
  }
}

async function resolveRedirect(shortUrl) {
  // 1ホップの Location を取得（bit.ly は 301 で最終URLを返す）
  const res = await fetch(shortUrl, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return res.headers.get('location') || shortUrl;
}

async function main() {
  const auth = await getAuthedClient();
  const yt = google.youtube({ version: 'v3', auth });

  // 認証チャンネル確認
  const me = await yt.channels.list({ part: ['id', 'snippet'], mine: true });
  const myCh = me.data.items?.[0];
  console.log('認証チャンネル:', myCh?.snippet?.title, `(${myCh?.id})`);
  if (myCh?.id !== TARGET_CHANNEL_ID) {
    console.warn(`⚠️ 認証チャンネルが対象(${TARGET_CHANNEL_ID})と一致しません。`);
    console.warn('   同意画面で @walkers-development のチャンネルを選び直してください。');
  }

  // uploads プレイリスト
  const ch = await yt.channels.list({ part: ['contentDetails'], id: [TARGET_CHANNEL_ID] });
  const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('uploads プレイリストを取得できません');

  // 全動画ID収集
  const ids = [];
  let pageToken;
  do {
    const r = await yt.playlistItems.list({
      part: ['contentDetails'], playlistId: uploads, maxResults: 50, pageToken,
    });
    ids.push(...r.data.items.map((i) => i.contentDetails.videoId));
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  console.log('総動画数:', ids.length);

  // 概要欄取得（50件ずつ）
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt.videos.list({ part: ['snippet'], id: ids.slice(i, i + 50) });
    videos.push(...r.data.items);
  }

  // bit.ly 抽出 + 解決
  const bitRe = /https?:\/\/bit\.ly\/[A-Za-z0-9]+/g;
  const cache = {};
  const affected = [];
  for (const v of videos) {
    const desc = v.snippet.description || '';
    const matches = [...new Set(desc.match(bitRe) || [])];
    if (!matches.length) continue;
    const mappings = [];
    for (const m of matches) {
      if (!(m in cache)) {
        try {
          const finalUrl = await resolveRedirect(m);
          cache[m] = { finalUrl, newUrl: classify(finalUrl) };
        } catch (e) {
          cache[m] = { finalUrl: 'ERROR:' + e.message, newUrl: null };
        }
      }
      mappings.push({ short: m, finalUrl: cache[m].finalUrl, newUrl: cache[m].newUrl });
    }
    affected.push({
      videoId: v.id,
      title: v.snippet.title,
      mappings,
    });
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    channel: TARGET_CHANNEL_ID,
    totalVideos: ids.length,
    affected,
  }, null, 2));

  console.log(`\n=== bit.ly を含む動画: ${affected.length} 件 ===`);
  for (const a of affected) {
    console.log(`\n■ ${a.title}`);
    console.log(`  https://youtu.be/${a.videoId}`);
    for (const m of a.mappings) {
      console.log(`   ${m.short}`);
      console.log(`     転送先: ${m.finalUrl}`);
      console.log(`     置換後: ${m.newUrl || '⚠️ 不明（手動確認が必要）'}`);
    }
  }
  const unknown = affected.flatMap((a) => a.mappings).filter((m) => !m.newUrl);
  console.log(`\nreport.json を書き出しました。`);
  if (unknown.length) {
    console.log(`⚠️ 分類できないリンクが ${unknown.length} 件あります。apply 前に確認してください。`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
