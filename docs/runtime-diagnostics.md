# Runtime Diagnostics

Normal play keeps action outcomes, warnings, errors, quest events and compact task lifecycle messages. Full task replies, sprite payloads and room databases are not routinely dumped to the browser console. The campaign-planning files in `logs/` remain independent and retain their full quest plans and history.

Browser state dumps can be enabled temporarily with `window.DEBUG_LOGS = true` in DevTools. Set it back to `false` to quiet them again. This switch does not change gameplay.

The server logger removes embedded image/audio payloads, caps individual entries at 16,384 characters, and suppresses low-level parser traces and unchanged polling messages by default. Errors and warnings are not suppressed. Existing log files are not deleted or rewritten.

For a deliberate full-trace reproduction, set `HOLODEK_VERBOSE_LOGS=1` before starting the server. This bypasses compacting and routine-trace suppression and can produce very large logs. Remove the variable and restart to return to normal logging.
