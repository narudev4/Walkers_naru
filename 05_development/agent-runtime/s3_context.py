"""S3 を真理源としたコンテキスト読み書き。

S3 prefix → ローカルパスの対応は sync スクリプトと揃える:
    context/   → 00_context
    projects/  → 03_projects
    tasks/     → タスクグラフ JSON (Agent 専用)
    html/      → 生成済 HTML
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class S3Config:
    bucket: str
    region: str = "ap-northeast-1"
    prefix_tasks: str = "tasks"
    prefix_context: str = "context"
    prefix_projects: str = "projects"


class S3Context:
    """S3 を thin wrapper した key-value access."""

    def __init__(self, config: S3Config) -> None:
        self.config = config
        self._client = boto3.client("s3", region_name=config.region)

    # ---- 汎用 -------------------------------------------------------------

    def get_text(self, key: str) -> str | None:
        try:
            resp = self._client.get_object(Bucket=self.config.bucket, Key=key)
        except ClientError as e:
            if e.response["Error"]["Code"] in {"NoSuchKey", "404"}:
                return None
            raise
        return resp["Body"].read().decode("utf-8")

    def put_text(self, key: str, body: str, *, content_type: str = "text/markdown") -> None:
        self._client.put_object(
            Bucket=self.config.bucket,
            Key=key,
            Body=body.encode("utf-8"),
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )

    def get_json(self, key: str) -> dict[str, Any] | None:
        body = self.get_text(key)
        return json.loads(body) if body else None

    def put_json(self, key: str, obj: dict[str, Any]) -> None:
        body = json.dumps(obj, ensure_ascii=False, indent=2)
        self.put_text(key, body, content_type="application/json")

    def list_keys(self, prefix: str) -> list[str]:
        paginator = self._client.get_paginator("list_objects_v2")
        keys: list[str] = []
        for page in paginator.paginate(Bucket=self.config.bucket, Prefix=prefix):
            for obj in page.get("Contents", []) or []:
                keys.append(obj["Key"])
        return keys

    # ---- プロジェクト / タスク ---------------------------------------------

    def list_projects(self) -> list[str]:
        """`projects/<id>/` を 1 階層下まで列挙してプロジェクト ID を返す."""
        prefix = f"{self.config.prefix_projects}/"
        seen: set[str] = set()
        for key in self.list_keys(prefix):
            parts = key[len(prefix):].split("/", 1)
            if parts[0]:
                seen.add(parts[0])
        return sorted(seen)

    def tasks_key(self, project_id: str) -> str:
        return f"{self.config.prefix_tasks}/{project_id}.json"

    def get_tasks(self, project_id: str) -> dict[str, Any]:
        data = self.get_json(self.tasks_key(project_id))
        if data is None:
            return {
                "project_id": project_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "tasks": [],
            }
        return data

    def put_tasks(self, project_id: str, tasks_doc: dict[str, Any]) -> None:
        tasks_doc["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.put_json(self.tasks_key(project_id), tasks_doc)

    # ---- メモリ (decisions / facts / preferences) --------------------------

    def get_memory(self, kind: str) -> str:
        """`kind` ∈ {decisions, facts, preferences}. 無ければ空文字."""
        key = f"{self.config.prefix_context}/memories/{kind}.md"
        return self.get_text(key) or ""

    def append_memory_jsonl(self, kind: str, entry: dict[str, Any]) -> None:
        """append-only JSONL モード (v3 で `memories/` を JSONL 化する想定)."""
        key = f"{self.config.prefix_context}/memories/{kind}.jsonl"
        existing = self.get_text(key) or ""
        line = json.dumps(entry, ensure_ascii=False)
        self.put_text(key + ".new", existing + line + "\n", content_type="application/x-ndjson")
        # 2-stage commit: 別 key に書いてから rename 相当の copy + delete
        self._client.copy_object(
            Bucket=self.config.bucket,
            Key=key,
            CopySource={"Bucket": self.config.bucket, "Key": key + ".new"},
            ServerSideEncryption="AES256",
        )
        self._client.delete_object(Bucket=self.config.bucket, Key=key + ".new")
