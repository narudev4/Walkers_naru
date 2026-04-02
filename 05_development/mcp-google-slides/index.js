#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import http from "http";
import { URL } from "url";

const TOKEN_PATH = path.join(
  process.env.HOME,
  ".config",
  "mcp-google-slides",
  "token.json"
);
const SCOPES = [
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive",
];

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3939/callback";

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

async function getAuthenticatedClient() {
  const oauth2Client = getOAuth2Client();
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oauth2Client.setCredentials(token);
    // Auto-refresh
    oauth2Client.on("tokens", (tokens) => {
      const current = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
      const updated = { ...current, ...tokens };
      fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    });
    return oauth2Client;
  }
  return null;
}

async function authorize() {
  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:3939`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (code) {
          try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h1>認証成功！このタブを閉じてください。</h1>");
            server.close();
            resolve(oauth2Client);
          } catch (err) {
            res.writeHead(500);
            res.end("Token exchange failed");
            reject(err);
          }
        }
      }
    });
    server.listen(3939, () => {
      console.error(`\n🔑 Google Slides認証が必要です。以下のURLをブラウザで開いてください:\n${authUrl}\n`);
    });
  });
}

const server = new Server(
  { name: "mcp-google-slides", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "slides_auth",
      description: "Google Slides APIの認証を行う。未認証の場合はブラウザでの認証URLを返す。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "slides_create",
      description: "新しいGoogle Slidesプレゼンテーションを作成する",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "プレゼンテーションのタイトル" },
        },
        required: ["title"],
      },
    },
    {
      name: "slides_get",
      description: "プレゼンテーションの情報を取得する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
        },
        required: ["presentationId"],
      },
    },
    {
      name: "slides_add_slide",
      description: "プレゼンテーションに新しいスライドを追加する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
          layout: {
            type: "string",
            description: "レイアウト: BLANK, TITLE, TITLE_AND_BODY, TITLE_AND_TWO_COLUMNS, TITLE_ONLY, SECTION_HEADER, ONE_COLUMN_TEXT, MAIN_POINT, BIG_NUMBER, CAPTION_ONLY",
            default: "BLANK",
          },
          insertionIndex: { type: "number", description: "挿入位置（0始まり）" },
        },
        required: ["presentationId"],
      },
    },
    {
      name: "slides_add_text",
      description: "スライドにテキストボックスを追加する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
          slideId: { type: "string", description: "スライドのオブジェクトID" },
          text: { type: "string", description: "追加するテキスト" },
          x: { type: "number", description: "X座標(pt)", default: 100 },
          y: { type: "number", description: "Y座標(pt)", default: 100 },
          width: { type: "number", description: "幅(pt)", default: 500 },
          height: { type: "number", description: "高さ(pt)", default: 100 },
          fontSize: { type: "number", description: "フォントサイズ(pt)", default: 18 },
          bold: { type: "boolean", description: "太字", default: false },
        },
        required: ["presentationId", "slideId", "text"],
      },
    },
    {
      name: "slides_add_image",
      description: "スライドに画像を追加する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
          slideId: { type: "string", description: "スライドのオブジェクトID" },
          imageUrl: { type: "string", description: "画像のURL" },
          x: { type: "number", description: "X座標(pt)", default: 100 },
          y: { type: "number", description: "Y座標(pt)", default: 100 },
          width: { type: "number", description: "幅(pt)", default: 400 },
          height: { type: "number", description: "高さ(pt)", default: 300 },
        },
        required: ["presentationId", "slideId", "imageUrl"],
      },
    },
    {
      name: "slides_batch_update",
      description: "プレゼンテーションに一括更新リクエストを送信する（上級者向け）",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
          requests: {
            type: "array",
            description: "Google Slides APIの更新リクエスト配列",
            items: { type: "object" },
          },
        },
        required: ["presentationId", "requests"],
      },
    },
    {
      name: "slides_get_slide_ids",
      description: "プレゼンテーション内の全スライドのIDを取得する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
        },
        required: ["presentationId"],
      },
    },
    {
      name: "slides_duplicate",
      description: "プレゼンテーションを複製する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
          newTitle: { type: "string", description: "新しいタイトル" },
        },
        required: ["presentationId", "newTitle"],
      },
    },
    {
      name: "slides_move_to_folder",
      description: "プレゼンテーションを指定フォルダに移動する",
      inputSchema: {
        type: "object",
        properties: {
          presentationId: { type: "string", description: "プレゼンテーションID" },
          folderId: { type: "string", description: "移動先フォルダID" },
        },
        required: ["presentationId", "folderId"],
      },
    },
    {
      name: "slides_upload_pptx",
      description: "ローカルのPPTXファイルをGoogle Slidesにアップロード・変換する",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "PPTXファイルのローカルパス" },
          title: { type: "string", description: "Google Slides上のタイトル（省略時はファイル名）" },
          folderId: { type: "string", description: "アップロード先フォルダID（省略時はマイドライブ）" },
        },
        required: ["filePath"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Auth check
  if (name === "slides_auth") {
    const client = await getAuthenticatedClient();
    if (client) {
      try {
        const slides = google.slides({ version: "v1", auth: client });
        // Quick test
        return { content: [{ type: "text", text: "✅ Google Slides API認証済み。利用可能です。" }] };
      } catch (e) {
        // Token expired, re-auth
      }
    }
    // Need auth
    const authClient = await authorize();
    return { content: [{ type: "text", text: "✅ 認証完了！Google Slides APIが利用可能になりました。" }] };
  }

  // All other tools need auth
  const auth = await getAuthenticatedClient();
  if (!auth) {
    return {
      content: [{ type: "text", text: "❌ 未認証です。まず slides_auth ツールを実行してください。" }],
      isError: true,
    };
  }

  const slides = google.slides({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  try {
    switch (name) {
      case "slides_create": {
        const res = await slides.presentations.create({
          requestBody: { title: args.title },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              presentationId: res.data.presentationId,
              title: res.data.title,
              url: `https://docs.google.com/presentation/d/${res.data.presentationId}/edit`,
            }, null, 2),
          }],
        };
      }

      case "slides_get": {
        const res = await slides.presentations.get({
          presentationId: args.presentationId,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              presentationId: res.data.presentationId,
              title: res.data.title,
              slideCount: res.data.slides?.length || 0,
              pageSize: res.data.pageSize,
            }, null, 2),
          }],
        };
      }

      case "slides_add_slide": {
        const layout = args.layout || "BLANK";
        const requests = [{
          createSlide: {
            insertionIndex: args.insertionIndex,
            slideLayoutReference: { predefinedLayout: layout },
          },
        }];
        const res = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests },
        });
        const slideId = res.data.replies?.[0]?.createSlide?.objectId;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ slideId, layout }, null, 2),
          }],
        };
      }

      case "slides_add_text": {
        const elementId = `text_${Date.now()}`;
        const requests = [
          {
            createShape: {
              objectId: elementId,
              shapeType: "TEXT_BOX",
              elementProperties: {
                pageObjectId: args.slideId,
                size: {
                  width: { magnitude: args.width || 500, unit: "PT" },
                  height: { magnitude: args.height || 100, unit: "PT" },
                },
                transform: {
                  scaleX: 1, scaleY: 1,
                  translateX: args.x || 100, translateY: args.y || 100,
                  unit: "PT",
                },
              },
            },
          },
          {
            insertText: {
              objectId: elementId,
              text: args.text,
            },
          },
        ];
        if (args.fontSize || args.bold) {
          const style = {};
          if (args.fontSize) style.fontSize = { magnitude: args.fontSize, unit: "PT" };
          if (args.bold) style.bold = true;
          requests.push({
            updateTextStyle: {
              objectId: elementId,
              style,
              fields: Object.keys(style).join(","),
              textRange: { type: "ALL" },
            },
          });
        }
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests },
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ elementId, text: args.text }, null, 2) }],
        };
      }

      case "slides_add_image": {
        const imgId = `img_${Date.now()}`;
        const requests = [{
          createImage: {
            objectId: imgId,
            url: args.imageUrl,
            elementProperties: {
              pageObjectId: args.slideId,
              size: {
                width: { magnitude: args.width || 400, unit: "PT" },
                height: { magnitude: args.height || 300, unit: "PT" },
              },
              transform: {
                scaleX: 1, scaleY: 1,
                translateX: args.x || 100, translateY: args.y || 100,
                unit: "PT",
              },
            },
          },
        }];
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests },
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ imageId: imgId }, null, 2) }],
        };
      }

      case "slides_batch_update": {
        const res = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests: args.requests },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
        };
      }

      case "slides_get_slide_ids": {
        const res = await slides.presentations.get({
          presentationId: args.presentationId,
        });
        const slideIds = (res.data.slides || []).map((s, i) => ({
          index: i,
          objectId: s.objectId,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(slideIds, null, 2) }],
        };
      }

      case "slides_duplicate": {
        const res = await drive.files.copy({
          fileId: args.presentationId,
          requestBody: { name: args.newTitle },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              newPresentationId: res.data.id,
              title: res.data.name,
              url: `https://docs.google.com/presentation/d/${res.data.id}/edit`,
            }, null, 2),
          }],
        };
      }

      case "slides_move_to_folder": {
        const file = await drive.files.get({
          fileId: args.presentationId,
          fields: "parents",
        });
        const previousParents = (file.data.parents || []).join(",");
        await drive.files.update({
          fileId: args.presentationId,
          addParents: args.folderId,
          removeParents: previousParents,
          fields: "id, parents",
        });
        return {
          content: [{ type: "text", text: `✅ フォルダ ${args.folderId} に移動しました` }],
        };
      }

      case "slides_upload_pptx": {
        const filePath = args.filePath;
        if (!fs.existsSync(filePath)) {
          return { content: [{ type: "text", text: `❌ ファイルが見つかりません: ${filePath}` }], isError: true };
        }
        const fileName = args.title || path.basename(filePath, ".pptx");
        const fileMetadata = {
          name: fileName,
          mimeType: "application/vnd.google-apps.presentation",
        };
        if (args.folderId) {
          fileMetadata.parents = [args.folderId];
        }
        const media = {
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          body: fs.createReadStream(filePath),
        };
        const res = await drive.files.create({
          requestBody: fileMetadata,
          media,
          fields: "id, name, webViewLink",
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              presentationId: res.data.id,
              title: res.data.name,
              url: res.data.webViewLink || `https://docs.google.com/presentation/d/${res.data.id}/edit`,
            }, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ エラー: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
