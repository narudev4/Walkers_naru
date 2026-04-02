#!/usr/bin/env node
/**
 * YouTube Analytics MCP Server
 *
 * YouTube Analytics API（非公開データ）にOAuth認証でアクセスし、
 * チャンネルの正確な登録者数・視聴時間・トラフィックソース等を取得する。
 *
 * 事前セットアップ:
 *   npm run setup   ← OAuthトークンを取得
 *
 * MCP起動:
 *   node index.js
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './auth.js';

// ─── ツール定義 ───

const TOOLS = [
  {
    name: 'yta_channel_overview',
    description:
      'チャンネルの概要データを取得（正確な登録者数・総再生回数・動画数・開始日など）。YouTube Studio と同じ内部データ。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'yta_analytics_report',
    description:
      'YouTube Analytics レポートを取得。期間・メトリクス・ディメンションを指定して詳細分析。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
        metrics: {
          type: 'string',
          description:
            'カンマ区切りのメトリクス。例: views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares',
        },
        dimensions: {
          type: 'string',
          description:
            'カンマ区切りのディメンション（省略可）。例: day, month, video, country, deviceType, operatingSystem, trafficSourceType',
        },
        sort: {
          type: 'string',
          description: 'ソート順（省略可）。例: -views（降順）, day（昇順）',
        },
        maxResults: {
          type: 'number',
          description: '最大件数（省略時: 50）',
        },
        filters: {
          type: 'string',
          description:
            'フィルター（省略可）。例: video==VIDEO_ID, country==JP',
        },
      },
      required: ['startDate', 'endDate', 'metrics'],
    },
  },
  {
    name: 'yta_video_performance',
    description:
      '指定期間の動画別パフォーマンスを取得（再生数・視聴時間・平均視聴時間・高評価・コメント等）。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
        maxResults: {
          type: 'number',
          description: '最大件数（デフォルト: 20）',
        },
        sort: {
          type: 'string',
          description: 'ソート（デフォルト: -views）',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_traffic_sources',
    description:
      '指定期間のトラフィックソース別データ（検索・関連動画・ブラウジング・外部等）。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_demographics',
    description:
      '視聴者の性別・年齢層の分布データを取得。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_daily_stats',
    description:
      '日別の再生数・視聴時間・登録者変動を取得。トレンド分析に最適。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_geography',
    description:
      '国別の視聴データを取得。どの国からの視聴が多いか分析。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
        maxResults: {
          type: 'number',
          description: '最大件数（デフォルト: 20）',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_device_os',
    description:
      'デバイスタイプ別（モバイル/PC/タブレット等）の視聴データを取得。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_search_terms',
    description:
      'YouTube内検索でチャンネル動画に流入した検索キーワードを取得。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
        maxResults: {
          type: 'number',
          description: '最大件数（デフォルト: 25）',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'yta_subscriber_changes',
    description:
      '登録者の増減データ（獲得元: 動画ページ、検索、チャンネルページ等）を取得。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '開始日 (YYYY-MM-DD)',
        },
        endDate: {
          type: 'string',
          description: '終了日 (YYYY-MM-DD)',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
];

// ─── ツール実行 ───

async function handleTool(name, args) {
  const auth = await getAuthenticatedClient();
  const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });
  const youtube = google.youtube({ version: 'v3', auth });

  switch (name) {
    case 'yta_channel_overview': {
      // チャンネル情報（Data API — OAuth認証なので正確な数字）
      const channelRes = await youtube.channels.list({
        part: 'snippet,statistics,brandingSettings',
        mine: true,
      });
      const channel = channelRes.data.items?.[0];
      if (!channel) {
        return { error: 'チャンネルが見つかりません。OAuth認証したアカウントを確認してください。' };
      }
      return {
        channelId: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        customUrl: channel.snippet.customUrl,
        publishedAt: channel.snippet.publishedAt,
        thumbnailUrl: channel.snippet.thumbnails?.default?.url,
        subscriberCount: Number(channel.statistics.subscriberCount),
        hiddenSubscriberCount: channel.statistics.hiddenSubscriberCount,
        viewCount: Number(channel.statistics.viewCount),
        videoCount: Number(channel.statistics.videoCount),
      };
    }

    case 'yta_analytics_report': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: args.metrics,
        dimensions: args.dimensions || undefined,
        sort: args.sort || undefined,
        maxResults: args.maxResults || 50,
        filters: args.filters || undefined,
      });
      return formatReport(res.data);
    }

    case 'yta_video_performance': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained',
        dimensions: 'video',
        sort: args.sort || '-views',
        maxResults: args.maxResults || 20,
      });

      // 動画IDからタイトルを取得
      const data = formatReport(res.data);
      if (data.rows && data.rows.length > 0) {
        const videoIds = data.rows.map((r) => r.video).filter(Boolean);
        if (videoIds.length > 0) {
          const videoRes = await youtube.videos.list({
            part: 'snippet',
            id: videoIds.join(','),
          });
          const titleMap = {};
          videoRes.data.items?.forEach((v) => {
            titleMap[v.id] = v.snippet.title;
          });
          data.rows.forEach((r) => {
            r.videoTitle = titleMap[r.video] || r.video;
          });
        }
      }
      return data;
    }

    case 'yta_traffic_sources': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
      });
      return formatReport(res.data);
    }

    case 'yta_demographics': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup,gender',
        sort: '-viewerPercentage',
      });
      return formatReport(res.data);
    }

    case 'yta_daily_stats': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments',
        dimensions: 'day',
        sort: 'day',
      });
      return formatReport(res.data);
    }

    case 'yta_geography': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'country',
        sort: '-views',
        maxResults: args.maxResults || 20,
      });
      return formatReport(res.data);
    }

    case 'yta_device_os': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'deviceType',
        sort: '-views',
      });
      return formatReport(res.data);
    }

    case 'yta_search_terms': {
      const res = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'views',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==YT_SEARCH',
        sort: '-views',
        maxResults: args.maxResults || 25,
      });
      return formatReport(res.data);
    }

    case 'yta_subscriber_changes': {
      // 日別の登録者変動
      const dailyRes = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'subscribersGained,subscribersLost',
        dimensions: 'day',
        sort: 'day',
      });

      // サマリー
      const summaryRes = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: 'subscribersGained,subscribersLost',
      });

      return {
        summary: formatReport(summaryRes.data),
        daily: formatReport(dailyRes.data),
      };
    }

    default:
      return { error: `不明なツール: ${name}` };
  }
}

/**
 * API レスポンスを読みやすい形に整形
 */
function formatReport(data) {
  if (!data.rows || data.rows.length === 0) {
    return {
      columnHeaders: data.columnHeaders?.map((h) => h.name) || [],
      rows: [],
      message: 'データがありません',
    };
  }

  const headers = data.columnHeaders.map((h) => h.name);
  const rows = data.rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });

  return {
    columnHeaders: headers,
    rows,
    totalRows: rows.length,
  };
}

// ─── MCP サーバー起動 ───

async function main() {
  const server = new Server(
    {
      name: 'youtube-analytics',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              code: error.code,
              hint: error.message.includes('token')
                ? 'npm run setup でOAuth再認証してください'
                : undefined,
            }),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
