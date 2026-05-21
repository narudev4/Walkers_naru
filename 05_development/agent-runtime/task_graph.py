"""プロジェクト単位タスクグラフ.

データモデル:
    tasks: list[Task]
    Task:
        id, title, owner, due (ISO date), status,
        depends_on (list[task_id]), calendar_event_id, notes
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from typing import Any, Literal

logger = logging.getLogger(__name__)

TaskStatus = Literal["todo", "in_progress", "blocked", "done", "cancelled"]
ALLOWED_STATUS: frozenset[str] = frozenset(["todo", "in_progress", "blocked", "done", "cancelled"])


@dataclass
class Task:
    id: str
    title: str
    owner: str = "naru"
    due: str | None = None
    status: TaskStatus = "todo"
    depends_on: list[str] = field(default_factory=list)
    calendar_event_id: str | None = None
    notes: str = ""

    @classmethod
    def new(cls, title: str, **kwargs: Any) -> Task:
        return cls(id=f"t-{uuid.uuid4().hex[:8]}", title=title, **kwargs)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Task:
        return cls(
            id=d["id"],
            title=d["title"],
            owner=d.get("owner", "naru"),
            due=d.get("due"),
            status=d.get("status", "todo"),
            depends_on=list(d.get("depends_on") or []),
            calendar_event_id=d.get("calendar_event_id"),
            notes=d.get("notes", ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class TaskGraph:
    """1 プロジェクト分のタスクグラフ."""

    def __init__(self, project_id: str, tasks: list[Task] | None = None) -> None:
        self.project_id = project_id
        self.tasks: dict[str, Task] = {t.id: t for t in (tasks or [])}

    @classmethod
    def from_doc(cls, doc: dict[str, Any]) -> TaskGraph:
        tasks = [Task.from_dict(t) for t in doc.get("tasks", [])]
        return cls(project_id=doc["project_id"], tasks=tasks)

    def to_doc(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "tasks": [t.to_dict() for t in self.tasks.values()],
        }

    # ---- 変更操作 ----------------------------------------------------------

    def add(self, task: Task) -> Task:
        if task.id in self.tasks:
            raise ValueError(f"task {task.id} already exists")
        self.tasks[task.id] = task
        return task

    def update(self, task_id: str, **fields: Any) -> Task:
        t = self.tasks[task_id]
        for k, v in fields.items():
            if k == "status" and v not in ALLOWED_STATUS:
                raise ValueError(f"invalid status: {v}")
            setattr(t, k, v)
        return t

    def remove(self, task_id: str) -> None:
        self.tasks.pop(task_id, None)

    # ---- クエリ ------------------------------------------------------------

    def due_on(self, on: date) -> list[Task]:
        target = on.isoformat()
        return [t for t in self.tasks.values() if t.due == target and t.status != "done"]

    def overdue(self, today: date | None = None) -> list[Task]:
        today = today or date.today()
        out: list[Task] = []
        for t in self.tasks.values():
            if t.status in {"done", "cancelled"} or not t.due:
                continue
            try:
                if date.fromisoformat(t.due) < today:
                    out.append(t)
            except ValueError:
                logger.warning("invalid due date on task %s: %s", t.id, t.due)
        return out

    def ready(self) -> list[Task]:
        """依存関係を満たしていて status=todo のもの."""
        done = {t.id for t in self.tasks.values() if t.status == "done"}
        return [
            t
            for t in self.tasks.values()
            if t.status == "todo" and all(dep in done for dep in t.depends_on)
        ]

    # ---- Markdown <-> 相互変換 ---------------------------------------------

    @classmethod
    def from_markdown(cls, project_id: str, md: str) -> TaskGraph:
        """`03_projects/<project>/tasks.md` の素朴な箇条書きから抽出.

        想定フォーマット:
            - [ ] タスク名 @due:2026-05-25 @owner:naru
            - [x] 完了タスク @due:2026-05-20
        """
        import re

        graph = cls(project_id=project_id)
        pattern = re.compile(r"^\s*-\s*\[( |x|X)\]\s*(.+?)\s*$")
        meta_re = re.compile(r"@(\w+):(\S+)")
        for line in md.splitlines():
            m = pattern.match(line)
            if not m:
                continue
            done = m.group(1).lower() == "x"
            title_with_meta = m.group(2)
            meta = dict(meta_re.findall(title_with_meta))
            title = meta_re.sub("", title_with_meta).strip()
            graph.add(
                Task.new(
                    title=title,
                    due=meta.get("due"),
                    owner=meta.get("owner", "naru"),
                    status="done" if done else "todo",
                )
            )
        return graph

    def to_markdown(self) -> str:
        lines: list[str] = [f"# タスク: {self.project_id}", ""]
        lines.append(f"_最終更新: {datetime.now().isoformat(timespec='seconds')}_")
        lines.append("")
        for t in sorted(self.tasks.values(), key=lambda x: (x.status, x.due or "9999-12-31")):
            mark = "x" if t.status == "done" else " "
            meta_parts: list[str] = []
            if t.due:
                meta_parts.append(f"@due:{t.due}")
            if t.owner and t.owner != "naru":
                meta_parts.append(f"@owner:{t.owner}")
            if t.status not in {"todo", "done"}:
                meta_parts.append(f"@status:{t.status}")
            meta = " " + " ".join(meta_parts) if meta_parts else ""
            lines.append(f"- [{mark}] {t.title}{meta}")
            if t.notes:
                lines.append(f"  - notes: {t.notes}")
        return "\n".join(lines) + "\n"
