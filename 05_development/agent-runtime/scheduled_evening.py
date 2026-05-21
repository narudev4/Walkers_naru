"""EventBridge Scheduler 用 夜のエントリ.

cron: 0 22 * * * (JST 22:00) で起動する想定。
"""

from __future__ import annotations

import asyncio
import logging
import sys

from agent import AgentConfig, mode_evening


def main() -> int:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )
    cfg = AgentConfig.from_env()
    result = asyncio.run(mode_evening(cfg))
    sys.stderr.write(
        f"evening done: iters={result['iterations']} "
        f"tokens(in/out)={result['usage']['input_tokens']}/{result['usage']['output_tokens']}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
