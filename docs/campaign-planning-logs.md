# Campaign Planning Logs

Each newly generated game writes `logs/campaign-planning-<run-id>.txt`.
It is an append-only developer diagnostic, separate from the in-game journal and
game log. It contains spoilers and is never loaded as gameplay state.

The first entry records the accepted campaign atlas: regional names, ecology,
livelihoods, faction purposes and the route toward Hades. It identifies an LLM
plan versus the seeded fallback. The first connected regional adventure adds its
actual room coordinates and names, inhabitants and histories, inscriptions,
dialogue stages, planned encounters, rescue/escort alternatives, faction choices
and engine-verifiable requirements. Rejected first-adventure proposals record
the fallback reason, not a successful installation.

Later quest generation and changes append to the same file, including every
recorded task completion, failed task and local contract completion. Completing
a quest or clearing the active task list does not erase its earlier plans.
Unchanged snapshots are deduplicated during a server process; after a restart,
entries append to the existing file rather than replacing it. Concurrent
updates are serialized per file. Files from earlier game runs remain separate.

Logging requires no additional model requests. Write failures warn in the
server log but cannot stop generation or change quest state. Restart the server
to activate the hooks; existing history cannot be reconstructed if it was
already discarded before logging was enabled.
