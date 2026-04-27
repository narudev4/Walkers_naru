"""
Monkey-patch Playwright's CDP connection to ignore Browser.setDownloadBehavior errors.
Chrome 147 removed this CDP method, causing connect_over_cdp() to fail.

Usage:
    import pw_cdp_patch  # Must be imported before connecting
    pw_cdp_patch.apply()
    # Then use playwright as normal
"""

import asyncio


def apply():
    """Patch Playwright's internal CDP session to swallow setDownloadBehavior errors."""
    try:
        from playwright._impl._connection import Connection

        _orig_send = Connection._send_message_to_server

        async def _patched_send(self, *args, **kwargs):
            try:
                return await _orig_send(self, *args, **kwargs)
            except Exception as e:
                if "setDownloadBehavior" in str(e):
                    return None
                raise

        Connection._send_message_to_server = _patched_send
    except Exception:
        pass

    # Also patch at the protocol transport level
    try:
        from playwright._impl._transport import Transport

        if hasattr(Transport, 'send'):
            _orig_transport_send = Transport.send

            def _patched_transport_send(self, message):
                return _orig_transport_send(self, message)

            Transport.send = _patched_transport_send
    except Exception:
        pass
