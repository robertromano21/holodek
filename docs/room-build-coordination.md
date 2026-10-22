# PC-Owned Room Construction

The PC game server is the sole authoritative coordinator. Foreground website
construction and adjacent preparation share one per-state, per-run lease
registry. The PC assigns destinations, immutable peer/stage context and write
sets. Workers return artifacts and shared-topology proposals, not replacements
for live game state. Topology ownership is reserved transactionally on the PC;
conflicting or foreign writes still fail before any room readiness is published.

## Confirmed Failure

The isolated production cached-room reproduction changed the visited source
room's isIndoor/isOutdoor aliases and added an empty objects array during
whole-database normalization. Those incidental changes triggered the old broad
ownership guard. Background population now normalizes only its assigned room;
checkpoint projection removes only recognized derived aliases/empty defaults
from non-target snapshots. It does not hide real object, name or arbitrary
field changes. Live source-room discoveries, dialogue and character state stay
authoritative. Append-only cross-game history is a separately validated PC
proposal, merged without replacing either worker's newly authored cast history.

## Concurrency And Recovery

Three adjacent jobs can run independently. Fresh execution snapshots include
earlier completed neighbors. Every remote stage carries its PC lease; wrong or
stale leases cannot enter the adapter's combined artifact. Topology planning
avoids new one-way links into other assignments. Existing city namespace,
three-way merge, protected-room and reciprocal-link checks remain enforced.

Retryable host merge conflicts get at most two fresh-snapshot attempts, with
250ms then 500ms backoff. There is no automatic retry for provider/model failure,
invalid identities, unsafe foreign writes or a late checkpoint after readiness.
Run/model/quest/connection invalidation cancels pending work and retry waits.
Old worker events cannot complete a replacement attempt. Foreground travel
joins the same logical promise across retry attempts instead of duplicating
construction. Completed jobs never recursively enqueue another ring of rooms.

Readiness still requires full population, valid installed geometry, illustration
and archived music. Logs include destination, lease owner, stage, attempt,
elapsed time, conflict/retry reason, normalized scratch paths and prefetch hits.

This staged change does not establish live throughput, guarantee a neighbor will
finish before the player travels, or authorize deployment/restarts. Offline
concurrency, adapter, cancellation, cached-production and schema regressions
provide evidence; a separately approved playtest remains necessary.
