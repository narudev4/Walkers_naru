"""Google Workspace MCP セッション (stdio 経由).

`uvx workspace-mcp` を子プロセスとして起動し、MCP プロトコルで通信。
Anthropic Messages API に渡せる tool 定義 (JSON Schema) と、tool_use を
受けたときに MCP に転送して結果を返すブリッジを提供する。
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)

try:
    # `mcp` Python SDK
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError as e:  # pragma: no cover
    logger.warning("mcp パッケージ未インストール: %s", e)
    raise


class WorkspaceMCPSession:
    """Google Workspace MCP との接続セッション."""

    def __init__(
        self,
        *,
        google_account: str,
        token_dir: str,
        command: str = "uvx",
        args: tuple[str, ...] = ("workspace-mcp",),
    ) -> None:
        self.google_account = google_account
        self.token_dir = token_dir
        self.command = command
        self.args = args
        self._session: ClientSession | None = None
        self._tools: list[dict[str, Any]] = []

    @asynccontextmanager
    async def connect(self) -> AsyncIterator["WorkspaceMCPSession"]:
        params = StdioServerParameters(
            command=self.command,
            args=list(self.args),
            env={
                # workspace-mcp は OAuth トークンを GOOGLE_WORKSPACE_MCP_TOKEN_DIR から読む
                "GOOGLE_WORKSPACE_MCP_TOKEN_DIR": self.token_dir,
                "GOOGLE_WORKSPACE_MCP_ACCOUNT": self.google_account,
            },
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                self._session = session
                tools = await session.list_tools()
                self._tools = [self._mcp_tool_to_anthropic(t) for t in tools.tools]
                logger.info("workspace-mcp 接続: %d tools 利用可", len(self._tools))
                try:
                    yield self
                finally:
                    self._session = None

    @staticmethod
    def _mcp_tool_to_anthropic(t: Any) -> dict[str, Any]:
        """MCP の tool 定義 → Anthropic Messages API の tool 定義."""
        return {
            "name": t.name,
            "description": (t.description or "").strip(),
            "input_schema": t.inputSchema or {"type": "object", "properties": {}},
        }

    @property
    def tools(self) -> list[dict[str, Any]]:
        return list(self._tools)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        if self._session is None:
            raise RuntimeError("session not connected; use `async with session.connect()`")
        result = await self._session.call_tool(name, arguments=arguments)
        # MCP tool result は content list。テキスト連結で返す
        parts: list[str] = []
        for c in result.content or []:
            t = getattr(c, "type", None) or getattr(c, "_type", None)
            if t == "text":
                parts.append(getattr(c, "text", ""))
            else:
                parts.append(f"[{t}]")
        if result.isError:
            return f"[ERROR] {'\n'.join(parts) or '(no detail)'}"
        return "\n".join(parts) if parts else "(empty)"


async def _smoke_test(google_account: str, token_dir: str) -> None:  # pragma: no cover
    sess = WorkspaceMCPSession(google_account=google_account, token_dir=token_dir)
    async with sess.connect() as s:
        for t in s.tools[:5]:
            print(t["name"], "-", t["description"][:80])


if __name__ == "__main__":  # pragma: no cover
    import os
    import sys

    asyncio.run(
        _smoke_test(
            google_account=os.environ.get("WALKERS_GOOGLE_ACCOUNT", "naru.hosoya@walker-s.co.jp"),
            token_dir=os.environ.get("GOOGLE_WORKSPACE_MCP_TOKEN_DIR", "/tmp/.workspace-mcp"),
        )
    )
    sys.exit(0)
