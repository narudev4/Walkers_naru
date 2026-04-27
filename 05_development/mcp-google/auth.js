#!/usr/bin/env node
/**
 * Google OAuth2 認証ヘルパー
 * 初回のアクセストークン取得に使用
 * Usage: node auth.js
 */

const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");
const PORT = 3939;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Sheets + Docs + Drive + Slides + Chat + Gmail の全スコープ
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error("credentials.json が見つかりません。先に作成してください。");
    console.error('形式: { "client_id": "...", "client_secret": "..." }');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = creds;

  if (!client_id || !client_secret) {
    console.error("credentials.json に client_id と client_secret が必要です。");
    process.exit(1);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `http://localhost:${PORT}/callback`;

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\n=== Google OAuth2 認証 ===\n");
  console.log("ブラウザで以下のURLを開いて認証してください:\n");
  console.log(authUrl.toString());
  console.log("\nブラウザを自動で開きます...\n");

  try {
    execSync(`open "${authUrl.toString()}"`);
  } catch {
    console.log("ブラウザを自動で開けませんでした。上のURLを手動で開いてください。");
  }

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const code = reqUrl.searchParams.get("code");
      const returnedState = reqUrl.searchParams.get("state");

      if (returnedState !== state) {
        res.writeHead(400);
        res.end("State mismatch - CSRF検証に失敗しました");
        server.close();
        resolve();
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end("認可コードが取得できませんでした");
        server.close();
        resolve();
        return;
      }

      try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id,
            client_secret,
          }).toString(),
        });

        const tokenData = await tokenRes.json();

        if (tokenData.error) {
          throw new Error(
            `${tokenData.error}: ${tokenData.error_description}`
          );
        }

        const tokenInfo = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type,
          expires_in: tokenData.expires_in,
          created_at: Date.now(),
        };

        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenInfo, null, 2));
        console.log("トークンを token.json に保存しました！");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h1>Google認証成功！</h1><p>Sheets / Docs / Drive / Slides / Chat / Gmail のアクセスが許可されました。このタブを閉じてください。</p>"
        );
      } catch (err) {
        console.error("トークン取得エラー:", err.message);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>エラー</h1><p>${err.message}</p>`);
      }

      server.close();
      resolve();
    });

    server.listen(PORT, () => {
      console.log(`コールバックサーバーを localhost:${PORT} で待機中...`);
    });
  });
}

main().catch(console.error);
