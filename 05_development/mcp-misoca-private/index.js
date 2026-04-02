#!/usr/bin/env node
/**
 * Misoca MCP Server
 * Claude Code から Misoca の請求書・見積書・取引先を操作するMCPサーバー
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");

// ── 設定 ──
const BASE_URL = "https://app.misoca.jp/api/v3";
const TOKEN_URL = "https://app.misoca.jp/oauth2/token";
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
  // 5分のマージン
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
async function misocaApi(method, endpoint, body = null) {
  const accessToken = await getAccessToken();
  const url = `${BASE_URL}${endpoint}`;

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  };

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (res.status === 204) {
    return { success: true };
  }

  // PDFの場合はバイナリ
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/pdf")) {
    const buffer = await res.arrayBuffer();
    return { pdf: true, size: buffer.byteLength };
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `Misoca API エラー (${res.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

// ── MCPサーバー定義 ──
const server = new McpServer({
  name: "misoca",
  version: "1.0.0",
});

// === 請求書ツール ===

server.tool(
  "misoca_list_invoices",
  "請求書の一覧を取得する",
  {
    page: z.number().optional().describe("ページ番号（デフォルト: 1）"),
    per_page: z
      .number()
      .optional()
      .describe("1ページあたりの件数（デフォルト: 25、最大: 100）"),
  },
  async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page) params.set("page", page.toString());
    if (per_page) params.set("per_page", per_page.toString());
    const query = params.toString();
    const data = await misocaApi("GET", `/invoices${query ? `?${query}` : ""}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "misoca_get_invoice",
  "特定の請求書を取得する",
  {
    id: z.string().describe("請求書ID"),
  },
  async ({ id }) => {
    const data = await misocaApi("GET", `/invoice/${id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "misoca_create_invoice",
  "請求書を新規作成する",
  {
    subject: z.string().describe("件名"),
    contact_group_id: z.string().optional().describe("取引先グループID"),
    contact_id: z.string().optional().describe("取引先ID（contact_group_idより優先）"),
    issue_date: z.string().optional().describe("発行日 (YYYY-MM-DD)"),
    payment_due_date: z.string().optional().describe("支払期限 (YYYY-MM-DD)"),
    items: z
      .array(
        z.object({
          name: z.string().describe("品目名"),
          quantity: z.number().optional().describe("数量"),
          unit_price: z.number().optional().describe("単価"),
          unit: z.string().optional().describe("単位"),
          tax_type: z
            .string()
            .optional()
            .describe("税区分 (ten_percent, eight_percent_reduced, など)"),
        })
      )
      .optional()
      .describe("明細項目"),
  },
  async ({ subject, contact_group_id, contact_id, issue_date, payment_due_date, items }) => {
    const cid = contact_id || contact_group_id;
    const body = {
      subject,
      ...(cid && { contact_id: cid }),
      ...(issue_date && { issue_date }),
      ...(payment_due_date && { payment_due_on: payment_due_date }),
    };
    if (items && items.length > 0) {
      body.items = items.map((item) => ({
        name: item.name,
        ...(item.quantity !== undefined && { quantity: item.quantity }),
        ...(item.unit_price !== undefined && { unit_price: item.unit_price }),
        ...(item.unit && { unit_name: item.unit }),
        ...(item.tax_type && { tax_type: item.tax_type }),
      }));
    }
    const data = await misocaApi("POST", "/invoice", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "misoca_invoice_status",
  "請求書のステータスを変更する（送付済み・入金済みなど）",
  {
    id: z.string().describe("請求書ID"),
    action: z
      .enum(["submit", "unsubmit", "pay", "unpay", "trash", "untrash"])
      .describe(
        "アクション: submit=送付済み, unsubmit=送付取消, pay=入金済み, unpay=入金取消, trash=ゴミ箱, untrash=復元"
      ),
  },
  async ({ id, action }) => {
    const actionMap = {
      submit: { method: "PUT", path: `/invoice/${id}/submitted` },
      unsubmit: { method: "DELETE", path: `/invoice/${id}/submitted` },
      pay: { method: "PUT", path: `/invoice/${id}/paid` },
      unpay: { method: "DELETE", path: `/invoice/${id}/paid` },
      trash: { method: "PUT", path: `/invoice/${id}/trashed` },
      untrash: { method: "DELETE", path: `/invoice/${id}/trashed` },
    };
    const { method, path: apiPath } = actionMap[action];
    const data = await misocaApi(method, apiPath);
    return {
      content: [
        {
          type: "text",
          text: `請求書 ${id} を「${action}」しました。\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }
);

// === 見積書ツール ===

server.tool(
  "misoca_list_estimates",
  "見積書の一覧を取得する",
  {
    page: z.number().optional().describe("ページ番号"),
    per_page: z.number().optional().describe("1ページあたりの件数"),
  },
  async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page) params.set("page", page.toString());
    if (per_page) params.set("per_page", per_page.toString());
    const query = params.toString();
    const data = await misocaApi(
      "GET",
      `/estimates${query ? `?${query}` : ""}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "misoca_get_estimate",
  "特定の見積書を取得する",
  {
    id: z.string().describe("見積書ID"),
  },
  async ({ id }) => {
    const data = await misocaApi("GET", `/estimate/${id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "misoca_create_estimate",
  "見積書を新規作成する",
  {
    subject: z.string().describe("件名"),
    contact_group_id: z.string().optional().describe("取引先グループID"),
    contact_id: z.string().optional().describe("取引先ID（contact_group_idより優先）"),
    issue_date: z.string().optional().describe("発行日 (YYYY-MM-DD)"),
    items: z
      .array(
        z.object({
          name: z.string().describe("品目名"),
          quantity: z.number().optional().describe("数量"),
          unit_price: z.number().optional().describe("単価"),
          unit: z.string().optional().describe("単位"),
        })
      )
      .optional()
      .describe("明細項目"),
  },
  async ({ subject, contact_group_id, contact_id, issue_date, items }) => {
    const cid = contact_id || contact_group_id;
    const body = {
      subject,
      ...(cid && { contact_id: cid }),
      ...(issue_date && { issue_date }),
    };
    if (items && items.length > 0) {
      body.items = items.map((item) => ({
        name: item.name,
        ...(item.quantity !== undefined && { quantity: item.quantity }),
        ...(item.unit_price !== undefined && { unit_price: item.unit_price }),
        ...(item.unit && { unit_name: item.unit }),
      }));
    }
    const data = await misocaApi("POST", "/estimate", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// === 取引先ツール ===

server.tool(
  "misoca_list_contacts",
  "取引先（送付先）の一覧を取得する",
  {
    page: z.number().optional().describe("ページ番号"),
    per_page: z.number().optional().describe("1ページあたりの件数"),
  },
  async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page) params.set("page", page.toString());
    if (per_page) params.set("per_page", per_page.toString());
    const query = params.toString();
    const data = await misocaApi(
      "GET",
      `/contacts${query ? `?${query}` : ""}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "misoca_list_contact_groups",
  "取引先グループ（事業者）の一覧を取得する",
  {
    page: z.number().optional().describe("ページ番号"),
    per_page: z.number().optional().describe("1ページあたりの件数"),
  },
  async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page) params.set("page", page.toString());
    if (per_page) params.set("per_page", per_page.toString());
    const query = params.toString();
    const data = await misocaApi(
      "GET",
      `/contact_groups${query ? `?${query}` : ""}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// === 品目ツール ===

server.tool(
  "misoca_list_items",
  "登録済み品目の一覧を取得する",
  {
    page: z.number().optional().describe("ページ番号"),
    per_page: z.number().optional().describe("1ページあたりの件数"),
  },
  async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page) params.set("page", page.toString());
    if (per_page) params.set("per_page", per_page.toString());
    const query = params.toString();
    const data = await misocaApi(
      "GET",
      `/dealing_items${query ? `?${query}` : ""}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// === ユーザー情報 ===

server.tool(
  "misoca_get_me",
  "ログイン中のMisocaユーザー情報を取得する",
  {},
  async () => {
    const data = await misocaApi("GET", "/user/me");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
