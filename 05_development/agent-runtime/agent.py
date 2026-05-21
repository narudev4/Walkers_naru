"""Walkers クラウド常駐 Agent SDK ランタイム.

クラウド常駐の Anthropic Claude エージェント。S3 真理源 + Google Workspace MCP +
プロジェクトタスクグラフ。EventBridge Scheduler / Slack ハンドラ / 手動 CLI から起動。

主要モード:
    --mode daemon         : 常駐 (Slack/API Gateway イベント待受 + 定期 tick)
    --mode morning        : 朝のタスク棚卸し
    --mode evening        : 夜の振り返り
    --mode once           : ワンショット (--project と --prompt 必須)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

import anthropic
from anthropic import Anthropic
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from mcp_session import WorkspaceMCPSession
from s3_context import S3Config, S3Context
from task_graph import TaskGraph

logger = logging.getLogger("walkers.agent")

MODEL = "claude-opus-4-7"
MAX_TOKENS = 16_000
MAX_AGENT_ITERATIONS = 25


# ---- 設定 -------------------------------------------------------------------


@dataclass(frozen=True)
class AgentConfig:
    s3_bucket: str
    aws_region: str
    google_account: str
    google_token_dir: str

    @classmethod
    def from_env(cls) -> AgentConfig:
        return cls(
            s3_bucket=os.environ.get("WALKERS_S3_BUCKET", "walkers-context-prod"),
            aws_region=os.environ.get("AWS_REGION", "ap-northeast-1"),
            google_account=os.environ.get(
                "WALKERS_GOOGLE_ACCOUNT", "naru.hosoya@walker-s.co.jp"
            ),
            google_token_dir=os.environ.get(
                "GOOGLE_WORKSPACE_MCP_TOKEN_DIR", "/app/.workspace-mcp"
            ),
        )


# ---- システムプロンプト -----------------------------------------------------

SYSTEM_PROMPT_BASE = """\
あなたは Walkers (細谷 成 / naru.hosoya@walker-s.co.jp) のクラウド常駐 AI パートナー。
S3 上のコンテキスト・プロジェクト群・タスクグラフを真理源として、経営戦略立案、
タスク管理、Google Workspace (Calendar / Gmail / Drive / Sheets / Docs / Slides) の
操作を通じて事業運営を支援する。

行動原則:
1. 憶測しない。わからないことは Google Workspace MCP の検索系ツールで確認するか、
   S3 のコンテキスト (memories / projects) を参照する。
2. 重要な意思決定は decisions.md に追記する旨を明示する (Agent 単独で書き込まない)。
3. プロジェクト単位で考える。タスクは必ず `project_id` に紐付ける。
4. Google Calendar に予定を書き込む際は `naru.hosoya@walker-s.co.jp` のカレンダーに対してのみ。
   第三者のカレンダーには触れない。
5. 顧客情報・機密情報を含むファイルは S3 の `private/` prefix から取得し、
   レスポンスにそのまま含めない (要約のみ)。

成果物は構造化された Markdown で返す。長い分析は最初に 1 段落の要約を置く。
"""


def build_system_prompt(mode: str, context_summary: str = "") -> str:
    extra: dict[str, str] = {
        "morning": "今は朝の棚卸し時間。各プロジェクトのタスクを精査し、本日の優先タスクを 3-5 件に絞り、Calendar への予定書き込みを提案する。",
        "evening": "今は夜の振り返り時間。本日完了したタスクを確認し、明日に持ち越すものを整理する。",
        "daemon": "Slack / Web 経由のリクエストを処理する。短く明確に答え、必要に応じてタスクを追加・更新する。",
        "once": "ユーザーから 1 件のリクエストが渡された。簡潔に応答する。",
    }.get(mode, "")
    parts = [SYSTEM_PROMPT_BASE, f"\n# 現在のモード\n{mode}: {extra}"]
    if context_summary:
        parts.append(f"\n# 現在のコンテキスト要約\n{context_summary}")
    return "\n".join(parts)


# ---- Agent ループ -----------------------------------------------------------


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=20),
    retry=retry_if_exception_type((anthropic.RateLimitError, anthropic.APIConnectionError)),
)
def _call_claude(
    client: Anthropic,
    *,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
) -> anthropic.types.Message:
    return client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        tools=tools,
        messages=messages,
    )


async def run_agent_loop(
    client: Anthropic,
    mcp: WorkspaceMCPSession,
    *,
    system: str,
    initial_user_message: str,
    log_prefix: str = "agent",
) -> dict[str, Any]:
    """Agent loop: Claude API ↔ MCP ツール呼出を仲介して、最終応答を返す."""

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": initial_user_message}
    ]
    tools = mcp.tools
    final_text_parts: list[str] = []
    total_input_tokens = 0
    total_output_tokens = 0
    total_cache_read_tokens = 0

    for iteration in range(MAX_AGENT_ITERATIONS):
        logger.info("[%s] iter=%d msgs=%d", log_prefix, iteration, len(messages))
        response = _call_claude(client, system=system, messages=messages, tools=tools)

        total_input_tokens += response.usage.input_tokens
        total_output_tokens += response.usage.output_tokens
        total_cache_read_tokens += getattr(response.usage, "cache_read_input_tokens", 0) or 0

        # アシスタント応答全体を履歴に追加 (thinking ブロックも含む)
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    final_text_parts.append(block.text)
            break

        if response.stop_reason == "tool_use":
            tool_results: list[dict[str, Any]] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                logger.info(
                    "[%s] tool_use name=%s id=%s", log_prefix, block.name, block.id
                )
                try:
                    output = await mcp.call_tool(block.name, dict(block.input))
                    is_error = output.startswith("[ERROR]")
                except Exception as e:
                    logger.exception("[%s] tool 失敗 %s", log_prefix, block.name)
                    output = f"[ERROR] tool execution exception: {e}"
                    is_error = True
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": output[:20_000],
                        "is_error": is_error,
                    }
                )
            messages.append({"role": "user", "content": tool_results})
            continue

        if response.stop_reason == "pause_turn":
            # サーバーサイドツール (web_search 等) が pause した場合は次イテレーションで継続
            logger.info("[%s] pause_turn → 継続", log_prefix)
            continue

        if response.stop_reason == "refusal":
            logger.warning("[%s] refusal: %s", log_prefix, getattr(response, "stop_details", None))
            final_text_parts.append("[エージェントは安全上の理由でリクエストを拒否しました]")
            break

        logger.warning("[%s] unhandled stop_reason=%s", log_prefix, response.stop_reason)
        break
    else:
        logger.warning("[%s] MAX_AGENT_ITERATIONS=%d 到達", log_prefix, MAX_AGENT_ITERATIONS)

    return {
        "text": "\n".join(final_text_parts).strip(),
        "iterations": iteration + 1,
        "usage": {
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "cache_read_input_tokens": total_cache_read_tokens,
        },
    }


# ---- モード別エントリ -------------------------------------------------------


async def mode_morning(cfg: AgentConfig) -> dict[str, Any]:
    """朝の棚卸し: 全プロジェクトのタスクを点検 → 本日の優先 3-5 件を Calendar 反映."""
    s3 = S3Context(S3Config(bucket=cfg.s3_bucket, region=cfg.aws_region))
    today = date.today().isoformat()

    project_summaries: list[str] = []
    for project_id in s3.list_projects():
        doc = s3.get_tasks(project_id)
        graph = TaskGraph.from_doc(doc)
        ready = graph.ready()
        overdue = graph.overdue()
        if not ready and not overdue:
            continue
        line_parts = [f"## {project_id}"]
        if overdue:
            line_parts.append("**遅延中**:")
            for t in overdue[:5]:
                line_parts.append(f"- [{t.id}] {t.title} (due: {t.due})")
        if ready:
            line_parts.append("着手可能:")
            for t in ready[:5]:
                line_parts.append(f"- [{t.id}] {t.title} (due: {t.due or 'なし'})")
        project_summaries.append("\n".join(line_parts))

    user_msg = (
        f"今日は {today}。各プロジェクトの状況を踏まえ、本日 naru が取り組むべきタスクを 3-5 件に絞り、"
        "可能なものは Google Calendar に予定として書き込んでください。\n\n"
        + "\n\n".join(project_summaries or ["(プロジェクトデータなし)"])
    )

    client = Anthropic()
    mcp = WorkspaceMCPSession(
        google_account=cfg.google_account, token_dir=cfg.google_token_dir
    )
    async with mcp.connect() as connected:
        result = await run_agent_loop(
            client,
            connected,
            system=build_system_prompt("morning"),
            initial_user_message=user_msg,
            log_prefix="morning",
        )

    # 結果を S3 の `output/morning/{YYYY-MM-DD}.md` に保存
    s3.put_text(
        f"output/morning/{today}.md",
        f"# 朝の棚卸し {today}\n\n{result['text']}\n",
    )
    return result


async def mode_evening(cfg: AgentConfig) -> dict[str, Any]:
    s3 = S3Context(S3Config(bucket=cfg.s3_bucket, region=cfg.aws_region))
    today = date.today().isoformat()

    user_msg = (
        f"今日は {today}。本日の振り返りを行ってください。各プロジェクトのタスクを確認し、"
        "完了したものは done に更新する提案、明日に持ち越すものの整理、"
        "気づきを decisions に追記すべきかの判断をしてください。"
    )

    client = Anthropic()
    mcp = WorkspaceMCPSession(
        google_account=cfg.google_account, token_dir=cfg.google_token_dir
    )
    async with mcp.connect() as connected:
        result = await run_agent_loop(
            client,
            connected,
            system=build_system_prompt("evening"),
            initial_user_message=user_msg,
            log_prefix="evening",
        )
    s3.put_text(
        f"output/evening/{today}.md",
        f"# 夜の振り返り {today}\n\n{result['text']}\n",
    )
    return result


async def mode_once(cfg: AgentConfig, prompt: str, project_id: str | None) -> dict[str, Any]:
    s3 = S3Context(S3Config(bucket=cfg.s3_bucket, region=cfg.aws_region))
    context_summary = ""
    if project_id:
        doc = s3.get_tasks(project_id)
        context_summary = f"プロジェクト {project_id} のタスク:\n```json\n{json.dumps(doc, ensure_ascii=False, indent=2)[:3000]}\n```"

    client = Anthropic()
    mcp = WorkspaceMCPSession(
        google_account=cfg.google_account, token_dir=cfg.google_token_dir
    )
    async with mcp.connect() as connected:
        return await run_agent_loop(
            client,
            connected,
            system=build_system_prompt("once", context_summary=context_summary),
            initial_user_message=prompt,
            log_prefix="once",
        )


async def mode_daemon(cfg: AgentConfig) -> None:
    """常駐モード. v3 では SQS/EventBridge ポーリングを実装. 現段階は heartbeat のみ."""
    logger.info("daemon mode 起動. EventBridge / Slack ハンドラからの起動を待機.")
    # 30 秒間隔で生存ログ。実運用ではここで SQS pollを行う
    while True:
        await asyncio.sleep(30)
        logger.info("heartbeat at %s", datetime.now(timezone.utc).isoformat())


# ---- main -------------------------------------------------------------------


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("ANTHROPIC_LOG", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )
    parser = argparse.ArgumentParser(description="Walkers Agent Runtime")
    parser.add_argument(
        "--mode",
        choices=["daemon", "morning", "evening", "once"],
        default="daemon",
    )
    parser.add_argument("--prompt", help="--mode once 用のリクエスト本文")
    parser.add_argument("--project", help="--mode once 用のプロジェクト ID")
    args = parser.parse_args()

    cfg = AgentConfig.from_env()

    if args.mode == "daemon":
        asyncio.run(mode_daemon(cfg))
        return 0
    if args.mode == "morning":
        result = asyncio.run(mode_morning(cfg))
    elif args.mode == "evening":
        result = asyncio.run(mode_evening(cfg))
    elif args.mode == "once":
        if not args.prompt:
            parser.error("--mode once には --prompt が必要")
        result = asyncio.run(mode_once(cfg, prompt=args.prompt, project_id=args.project))
    else:
        parser.error(f"unknown mode: {args.mode}")

    print(result["text"])
    print(
        f"\n--- usage: input={result['usage']['input_tokens']} "
        f"output={result['usage']['output_tokens']} "
        f"cache_read={result['usage']['cache_read_input_tokens']} "
        f"iters={result['iterations']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
