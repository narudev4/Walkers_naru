// @ts-check
/**
 * マネーフォワード クラウド請求書 API クライアント（fetch ベース・依存ゼロ）。
 * Bearer 認証で叩き、401（期限切れ）のときは refresh_token で1回だけ更新して再試行する。
 */
import { config } from './config.js';
import { loadTokens, saveTokens } from './tokens.js';
import { refreshTokens } from './oauth.js';

let current = loadTokens();

/** 現在のトークン情報（whoami 等の診断用）。 */
export function currentTokenInfo() {
  if (!current) return null;
  return { source: current.source, scope: current.scope, hasRefresh: Boolean(current.refresh_token) };
}

/**
 * MF 請求書 API を1回叩く。
 * @param {string} path 例: '/office', '/partners', '/invoice_template_billings'
 * @param {{ method?: string, body?: any }} [opts]
 * @returns {Promise<any>} パース済み JSON（204 等で本文が無ければ null）
 */
export async function mfFetch(path, { method = 'GET', body } = {}) {
  if (!current || !current.access_token) {
    throw new Error(
      'アクセストークンがありません。\n' +
        '→ `npm run auth`（推奨）で認可するか、フォールバックとして .env に MF_ACCESS_TOKEN を貼ってください。'
    );
  }

  const send = () =>
    fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${current.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

  let res = await send();

  // 401 → まずディスクのトークンを読み直す（別プロセスが先にリフレッシュ済みのケース）。
  // 同じ refresh_token を2プロセスが同時に使うと後発が invalid_grant で死ぬため、
  // 「ディスクに新しいトークンがあればそれで再試行 → だめなら自分でリフレッシュ」の順にする。
  if (res.status === 401) {
    const disk = loadTokens();
    if (disk && disk.access_token && disk.access_token !== current.access_token) {
      current = disk;
      res = await send();
    }
  }

  // 401 → リフレッシュして1回だけリトライ
  if (res.status === 401 && current.refresh_token) {
    const refreshed = await refreshTokens(current.refresh_token);
    current = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || current.refresh_token,
      token_type: refreshed.token_type,
      scope: refreshed.scope,
      expires_in: refreshed.expires_in,
      source: current.source,
    };
    // 非ローテーションサーバー（refresh応答に refresh_token を含まない）でも
    // ディスクから refresh_token が消えないよう、フォールバック適用済みの current を保存する。
    saveTokens(current);
    res = await send();
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      /* JSON でない応答（エラーHTML等）はそのまま下で扱う */
    }
  }

  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text.slice(0, 600);
    const hint =
      res.status === 401
        ? '（トークンが無効/期限切れ。`npm run auth` で再認可してください）'
        : res.status === 403
          ? '（スコープ不足の可能性。アプリに mfc/invoice/data.write を付与してください）'
          : '';
    throw new Error(`MF API ${method} ${path} → HTTP ${res.status} ${hint}\n${detail}`);
  }

  return json;
}
