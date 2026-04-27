#!/usr/bin/env node
/**
 * Google MCP Server — Full Edition
 * Claude Code から Google Drive / Docs / Sheets / Slides / Chat / Gmail の全操作を提供
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");

// ── 設定 ──
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");

// ── トークン管理 ──
function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      "credentials.json が見つかりません。先に auth.js で認証してください。"
    );
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      "token.json が見つかりません。先に node auth.js で認証してください。"
    );
  }
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
}

function saveToken(tokenData) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
}

function isTokenExpired(token) {
  if (!token.created_at || !token.expires_in) return true;
  const expiresAt = token.created_at + token.expires_in * 1000;
  return Date.now() > expiresAt - 5 * 60 * 1000;
}

async function getAccessToken() {
  let token = loadToken();

  if (isTokenExpired(token)) {
    const creds = loadCredentials();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
      }).toString(),
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(
        `トークンリフレッシュ失敗: ${data.error} - ${data.error_description || ""}`
      );
    }

    const newToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || token.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      created_at: Date.now(),
    };
    saveToken(newToken);
    token = newToken;
  }

  return token.access_token;
}

// ── API呼び出しヘルパー ──
async function googleApi(method, url, body = null) {
  const accessToken = await getAccessToken();
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  };

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (res.status === 204) return { success: true };

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Google API エラー (${res.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

// DELETEで204を返すAPI用
async function googleApiDelete(url) {
  const accessToken = await getAccessToken();
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204 || res.status === 200) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Google API エラー (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

// Driveファイルエクスポート用（バイナリ）
async function googleApiRaw(url) {
  const accessToken = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API エラー (${res.status}): ${text}`);
  }
  return res;
}

// ── MCPサーバー定義 ──
const server = new McpServer({
  name: "google",
  version: "2.0.0",
});

// ============================================================
// Google Drive ツール（全操作）
// ============================================================

server.tool(
  "google_drive_search",
  "Google Driveでファイルを検索する",
  {
    query: z.string().describe("検索クエリ（ファイル名、キーワード等）"),
    type: z
      .enum(["all", "document", "spreadsheet", "presentation", "folder", "pdf", "image"])
      .optional()
      .describe("ファイルタイプで絞り込み"),
    max_results: z.number().optional().describe("最大件数（デフォルト: 20）"),
  },
  async ({ query, type, max_results }) => {
    let q = `name contains '${query.replace(/'/g, "\\'")}'`;
    if (query.includes(" ")) {
      q = `fullText contains '${query.replace(/'/g, "\\'")}'`;
    }

    const mimeMap = {
      document: "application/vnd.google-apps.document",
      spreadsheet: "application/vnd.google-apps.spreadsheet",
      presentation: "application/vnd.google-apps.presentation",
      folder: "application/vnd.google-apps.folder",
      pdf: "application/pdf",
      image: "image/",
    };
    if (type && type !== "all" && mimeMap[type]) {
      if (type === "image") {
        q += ` and mimeType contains 'image/'`;
      } else {
        q += ` and mimeType='${mimeMap[type]}'`;
      }
    }
    q += " and trashed=false";

    const limit = max_results || 20;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink,owners,size,parents)&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const data = await googleApi("GET", url);

    const results = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType,
      modified: f.modifiedTime,
      size: f.size,
      url: f.webViewLink,
      parents: f.parents,
    }));

    return {
      content: [{
        type: "text",
        text: results.length > 0
          ? JSON.stringify(results, null, 2)
          : `「${query}」に一致するファイルが見つかりませんでした。`,
      }],
    };
  }
);

server.tool(
  "google_drive_get_file",
  "Google Driveのファイル情報を取得する",
  {
    file_id: z.string().describe("ファイルID"),
  },
  async ({ file_id }) => {
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}?fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,description,parents,shared,permissions&supportsAllDrives=true`;
    const data = await googleApi("GET", url);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "google_drive_list_folder",
  "Google Driveのフォルダ内のファイル一覧を取得する",
  {
    folder_id: z.string().optional().describe("フォルダID（省略時はマイドライブのルート）"),
    max_results: z.number().optional().describe("最大件数（デフォルト: 50）"),
  },
  async ({ folder_id, max_results }) => {
    const fid = folder_id || "root";
    const limit = max_results || 50;
    const q = `'${fid}' in parents and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=folder,modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const data = await googleApi("GET", url);

    const results = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType,
      modified: f.modifiedTime,
      size: f.size,
      url: f.webViewLink,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "google_drive_rename",
  "Google Driveのファイル/フォルダの名前を変更する",
  {
    file_id: z.string().describe("ファイルID"),
    new_name: z.string().describe("新しいファイル名"),
  },
  async ({ file_id, new_name }) => {
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}?supportsAllDrives=true`;
    const data = await googleApi("PATCH", url, { name: new_name });
    return {
      content: [{ type: "text", text: `リネーム完了: ${data.name || new_name}（ID: ${file_id}）` }],
    };
  }
);

server.tool(
  "google_drive_move",
  "Google Driveのファイルを別のフォルダに移動する",
  {
    file_id: z.string().describe("ファイルID"),
    destination_folder_id: z.string().describe("移動先のフォルダID"),
    source_folder_id: z.string().optional().describe("移動元のフォルダID（省略時は自動取得）"),
  },
  async ({ file_id, destination_folder_id, source_folder_id }) => {
    let removeParent = source_folder_id;
    if (!removeParent) {
      const fileInfo = await googleApi("GET", `https://www.googleapis.com/drive/v3/files/${file_id}?fields=parents&supportsAllDrives=true`);
      removeParent = (fileInfo.parents || [])[0] || "root";
    }
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}?addParents=${destination_folder_id}&removeParents=${removeParent}&fields=id,name,parents&supportsAllDrives=true`;
    const data = await googleApi("PATCH", url, {});
    return {
      content: [{ type: "text", text: `移動完了: ${data.name}（新しい親フォルダ: ${destination_folder_id}）` }],
    };
  }
);

server.tool(
  "google_drive_copy",
  "Google Driveのファイルをコピーする",
  {
    file_id: z.string().describe("コピー元のファイルID"),
    new_name: z.string().optional().describe("コピー先のファイル名（省略時は「〇〇のコピー」）"),
    folder_id: z.string().optional().describe("コピー先のフォルダID（省略時は同じフォルダ）"),
  },
  async ({ file_id, new_name, folder_id }) => {
    const body = {};
    if (new_name) body.name = new_name;
    if (folder_id) body.parents = [folder_id];
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}/copy?fields=id,name,webViewLink&supportsAllDrives=true`;
    const data = await googleApi("POST", url, body);
    return {
      content: [{ type: "text", text: `コピー完了:\n名前: ${data.name}\nID: ${data.id}\nURL: ${data.webViewLink || "N/A"}` }],
    };
  }
);

server.tool(
  "google_drive_delete",
  "Google Driveのファイル/フォルダをゴミ箱に移動する",
  {
    file_id: z.string().describe("ファイルID"),
    permanent: z.boolean().optional().default(false).describe("完全削除するか（デフォルト: false=ゴミ箱へ移動）"),
  },
  async ({ file_id, permanent }) => {
    if (permanent) {
      await googleApiDelete(`https://www.googleapis.com/drive/v3/files/${file_id}?supportsAllDrives=true`);
      return { content: [{ type: "text", text: `ファイル ${file_id} を完全に削除しました。` }] };
    } else {
      await googleApi("PATCH", `https://www.googleapis.com/drive/v3/files/${file_id}?supportsAllDrives=true`, { trashed: true });
      return { content: [{ type: "text", text: `ファイル ${file_id} をゴミ箱に移動しました。` }] };
    }
  }
);

server.tool(
  "google_drive_create_folder",
  "Google Driveに新しいフォルダを作成する",
  {
    name: z.string().describe("フォルダ名"),
    parent_folder_id: z.string().optional().describe("親フォルダID（省略時はマイドライブ直下）"),
  },
  async ({ name, parent_folder_id }) => {
    const body = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parent_folder_id) body.parents = [parent_folder_id];
    const url = "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink";
    const data = await googleApi("POST", url, body);
    return {
      content: [{ type: "text", text: `フォルダ作成完了:\n名前: ${data.name}\nID: ${data.id}\nURL: ${data.webViewLink || "N/A"}` }],
    };
  }
);

server.tool(
  "google_drive_share",
  "Google Driveのファイル/フォルダの共有設定を変更する",
  {
    file_id: z.string().describe("ファイルID"),
    email: z.string().optional().describe("共有先メールアドレス（anyone指定時は不要）"),
    role: z.enum(["reader", "writer", "commenter", "owner"]).describe("権限（reader/writer/commenter/owner）"),
    type: z.enum(["user", "group", "domain", "anyone"]).optional().default("user").describe("共有タイプ（デフォルト: user）"),
    send_notification: z.boolean().optional().default(true).describe("通知メールを送るか"),
  },
  async ({ file_id, email, role, type, send_notification }) => {
    const permission = { role, type: type || "user" };
    if (email) permission.emailAddress = email;
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}/permissions?sendNotificationEmail=${send_notification !== false}&supportsAllDrives=true`;
    const data = await googleApi("POST", url, permission);
    return {
      content: [{ type: "text", text: `共有設定完了: ${email || type} に ${role} 権限を付与しました。（permissionId: ${data.id}）` }],
    };
  }
);

server.tool(
  "google_drive_list_permissions",
  "Google Driveのファイル/フォルダの共有設定一覧を取得する",
  {
    file_id: z.string().describe("ファイルID"),
  },
  async ({ file_id }) => {
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}/permissions?fields=permissions(id,emailAddress,role,type,displayName)&supportsAllDrives=true`;
    const data = await googleApi("GET", url);
    return {
      content: [{ type: "text", text: JSON.stringify(data.permissions || [], null, 2) }],
    };
  }
);

server.tool(
  "google_drive_remove_permission",
  "Google Driveのファイル/フォルダから共有設定を削除する",
  {
    file_id: z.string().describe("ファイルID"),
    permission_id: z.string().describe("削除するpermission ID"),
  },
  async ({ file_id, permission_id }) => {
    await googleApiDelete(`https://www.googleapis.com/drive/v3/files/${file_id}/permissions/${permission_id}?supportsAllDrives=true`);
    return { content: [{ type: "text", text: `共有設定を削除しました（permissionId: ${permission_id}）` }] };
  }
);

server.tool(
  "google_drive_export",
  "GoogleドキュメントをPDF/DOCX等にエクスポートしてローカルに保存する",
  {
    file_id: z.string().describe("ファイルID（Google Docs/Sheets/Slides）"),
    mime_type: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
      "text/html",
    ]).describe("エクスポート形式のMIMEタイプ"),
    output_path: z.string().describe("保存先のローカルファイルパス"),
  },
  async ({ file_id, mime_type, output_path }) => {
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}/export?mimeType=${encodeURIComponent(mime_type)}&supportsAllDrives=true`;
    const res = await googleApiRaw(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(output_path, buffer);
    return {
      content: [{ type: "text", text: `エクスポート完了: ${output_path}（${buffer.length} bytes）` }],
    };
  }
);

server.tool(
  "google_drive_update_metadata",
  "Google Driveのファイルメタデータを更新する（名前・説明等）",
  {
    file_id: z.string().describe("ファイルID"),
    name: z.string().optional().describe("新しいファイル名"),
    description: z.string().optional().describe("新しい説明"),
    starred: z.boolean().optional().describe("スター付きにするか"),
  },
  async ({ file_id, name, description, starred }) => {
    const body = {};
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    if (starred !== undefined) body.starred = starred;
    const url = `https://www.googleapis.com/drive/v3/files/${file_id}?fields=id,name,description,starred&supportsAllDrives=true`;
    const data = await googleApi("PATCH", url, body);
    return {
      content: [{ type: "text", text: `メタデータ更新完了: ${JSON.stringify(data, null, 2)}` }],
    };
  }
);

// ============================================================
// Google Docs ツール（全操作）
// ============================================================

server.tool(
  "google_docs_get",
  "Google Docsのドキュメント内容をテキストで取得する",
  {
    document_id: z.string().describe("ドキュメントID"),
  },
  async ({ document_id }) => {
    const url = `https://docs.googleapis.com/v1/documents/${document_id}`;
    const data = await googleApi("GET", url);

    let text = "";
    if (data.body && data.body.content) {
      for (const element of data.body.content) {
        if (element.paragraph) {
          for (const el of element.paragraph.elements || []) {
            if (el.textRun) text += el.textRun.content;
          }
        } else if (element.table) {
          for (const row of element.table.tableRows || []) {
            const cells = [];
            for (const cell of row.tableCells || []) {
              let cellText = "";
              for (const p of cell.content || []) {
                if (p.paragraph) {
                  for (const el of p.paragraph.elements || []) {
                    if (el.textRun) cellText += el.textRun.content.trim();
                  }
                }
              }
              cells.push(cellText);
            }
            text += "| " + cells.join(" | ") + " |\n";
          }
          text += "\n";
        }
      }
    }

    return {
      content: [{ type: "text", text: `# ${data.title || "無題"}\n\n${text}` }],
    };
  }
);

server.tool(
  "google_docs_create",
  "新しいGoogle Docsドキュメントを作成する",
  {
    title: z.string().describe("ドキュメントのタイトル"),
    body: z.string().optional().describe("本文テキスト（省略可）"),
    folder_id: z.string().optional().describe("保存先フォルダID（省略時はマイドライブ直下）"),
  },
  async ({ title, body, folder_id }) => {
    const createUrl = "https://docs.googleapis.com/v1/documents";
    const doc = await googleApi("POST", createUrl, { title });
    const docId = doc.documentId;

    if (body && body.trim()) {
      const updateUrl = `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`;
      await googleApi("POST", updateUrl, {
        requests: [{ insertText: { location: { index: 1 }, text: body } }],
      });
    }

    if (folder_id) {
      const moveUrl = `https://www.googleapis.com/drive/v3/files/${docId}?addParents=${folder_id}&removeParents=root&supportsAllDrives=true`;
      await googleApi("PATCH", moveUrl, {});
    }

    return {
      content: [{
        type: "text",
        text: `ドキュメントを作成しました。\n\nタイトル: ${title}\nID: ${docId}\nURL: https://docs.google.com/document/d/${docId}/edit`,
      }],
    };
  }
);

server.tool(
  "google_docs_append",
  "Google Docsドキュメントの末尾にテキストを追記する",
  {
    document_id: z.string().describe("ドキュメントID"),
    text: z.string().describe("追記するテキスト"),
  },
  async ({ document_id, text }) => {
    const getUrl = `https://docs.googleapis.com/v1/documents/${document_id}`;
    const doc = await googleApi("GET", getUrl);

    let endIndex = 1;
    if (doc.body.content && doc.body.content.length > 0) {
      const lastElement = doc.body.content[doc.body.content.length - 1];
      endIndex = Math.max(lastElement.endIndex - 1, 1);
    }

    const updateUrl = `https://docs.googleapis.com/v1/documents/${document_id}:batchUpdate`;
    await googleApi("POST", updateUrl, {
      requests: [{ insertText: { location: { index: endIndex }, text: "\n" + text } }],
    });

    return {
      content: [{ type: "text", text: `ドキュメント ${document_id} にテキストを追記しました。` }],
    };
  }
);

server.tool(
  "google_docs_batch_update",
  "Google DocsにbatchUpdateリクエストを送信する（見出し・テーブル等の高度な操作）",
  {
    document_id: z.string().describe("ドキュメントID"),
    requests: z.string().describe("batchUpdateのrequests配列（JSON文字列）"),
  },
  async ({ document_id, requests }) => {
    let parsed;
    try { parsed = JSON.parse(requests); } catch (e) {
      return { content: [{ type: "text", text: `JSON パースエラー: ${e.message}` }] };
    }
    const url = `https://docs.googleapis.com/v1/documents/${document_id}:batchUpdate`;
    const data = await googleApi("POST", url, { requests: parsed });
    return {
      content: [{ type: "text", text: `batchUpdate完了。${(data.replies || []).length} 件のリクエストを処理しました。` }],
    };
  }
);

// ============================================================
// Google Sheets ツール（全操作）
// ============================================================

server.tool(
  "google_sheets_get_info",
  "スプレッドシートの情報（シート名一覧等）を取得する",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
  },
  async ({ spreadsheet_id }) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}?fields=spreadsheetId,properties.title,sheets.properties`;
    const data = await googleApi("GET", url);

    const sheets = (data.sheets || []).map((s) => ({
      id: s.properties.sheetId,
      title: s.properties.title,
      rows: s.properties.gridProperties?.rowCount,
      cols: s.properties.gridProperties?.columnCount,
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ title: data.properties?.title, spreadsheetId: data.spreadsheetId, sheets }, null, 2),
      }],
    };
  }
);

server.tool(
  "google_sheets_read",
  "スプレッドシートのセル範囲を読み取る",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    range: z.string().describe("範囲（例: 'Sheet1!A1:D10', 'Sheet1'）"),
  },
  async ({ spreadsheet_id, range }) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}`;
    const data = await googleApi("GET", url);
    return {
      content: [{ type: "text", text: JSON.stringify({ range: data.range, values: data.values || [] }, null, 2) }],
    };
  }
);

server.tool(
  "google_sheets_batch_read",
  "スプレッドシートの複数範囲を一括で読み取る",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    ranges: z.array(z.string()).describe("範囲の配列（例: ['Sheet1!A1:D10', 'Sheet2!A1:B5']）"),
  },
  async ({ spreadsheet_id, ranges }) => {
    const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values:batchGet?${params}`;
    const data = await googleApi("GET", url);
    const results = (data.valueRanges || []).map((vr) => ({
      range: vr.range,
      values: vr.values || [],
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "google_sheets_write",
  "スプレッドシートのセル範囲にデータを書き込む",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    range: z.string().describe("範囲（例: 'Sheet1!A1:D10'）"),
    values: z.string().describe("書き込むデータ（2次元配列のJSON文字列）"),
  },
  async ({ spreadsheet_id, range, values }) => {
    let parsed;
    try { parsed = JSON.parse(values); } catch (e) {
      return { content: [{ type: "text", text: `JSON パースエラー: ${e.message}` }] };
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const data = await googleApi("PUT", url, { range, majorDimension: "ROWS", values: parsed });
    return {
      content: [{ type: "text", text: `${data.updatedCells || 0} セルを更新しました（範囲: ${data.updatedRange || range}）` }],
    };
  }
);

server.tool(
  "google_sheets_append",
  "スプレッドシートの末尾に行を追加する",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    range: z.string().describe("追加先のシート範囲（例: 'Sheet1!A:Z'）"),
    values: z.string().describe("追加する行データ（2次元配列のJSON文字列）"),
  },
  async ({ spreadsheet_id, range, values }) => {
    let parsed;
    try { parsed = JSON.parse(values); } catch (e) {
      return { content: [{ type: "text", text: `JSON パースエラー: ${e.message}` }] };
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const data = await googleApi("POST", url, { range, majorDimension: "ROWS", values: parsed });
    return {
      content: [{ type: "text", text: `${data.updates?.updatedRows || parsed.length} 行を追加しました。` }],
    };
  }
);

server.tool(
  "google_sheets_clear",
  "スプレッドシートの指定範囲をクリアする",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    range: z.string().describe("クリアする範囲（例: 'Sheet1!A1:D10'）"),
  },
  async ({ spreadsheet_id, range }) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}:clear`;
    const data = await googleApi("POST", url, {});
    return {
      content: [{ type: "text", text: `範囲 ${data.clearedRange || range} をクリアしました。` }],
    };
  }
);

server.tool(
  "google_sheets_create",
  "新しいスプレッドシートを作成する",
  {
    title: z.string().describe("スプレッドシートのタイトル"),
    sheets: z.array(z.string()).optional().describe("シート名の配列（省略時はデフォルト1シート）"),
  },
  async ({ title, sheets }) => {
    const body = { properties: { title } };
    if (sheets && sheets.length > 0) {
      body.sheets = sheets.map((name) => ({ properties: { title: name } }));
    }
    const url = "https://sheets.googleapis.com/v4/spreadsheets";
    const data = await googleApi("POST", url, body);
    return {
      content: [{ type: "text", text: `スプレッドシートを作成しました。\n\nタイトル: ${title}\nID: ${data.spreadsheetId}\nURL: ${data.spreadsheetUrl}` }],
    };
  }
);

server.tool(
  "google_sheets_add_sheet",
  "スプレッドシートに新しいシート（タブ）を追加する",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    title: z.string().describe("新しいシート名"),
  },
  async ({ spreadsheet_id, title }) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}:batchUpdate`;
    const data = await googleApi("POST", url, {
      requests: [{ addSheet: { properties: { title } } }],
    });
    const newSheet = data.replies?.[0]?.addSheet?.properties;
    return {
      content: [{ type: "text", text: `シート「${title}」を追加しました。（sheetId: ${newSheet?.sheetId}）` }],
    };
  }
);

server.tool(
  "google_sheets_delete_sheet",
  "スプレッドシートのシート（タブ）を削除する",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    sheet_id: z.number().describe("削除するシートのID（sheetId、シート名ではない）"),
  },
  async ({ spreadsheet_id, sheet_id }) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}:batchUpdate`;
    await googleApi("POST", url, {
      requests: [{ deleteSheet: { sheetId: sheet_id } }],
    });
    return {
      content: [{ type: "text", text: `シート（sheetId: ${sheet_id}）を削除しました。` }],
    };
  }
);

server.tool(
  "google_sheets_batch_update",
  "スプレッドシートにbatchUpdateリクエストを送信する（書式設定・シート操作・グラフ等）",
  {
    spreadsheet_id: z.string().describe("スプレッドシートID"),
    requests: z.string().describe("batchUpdateのrequests配列（JSON文字列）"),
  },
  async ({ spreadsheet_id, requests }) => {
    let parsed;
    try { parsed = JSON.parse(requests); } catch (e) {
      return { content: [{ type: "text", text: `JSON パースエラー: ${e.message}` }] };
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}:batchUpdate`;
    const data = await googleApi("POST", url, { requests: parsed });
    return {
      content: [{ type: "text", text: `batchUpdate完了。${(data.replies || []).length} 件のリクエストを処理しました。` }],
    };
  }
);

// ============================================================
// Google Chat ツール
// ============================================================

server.tool(
  "google_chat_list_spaces",
  "Google Chatのスペース（チャットルーム）一覧を取得する",
  {
    max_results: z.number().optional().describe("最大件数（デフォルト: 50）"),
  },
  async ({ max_results }) => {
    const limit = max_results || 50;
    const url = `https://chat.googleapis.com/v1/spaces?pageSize=${limit}`;
    const data = await googleApi("GET", url);

    const spaces = (data.spaces || []).map((s) => ({
      name: s.name,
      displayName: s.displayName || "(DM)",
      type: s.type,
      spaceType: s.spaceType,
      threaded: s.threadedSpace || false,
    }));

    return {
      content: [{
        type: "text",
        text: spaces.length > 0
          ? JSON.stringify(spaces, null, 2)
          : "アクセス可能なスペースが見つかりませんでした。",
      }],
    };
  }
);

server.tool(
  "google_chat_get_space",
  "Google Chatの特定のスペース情報を取得する",
  {
    space_name: z.string().describe("スペース名（例: spaces/AAAAxxxxxx）"),
  },
  async ({ space_name }) => {
    const name = space_name.startsWith("spaces/") ? space_name : `spaces/${space_name}`;
    const url = `https://chat.googleapis.com/v1/${name}`;
    const data = await googleApi("GET", url);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "google_chat_send_message",
  "Google Chatのスペースにメッセージを送信する",
  {
    space_name: z.string().describe("スペース名（例: spaces/AAAAxxxxxx）"),
    text: z.string().describe("送信するメッセージテキスト"),
  },
  async ({ space_name, text }) => {
    const name = space_name.startsWith("spaces/") ? space_name : `spaces/${space_name}`;
    const url = `https://chat.googleapis.com/v1/${name}/messages`;
    const data = await googleApi("POST", url, { text });
    return {
      content: [{ type: "text", text: `メッセージを送信しました。\nスペース: ${name}\nメッセージID: ${data.name || "N/A"}` }],
    };
  }
);

server.tool(
  "google_chat_list_messages",
  "Google Chatのスペース内のメッセージ履歴を取得する",
  {
    space_name: z.string().describe("スペース名（例: spaces/AAAAxxxxxx）"),
    max_results: z.number().optional().describe("最大件数（デフォルト: 25）"),
  },
  async ({ space_name, max_results }) => {
    const name = space_name.startsWith("spaces/") ? space_name : `spaces/${space_name}`;
    const limit = max_results || 25;
    const url = `https://chat.googleapis.com/v1/${name}/messages?pageSize=${limit}&orderBy=createTime desc`;
    const data = await googleApi("GET", url);

    const messages = (data.messages || []).map((m) => ({
      name: m.name,
      sender: m.sender?.displayName || m.sender?.name || "不明",
      text: m.text || "",
      createTime: m.createTime,
    }));

    return {
      content: [{
        type: "text",
        text: messages.length > 0
          ? JSON.stringify(messages, null, 2)
          : "メッセージが見つかりませんでした。",
      }],
    };
  }
);

server.tool(
  "google_chat_list_members",
  "Google Chatのスペースのメンバー一覧を取得する",
  {
    space_name: z.string().describe("スペース名（例: spaces/AAAAxxxxxx）"),
  },
  async ({ space_name }) => {
    const name = space_name.startsWith("spaces/") ? space_name : `spaces/${space_name}`;
    const url = `https://chat.googleapis.com/v1/${name}/members?pageSize=100`;
    const data = await googleApi("GET", url);

    const members = (data.memberships || []).map((m) => ({
      name: m.name,
      displayName: m.member?.displayName || "不明",
      email: m.member?.email || "",
      role: m.role,
      type: m.member?.type,
    }));

    return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
  }
);

// ============================================================
// Google Slides ツール（全操作）
// ============================================================

server.tool(
  "google_slides_get",
  "Google Slidesプレゼンテーションの情報とスライド一覧を取得する",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
  },
  async ({ presentation_id }) => {
    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}`;
    const data = await googleApi("GET", url);

    const slides = (data.slides || []).map((s, i) => {
      const texts = [];
      for (const el of s.pageElements || []) {
        if (el.shape?.text?.textElements) {
          for (const te of el.shape.text.textElements) {
            if (te.textRun?.content?.trim()) texts.push(te.textRun.content.trim());
          }
        }
        if (el.table) {
          for (const row of el.table.tableRows || []) {
            const cells = [];
            for (const cell of row.tableCells || []) {
              let cellText = "";
              if (cell.text?.textElements) {
                for (const te of cell.text.textElements) {
                  if (te.textRun?.content?.trim()) cellText += te.textRun.content.trim();
                }
              }
              cells.push(cellText);
            }
            texts.push("| " + cells.join(" | ") + " |");
          }
        }
      }
      return { index: i, objectId: s.objectId, texts: texts.join("\n") };
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          title: data.title || "無題",
          presentationId: data.presentationId,
          slideCount: slides.length,
          pageSize: data.pageSize,
          slides,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "google_slides_get_slide",
  "Google Slidesの特定スライドの詳細（全テキスト・テーブル・要素ID）を取得する",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
    slide_index: z.number().describe("スライド番号（0始まり）"),
  },
  async ({ presentation_id, slide_index }) => {
    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}`;
    const data = await googleApi("GET", url);

    const slide = (data.slides || [])[slide_index];
    if (!slide) {
      return { content: [{ type: "text", text: `スライド ${slide_index} が見つかりません（全${(data.slides || []).length}枚）` }] };
    }

    const elements = (slide.pageElements || []).map((el) => {
      const info = {
        objectId: el.objectId,
        type: el.shape ? "shape" : el.table ? "table" : el.image ? "image" : "other",
        size: el.size,
        transform: el.transform,
      };
      if (el.shape?.text?.textElements) {
        info.text = el.shape.text.textElements
          .filter((te) => te.textRun?.content)
          .map((te) => te.textRun.content)
          .join("");
      }
      if (el.shape?.shapeType) info.shapeType = el.shape.shapeType;
      if (el.table) {
        info.rows = el.table.rows;
        info.columns = el.table.columns;
        info.tableData = (el.table.tableRows || []).map((row) =>
          (row.tableCells || []).map((cell) => {
            if (cell.text?.textElements) {
              return cell.text.textElements
                .filter((te) => te.textRun?.content)
                .map((te) => te.textRun.content)
                .join("");
            }
            return "";
          })
        );
      }
      return info;
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ slideIndex: slide_index, objectId: slide.objectId, elementCount: elements.length, elements }, null, 2),
      }],
    };
  }
);

server.tool(
  "google_slides_create",
  "新しいGoogle Slidesプレゼンテーションを作成する",
  {
    title: z.string().describe("プレゼンテーションのタイトル"),
    folder_id: z.string().optional().describe("保存先フォルダID（省略時はマイドライブ直下）"),
  },
  async ({ title, folder_id }) => {
    const url = "https://slides.googleapis.com/v1/presentations";
    const data = await googleApi("POST", url, { title });
    const presentationId = data.presentationId;

    if (folder_id) {
      const moveUrl = `https://www.googleapis.com/drive/v3/files/${presentationId}?addParents=${folder_id}&removeParents=root&supportsAllDrives=true`;
      await googleApi("PATCH", moveUrl, {});
    }

    return {
      content: [{
        type: "text",
        text: `プレゼンテーションを作成しました。\n\nタイトル: ${title}\nID: ${presentationId}\nURL: https://docs.google.com/presentation/d/${presentationId}/edit`,
      }],
    };
  }
);

server.tool(
  "google_slides_add_slide",
  "Google Slidesにスライドを追加する",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
    layout: z.enum(["BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS", "TITLE_ONLY", "SECTION_HEADER", "ONE_COLUMN_TEXT", "MAIN_POINT", "BIG_NUMBER"]).optional().default("BLANK").describe("レイアウトタイプ"),
    insert_at: z.number().optional().describe("挿入位置（0始まり、省略時は末尾）"),
  },
  async ({ presentation_id, layout, insert_at }) => {
    // まずレイアウトIDを取得
    const getUrl = `https://slides.googleapis.com/v1/presentations/${presentation_id}`;
    const pres = await googleApi("GET", getUrl);

    // レイアウトを検索
    let layoutId = null;
    for (const master of pres.masters || []) {
      for (const l of master.layouts || []) {
        if (l.layoutProperties?.name === layout || l.layoutProperties?.displayName === layout) {
          layoutId = l.objectId;
          break;
        }
      }
      if (layoutId) break;
    }

    const request = { createSlide: {} };
    if (layoutId) {
      request.createSlide.slideLayoutReference = { layoutId };
    } else {
      request.createSlide.slideLayoutReference = { predefinedLayout: layout || "BLANK" };
    }
    if (insert_at !== undefined) {
      request.createSlide.insertionIndex = insert_at;
    }

    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}:batchUpdate`;
    const data = await googleApi("POST", url, { requests: [request] });
    const newSlideId = data.replies?.[0]?.createSlide?.objectId;

    return {
      content: [{ type: "text", text: `スライドを追加しました。（objectId: ${newSlideId}）` }],
    };
  }
);

server.tool(
  "google_slides_duplicate_slide",
  "Google Slidesの既存スライドを複製する",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
    slide_object_id: z.string().describe("複製するスライドのobjectId"),
    insert_at: z.number().optional().describe("挿入位置（0始まり、省略時は元スライドの直後）"),
  },
  async ({ presentation_id, slide_object_id, insert_at }) => {
    const request = {
      duplicateObject: { objectId: slide_object_id },
    };
    // insertionIndex は duplicateObject では直接指定できないので、
    // 複製後に moveSlide で移動する
    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}:batchUpdate`;
    const data = await googleApi("POST", url, { requests: [request] });
    const newSlideId = data.replies?.[0]?.duplicateObject?.objectId;

    return {
      content: [{ type: "text", text: `スライドを複製しました。（新objectId: ${newSlideId}）` }],
    };
  }
);

server.tool(
  "google_slides_delete_slide",
  "Google Slidesのスライドを削除する",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
    slide_object_id: z.string().describe("削除するスライドのobjectId"),
  },
  async ({ presentation_id, slide_object_id }) => {
    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}:batchUpdate`;
    await googleApi("POST", url, {
      requests: [{ deleteObject: { objectId: slide_object_id } }],
    });
    return {
      content: [{ type: "text", text: `スライド ${slide_object_id} を削除しました。` }],
    };
  }
);

server.tool(
  "google_slides_replace_text",
  "Google Slides内のテキストを一括置換する",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
    replacements: z.string().describe('置換ペアの配列（JSON文字列）例: [{"old": "旧テキスト", "new": "新テキスト"}]'),
  },
  async ({ presentation_id, replacements }) => {
    let parsed;
    try { parsed = JSON.parse(replacements); } catch (e) {
      return { content: [{ type: "text", text: `JSONパースエラー: ${e.message}` }] };
    }

    const requests = parsed.map((r) => ({
      replaceAllText: {
        containsText: { text: r.old, matchCase: true },
        replaceText: r.new,
      },
    }));

    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}:batchUpdate`;
    const data = await googleApi("POST", url, { requests });

    const results = (data.replies || []).map((r, i) => ({
      old: parsed[i].old,
      new: parsed[i].new,
      occurrences: r.replaceAllText?.occurrencesChanged || 0,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify({ replaced: results }, null, 2) }],
    };
  }
);

server.tool(
  "google_slides_batch_update",
  "Google SlidesにbatchUpdateリクエストを送信する（高度な操作）",
  {
    presentation_id: z.string().describe("プレゼンテーションID"),
    requests: z.string().describe("batchUpdateのrequests配列（JSON文字列）"),
  },
  async ({ presentation_id, requests }) => {
    let parsed;
    try { parsed = JSON.parse(requests); } catch (e) {
      return { content: [{ type: "text", text: `JSONパースエラー: ${e.message}` }] };
    }
    const url = `https://slides.googleapis.com/v1/presentations/${presentation_id}:batchUpdate`;
    const data = await googleApi("POST", url, { requests: parsed });
    return {
      content: [{ type: "text", text: `batchUpdate完了。${(data.replies || []).length} 件のリクエストを処理しました。` }],
    };
  }
);

// ============================================================
// Gmail ツール（全操作）
// ============================================================

// ── MIMEメッセージ構築ヘルパー ──
function encodeRfc2047(text) {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildMimeMessage({ from, to, cc, bcc, subject, inReplyTo, references, body, contentType }) {
  const lines = [
    "MIME-Version: 1.0",
    `From: ${from}`,
    `To: ${to}`,
  ];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: ${encodeRfc2047(subject)}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push(`Content-Type: ${contentType || "text/plain"}; charset=UTF-8`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(Buffer.from(body, "utf-8").toString("base64"));
  return lines.join("\r\n");
}

function extractHeader(headers, name) {
  const h = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function extractEmail(headerValue) {
  const match = headerValue.match(/<([^>]+)>/);
  return match ? match[1] : headerValue.trim();
}

server.tool(
  "google_gmail_search",
  "Gmailのメッセージを検索する",
  {
    q: z.string().describe("Gmail検索クエリ（例: 'from:user@example.com', 'subject:会議', 'is:unread'）"),
    max_results: z.number().optional().describe("最大件数（デフォルト: 10）"),
  },
  async ({ q, max_results }) => {
    const limit = max_results || 10;
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${limit}`;
    const data = await googleApi("GET", url);

    if (!data.messages || data.messages.length === 0) {
      return { content: [{ type: "text", text: `「${q}」に一致するメッセージが見つかりませんでした。` }] };
    }

    const results = [];
    for (const msg of data.messages) {
      const metaUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
      const meta = await googleApi("GET", metaUrl);
      const headers = meta.payload?.headers || [];
      results.push({
        id: msg.id,
        threadId: msg.threadId,
        subject: extractHeader(headers, "Subject"),
        from: extractHeader(headers, "From"),
        to: extractHeader(headers, "To"),
        date: extractHeader(headers, "Date"),
        snippet: meta.snippet || "",
        labelIds: meta.labelIds || [],
      });
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "google_gmail_get_thread",
  "Gmailのスレッド（会話）を取得する",
  {
    thread_id: z.string().describe("スレッドID"),
  },
  async ({ thread_id }) => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread_id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date&metadataHeaders=Message-ID`;
    const data = await googleApi("GET", url);

    const messages = (data.messages || []).map((m) => {
      const headers = m.payload?.headers || [];
      return {
        id: m.id,
        subject: extractHeader(headers, "Subject"),
        from: extractHeader(headers, "From"),
        to: extractHeader(headers, "To"),
        cc: extractHeader(headers, "Cc"),
        date: extractHeader(headers, "Date"),
        messageId: extractHeader(headers, "Message-ID"),
        snippet: m.snippet || "",
      };
    });

    return {
      content: [{ type: "text", text: JSON.stringify({ threadId: data.id, messages }, null, 2) }],
    };
  }
);

server.tool(
  "google_gmail_get_message",
  "Gmailのメッセージ本文を取得する",
  {
    message_id: z.string().describe("メッセージID"),
  },
  async ({ message_id }) => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=full`;
    const data = await googleApi("GET", url);
    const headers = data.payload?.headers || [];

    let body = "";
    function findBody(part) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
      if (part.parts) {
        for (const p of part.parts) {
          const result = findBody(p);
          if (result) return result;
        }
      }
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
      return null;
    }
    body = findBody(data.payload) || data.snippet || "";

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: data.id,
          threadId: data.threadId,
          subject: extractHeader(headers, "Subject"),
          from: extractHeader(headers, "From"),
          to: extractHeader(headers, "To"),
          cc: extractHeader(headers, "Cc"),
          date: extractHeader(headers, "Date"),
          messageId: extractHeader(headers, "Message-ID"),
          labelIds: data.labelIds || [],
          body,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "google_gmail_create_draft",
  "Gmailの新規メール下書きを作成する（スレッド返信ではない新規メール）",
  {
    to: z.string().describe("宛先メールアドレス（カンマ区切りで複数可）"),
    subject: z.string().describe("件名"),
    body: z.string().describe("本文"),
    cc: z.string().optional().describe("CC（カンマ区切り）"),
    bcc: z.string().optional().describe("BCC（カンマ区切り）"),
    content_type: z.enum(["text/plain", "text/html"]).optional().default("text/plain").describe("本文のContent-Type"),
  },
  async ({ to, subject, body, cc, bcc, content_type }) => {
    const profileUrl = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
    const profile = await googleApi("GET", profileUrl);
    const myEmail = profile.emailAddress;

    const mimeMessage = buildMimeMessage({
      from: myEmail,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      body,
      contentType: content_type || "text/plain",
    });

    const raw = base64UrlEncode(mimeMessage);
    const draftUrl = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
    const draft = await googleApi("POST", draftUrl, { message: { raw } });

    return {
      content: [{
        type: "text",
        text: [
          "新規メールの下書きを作成しました。",
          "",
          `ドラフトID: ${draft.id}`,
          `件名: ${subject}`,
          `宛先: ${to}`,
          cc ? `CC: ${cc}` : null,
          bcc ? `BCC: ${bcc}` : null,
          "",
          "Gmailの下書きフォルダから確認・送信できます。",
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

server.tool(
  "google_gmail_create_reply_draft",
  "Gmailのスレッドに返信する形で下書きを作成する（スレッド内に表示される）",
  {
    message_id: z.string().describe("返信先のメッセージID（スレッド内の最新メッセージ推奨）"),
    body: z.string().describe("返信本文"),
    cc: z.string().optional().describe("CC（カンマ区切り）"),
    content_type: z.enum(["text/plain", "text/html"]).optional().default("text/plain").describe("本文のContent-Type"),
    reply_all: z.boolean().optional().default(false).describe("全員に返信するか"),
  },
  async ({ message_id, body, cc, content_type, reply_all }) => {
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=References&metadataHeaders=In-Reply-To`;
    const msg = await googleApi("GET", msgUrl);

    const headers = msg.payload?.headers || [];
    const threadId = msg.threadId;
    const originalMessageId = extractHeader(headers, "Message-ID");
    const originalSubject = extractHeader(headers, "Subject") || "";
    const originalFrom = extractHeader(headers, "From") || "";
    const originalTo = extractHeader(headers, "To") || "";
    const originalCc = extractHeader(headers, "Cc") || "";
    const originalReferences = extractHeader(headers, "References") || "";

    const profileUrl = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
    const profile = await googleApi("GET", profileUrl);
    const myEmail = profile.emailAddress;

    let replyTo = originalFrom;
    let replyCc = cc || "";

    if (reply_all) {
      const allRecipients = [originalTo, originalCc].filter(Boolean).join(", ");
      const filtered = allRecipients
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.toLowerCase().includes(myEmail.toLowerCase()));
      const ccList = [...filtered, ...(cc ? cc.split(",").map((s) => s.trim()) : [])];
      replyCc = [...new Set(ccList)].join(", ");
    }

    const subject = originalSubject.match(/^Re:/i) ? originalSubject : `Re: ${originalSubject}`;
    const references = originalReferences
      ? `${originalReferences} ${originalMessageId}`
      : originalMessageId;

    const mimeMessage = buildMimeMessage({
      from: myEmail,
      to: replyTo,
      cc: replyCc || undefined,
      subject,
      inReplyTo: originalMessageId,
      references,
      body,
      contentType: content_type || "text/plain",
    });

    const raw = base64UrlEncode(mimeMessage);
    const draftUrl = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
    const draft = await googleApi("POST", draftUrl, { message: { threadId, raw } });

    return {
      content: [{
        type: "text",
        text: [
          "スレッド返信の下書きを作成しました。",
          "",
          `ドラフトID: ${draft.id}`,
          `スレッドID: ${threadId}`,
          `件名: ${subject}`,
          `宛先: ${replyTo}`,
          replyCc ? `CC: ${replyCc}` : null,
          "",
          "Gmailの下書きフォルダから確認・送信できます。",
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

server.tool(
  "google_gmail_send_draft",
  "Gmailの下書きを送信する",
  {
    draft_id: z.string().describe("送信する下書きのドラフトID"),
  },
  async ({ draft_id }) => {
    const url = "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send";
    const data = await googleApi("POST", url, { id: draft_id });
    const headers = data.payload?.headers || [];

    return {
      content: [{
        type: "text",
        text: [
          "下書きを送信しました。",
          "",
          `メッセージID: ${data.id}`,
          `スレッドID: ${data.threadId}`,
          `宛先: ${extractHeader(headers, "To")}`,
          `件名: ${extractHeader(headers, "Subject")}`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

server.tool(
  "google_gmail_list_drafts",
  "Gmailの下書き一覧を取得する",
  {
    max_results: z.number().optional().describe("最大件数（デフォルト: 20）"),
  },
  async ({ max_results }) => {
    const limit = max_results || 20;
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=${limit}`;
    const data = await googleApi("GET", url);

    if (!data.drafts || data.drafts.length === 0) {
      return { content: [{ type: "text", text: "下書きが見つかりませんでした。" }] };
    }

    const results = [];
    for (const draft of data.drafts) {
      const draftUrl = `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draft.id}`;
      const d = await googleApi("GET", draftUrl);
      const headers = d.message?.payload?.headers || [];
      results.push({
        draftId: draft.id,
        messageId: d.message?.id,
        threadId: d.message?.threadId,
        subject: extractHeader(headers, "Subject"),
        to: extractHeader(headers, "To"),
        snippet: d.message?.snippet || "",
      });
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "google_gmail_delete_draft",
  "Gmailの下書きを削除する",
  {
    draft_id: z.string().describe("削除する下書きのドラフトID"),
  },
  async ({ draft_id }) => {
    await googleApiDelete(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draft_id}`);
    return { content: [{ type: "text", text: `下書き ${draft_id} を削除しました。` }] };
  }
);

server.tool(
  "google_gmail_list_labels",
  "Gmailのラベル一覧を取得する",
  {},
  async () => {
    const url = "https://gmail.googleapis.com/gmail/v1/users/me/labels";
    const data = await googleApi("GET", url);
    const labels = (data.labels || []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
    }));
    return { content: [{ type: "text", text: JSON.stringify(labels, null, 2) }] };
  }
);

server.tool(
  "google_gmail_modify_labels",
  "Gmailのメッセージにラベルを追加/削除する",
  {
    message_id: z.string().describe("メッセージID"),
    add_labels: z.array(z.string()).optional().describe("追加するラベルIDの配列"),
    remove_labels: z.array(z.string()).optional().describe("削除するラベルIDの配列"),
  },
  async ({ message_id, add_labels, remove_labels }) => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/modify`;
    const body = {};
    if (add_labels) body.addLabelIds = add_labels;
    if (remove_labels) body.removeLabelIds = remove_labels;
    const data = await googleApi("POST", url, body);
    return {
      content: [{ type: "text", text: `ラベル更新完了（メッセージID: ${message_id}、現在のラベル: ${(data.labelIds || []).join(", ")}）` }],
    };
  }
);

server.tool(
  "google_gmail_trash",
  "Gmailのメッセージをゴミ箱に移動する",
  {
    message_id: z.string().describe("メッセージID"),
  },
  async ({ message_id }) => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/trash`;
    await googleApi("POST", url, {});
    return { content: [{ type: "text", text: `メッセージ ${message_id} をゴミ箱に移動しました。` }] };
  }
);

server.tool(
  "google_gmail_untrash",
  "Gmailのメッセージをゴミ箱から復元する",
  {
    message_id: z.string().describe("メッセージID"),
  },
  async ({ message_id }) => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/untrash`;
    await googleApi("POST", url, {});
    return { content: [{ type: "text", text: `メッセージ ${message_id} をゴミ箱から復元しました。` }] };
  }
);

server.tool(
  "google_gmail_get_profile",
  "Gmailのプロフィール情報（メールアドレス等）を取得する",
  {},
  async () => {
    const url = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
    const data = await googleApi("GET", url);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ============================================================
// Google Drive アップロード
// ============================================================

server.tool(
  "google_drive_upload",
  "ローカルファイルをGoogle Driveにアップロードする",
  {
    file_path: z.string().describe("アップロードするローカルファイルの絶対パス"),
    name: z.string().optional().describe("Drive上のファイル名（省略時はローカルファイル名）"),
    folder_id: z.string().optional().describe("アップロード先フォルダID（省略時はマイドライブ直下）"),
    mime_type: z.string().optional().describe("MIMEタイプ（省略時は自動判定）"),
    convert_to_google_docs: z.boolean().optional().describe("trueにするとHTMLファイルをGoogle Docsに変換してアップロード"),
  },
  async ({ file_path: filePath, name, folder_id, mime_type, convert_to_google_docs }) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`ファイルが見つかりません: ${filePath}`);
    }

    const fileName = name || path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    // MIME自動判定
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      ".html": "text/html", ".htm": "text/html",
      ".css": "text/css", ".js": "application/javascript",
      ".json": "application/json", ".txt": "text/plain",
      ".md": "text/markdown",
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".csv": "text/csv",
    };
    const contentType = mime_type || mimeMap[ext] || "application/octet-stream";

    // メタデータ
    const metadata = { name: fileName };
    if (folder_id) metadata.parents = [folder_id];
    // HTMLをGoogle Docs形式に変換する場合、メタデータにmimeTypeを指定
    if (convert_to_google_docs) {
      metadata.mimeType = "application/vnd.google-apps.document";
    }

    // multipart upload
    const boundary = "-----MCPUploadBoundary" + Date.now();
    const metadataPart = JSON.stringify(metadata);

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      metadataPart,
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${contentType}\r\n\r\n`,
    ];

    const beforeFile = Buffer.from(bodyParts.join(""));
    const afterFile = Buffer.from(`\r\n--${boundary}--`);
    const fullBody = Buffer.concat([beforeFile, fileBuffer, afterFile]);

    const accessToken = await getAccessToken();
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(fullBody.length),
        },
        body: fullBody,
      }
    );

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`アップロードエラー (${res.status}): ${JSON.stringify(data)}`);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `「${data.name}」をアップロードしました`,
          id: data.id,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size,
          webViewLink: data.webViewLink,
        }, null, 2),
      }],
    };
  }
);

// ============================================================
// Google Calendar ツール
// ============================================================

server.tool(
  "google_calendar_list_calendars",
  "利用可能なカレンダー一覧を取得する",
  {},
  async () => {
    const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
    const data = await googleApi("GET", url);
    const calendars = (data.items || []).map((c) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
      accessRole: c.accessRole,
      backgroundColor: c.backgroundColor,
    }));
    return { content: [{ type: "text", text: JSON.stringify(calendars, null, 2) }] };
  }
);

server.tool(
  "google_calendar_list_events",
  "カレンダーのイベント一覧を取得する",
  {
    calendar_id: z.string().optional().describe("カレンダーID（省略時: primary）"),
    time_min: z.string().optional().describe("開始日時（ISO 8601形式、例: 2026-03-27T00:00:00+09:00）"),
    time_max: z.string().optional().describe("終了日時（ISO 8601形式）"),
    max_results: z.number().optional().describe("最大件数（デフォルト: 50）"),
    q: z.string().optional().describe("テキスト検索クエリ"),
    single_events: z.boolean().optional().describe("繰り返しイベントを展開するか（デフォルト: true）"),
    order_by: z.enum(["startTime", "updated"]).optional().describe("並び順（デフォルト: startTime）"),
  },
  async ({ calendar_id, time_min, time_max, max_results, q, single_events, order_by }) => {
    const calId = encodeURIComponent(calendar_id || "primary");
    const params = new URLSearchParams();
    if (time_min) params.set("timeMin", time_min);
    if (time_max) params.set("timeMax", time_max);
    params.set("maxResults", String(max_results || 50));
    if (q) params.set("q", q);
    params.set("singleEvents", String(single_events !== false));
    params.set("orderBy", order_by || "startTime");

    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params}`;
    const data = await googleApi("GET", url);
    const events = (data.items || []).map((e) => ({
      id: e.id,
      summary: e.summary,
      description: e.description,
      location: e.location,
      start: e.start,
      end: e.end,
      status: e.status,
      htmlLink: e.htmlLink,
      organizer: e.organizer,
      attendees: e.attendees,
      hangoutLink: e.hangoutLink,
      conferenceData: e.conferenceData ? {
        entryPoints: e.conferenceData.entryPoints,
      } : undefined,
    }));
    return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
  }
);

server.tool(
  "google_calendar_get_event",
  "特定のイベントの詳細を取得する",
  {
    calendar_id: z.string().optional().describe("カレンダーID（省略時: primary）"),
    event_id: z.string().describe("イベントID"),
  },
  async ({ calendar_id, event_id }) => {
    const calId = encodeURIComponent(calendar_id || "primary");
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(event_id)}`;
    const data = await googleApi("GET", url);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "google_calendar_create_event",
  "新しいイベントを作成する",
  {
    calendar_id: z.string().optional().describe("カレンダーID（省略時: primary）"),
    summary: z.string().describe("イベントタイトル"),
    description: z.string().optional().describe("イベントの説明"),
    location: z.string().optional().describe("場所"),
    start_datetime: z.string().describe("開始日時（ISO 8601形式、例: 2026-03-28T10:00:00+09:00）"),
    end_datetime: z.string().describe("終了日時（ISO 8601形式）"),
    start_date: z.string().optional().describe("終日イベント開始日（YYYY-MM-DD形式、datetime指定時は不要）"),
    end_date: z.string().optional().describe("終日イベント終了日（YYYY-MM-DD形式）"),
    attendees: z.array(z.string()).optional().describe("招待するメールアドレスの配列"),
    timezone: z.string().optional().describe("タイムゾーン（デフォルト: Asia/Tokyo）"),
    send_updates: z.enum(["all", "externalOnly", "none"]).optional().describe("通知送信（デフォルト: none）"),
    conference: z.boolean().optional().describe("Google Meetリンクを自動生成するか"),
  },
  async ({ calendar_id, summary, description, location, start_datetime, end_datetime, start_date, end_date, attendees, timezone, send_updates, conference }) => {
    const calId = encodeURIComponent(calendar_id || "primary");
    const tz = timezone || "Asia/Tokyo";

    const event = { summary };
    if (description) event.description = description;
    if (location) event.location = location;

    if (start_date && end_date) {
      event.start = { date: start_date, timeZone: tz };
      event.end = { date: end_date, timeZone: tz };
    } else {
      event.start = { dateTime: start_datetime, timeZone: tz };
      event.end = { dateTime: end_datetime, timeZone: tz };
    }

    if (attendees) {
      event.attendees = attendees.map((email) => ({ email }));
    }

    if (conference) {
      event.conferenceData = {
        createRequest: {
          requestId: `mcp-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    const params = new URLSearchParams();
    params.set("sendUpdates", send_updates || "none");
    if (conference) params.set("conferenceDataVersion", "1");

    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params}`;
    const data = await googleApi("POST", url, event);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `イベント「${data.summary}」を作成しました`,
          id: data.id,
          htmlLink: data.htmlLink,
          hangoutLink: data.hangoutLink,
          start: data.start,
          end: data.end,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "google_calendar_update_event",
  "既存イベントを更新する",
  {
    calendar_id: z.string().optional().describe("カレンダーID（省略時: primary）"),
    event_id: z.string().describe("イベントID"),
    summary: z.string().optional().describe("イベントタイトル"),
    description: z.string().optional().describe("イベントの説明"),
    location: z.string().optional().describe("場所"),
    start_datetime: z.string().optional().describe("開始日時（ISO 8601形式）"),
    end_datetime: z.string().optional().describe("終了日時（ISO 8601形式）"),
    attendees: z.array(z.string()).optional().describe("招待するメールアドレスの配列"),
    send_updates: z.enum(["all", "externalOnly", "none"]).optional().describe("通知送信（デフォルト: none）"),
  },
  async ({ calendar_id, event_id, summary, description, location, start_datetime, end_datetime, attendees, send_updates }) => {
    const calId = encodeURIComponent(calendar_id || "primary");
    const tz = "Asia/Tokyo";

    const patch = {};
    if (summary) patch.summary = summary;
    if (description !== undefined) patch.description = description;
    if (location !== undefined) patch.location = location;
    if (start_datetime) patch.start = { dateTime: start_datetime, timeZone: tz };
    if (end_datetime) patch.end = { dateTime: end_datetime, timeZone: tz };
    if (attendees) patch.attendees = attendees.map((email) => ({ email }));

    const params = new URLSearchParams();
    params.set("sendUpdates", send_updates || "none");

    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(event_id)}?${params}`;
    const data = await googleApi("PATCH", url, patch);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `イベント「${data.summary}」を更新しました`,
          id: data.id,
          htmlLink: data.htmlLink,
          start: data.start,
          end: data.end,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "google_calendar_delete_event",
  "イベントを削除する",
  {
    calendar_id: z.string().optional().describe("カレンダーID（省略時: primary）"),
    event_id: z.string().describe("イベントID"),
    send_updates: z.enum(["all", "externalOnly", "none"]).optional().describe("通知送信（デフォルト: none）"),
  },
  async ({ calendar_id, event_id, send_updates }) => {
    const calId = encodeURIComponent(calendar_id || "primary");
    const params = new URLSearchParams();
    params.set("sendUpdates", send_updates || "none");
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(event_id)}?${params}`;
    await googleApiDelete(url);
    return { content: [{ type: "text", text: JSON.stringify({ message: "イベントを削除しました" }) }] };
  }
);

server.tool(
  "google_calendar_find_free_time",
  "指定期間の空き時間を取得する（freeBusy）",
  {
    time_min: z.string().describe("開始日時（ISO 8601形式）"),
    time_max: z.string().describe("終了日時（ISO 8601形式）"),
    calendar_ids: z.array(z.string()).optional().describe("対象カレンダーIDの配列（省略時: primary）"),
  },
  async ({ time_min, time_max, calendar_ids }) => {
    const ids = calendar_ids || ["primary"];
    const body = {
      timeMin: time_min,
      timeMax: time_max,
      items: ids.map((id) => ({ id })),
    };
    const url = "https://www.googleapis.com/calendar/v3/freeBusy";
    const data = await googleApi("POST", url, body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "google_calendar_respond_to_event",
  "イベントへの出欠を返答する",
  {
    calendar_id: z.string().optional().describe("カレンダーID（省略時: primary）"),
    event_id: z.string().describe("イベントID"),
    response: z.enum(["accepted", "declined", "tentative"]).describe("出欠（accepted/declined/tentative）"),
  },
  async ({ calendar_id, event_id, response }) => {
    const calId = encodeURIComponent(calendar_id || "primary");
    // まず現在のイベントを取得
    const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(event_id)}`;
    const event = await googleApi("GET", getUrl);

    // 自分のattendeeを探してresponseStatusを更新
    const myEmail = event.organizer?.self ? event.organizer.email : null;
    if (event.attendees) {
      for (const att of event.attendees) {
        if (att.self) {
          att.responseStatus = response;
          break;
        }
      }
    }

    const patchUrl = `${getUrl}?sendUpdates=all`;
    const data = await googleApi("PATCH", patchUrl, { attendees: event.attendees });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `出欠を「${response}」で返答しました`, id: data.id }, null, 2),
      }],
    };
  }
);

// ── サーバー起動 ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP Server Error:", err);
  process.exit(1);
});
