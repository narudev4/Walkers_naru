"""Slack 連携 (v4) スタブ.

Lambda + API Gateway HTTP API から呼ばれる想定。signing secret 検証 → スレッド
コンテキスト取得 → Agent.once 実行 → Slack に return。

実装方針 (v4 で完成させる):
    1. event['headers']['x-slack-signature'] と x-slack-request-timestamp を
       walkers/slack-signing-secret で HMAC 検証
    2. event['body'] (JSON) から channel/user/text を抜く
    3. mode_once を呼び、結果を chat.postMessage で同じ thread に返す
    4. タスク追加要求等は agent 側の MCP/tool 呼出にマッピング

現段階ではプレースホルダ。意図的に動かないようにしてある。
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """API Gateway HTTP API v2 のイベント形式に対応."""
    raise NotImplementedError(
        "Slack 連携は v4 で実装予定。docs/agent-runtime.md の 'v4 で完成させる' セクション参照。"
    )


def _verify_slack_signature(body: bytes, timestamp: str, signature: str, secret: str) -> bool:
    """Slack signing secret による HMAC-SHA256 検証 (実装スケルトン)."""
    import hashlib
    import hmac
    import time

    if abs(time.time() - int(timestamp)) > 300:  # 5 分以上ズレてたら拒否
        return False
    sig_basestring = f"v0:{timestamp}:".encode("utf-8") + body
    my_sig = "v0=" + hmac.new(secret.encode("utf-8"), sig_basestring, hashlib.sha256).hexdigest()
    return hmac.compare_digest(my_sig, signature)


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps({"status": "stub", "see": "docs/agent-runtime.md"}))
