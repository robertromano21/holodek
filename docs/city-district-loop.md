# Playable City District Slice

## World-Grid Streets

New completed city plans use the anchor's actual world layer. A north gate from `0,0,0` leads to `0,1,0`; every street-to-street compass exit moves exactly one adjacent world coordinate and returns reciprocally. If the preferred street footprint is occupied, installation tries another free cardinal gate and rotates the plan. It never avoids a street collision by sending ordinary travel to Z+30. No safe bounded footprint means no partial installation or overwritten room. Private building storage aliases and host-local floor travel retain their existing behavior.

Room construction adopts the saved city's name and exit graph before deriving neighbors or writing its description, rather than using provisional client exits. Existing installed cities retain their old addresses, contents and quest bindings; this is not an automatic saved-world migration. Start a fresh world to test the corrected city layout.

Quest-element placement prompts and schemas use the same allowed existing coordinate list. Nearby resident reuse keeps the current room eligible; preferring a different room is a soft instruction, not a contradictory enum exclusion. Boss coordinates remain excluded. Invalid structured choices use the existing bounded selection-repair policy, without rerunning construction or inventing a fallback location.

## Authored Scenery Assets

Custom scenery keeps its authored type, label and logical tile key, including spaces and non-ASCII text. Only the PNG filesystem stem is converted to a bounded SHA-256 name when needed; already-safe legacy names remain unchanged. Both dungeon-testing and normal/helper construction use the same boundary. Renderer path validation remains strict. No label rewriting, model retry, content fallback or navigation revert is needed to render these features.

The second-room `Invalid sprite name` failure occurred after the server had adopted the destination coordinates but before it published the new dungeon. Subsequent requests from the still-displayed old room correctly returned stale-room 409s. Those guards must not be removed to hide a construction failure. Regression tests execute both actual construction loops with the logged labels, write real PNGs in a temporary directory, and verify transfer/inlining and traversal rejection.

## Adjacent Construction

After acknowledgement of a displayed room, up to three helpers preconstruct its immediate registered neighbors. The PC plans each destination's physical exits and reserves its new frontier coordinates before dispatch, so ordinary neighboring builds do not spend a full authoring pass proposing the same new coordinate. Existing registered neighbors remain read-only. Population publication releases frontier reservations so those new named rooms can receive their own assignments; completion never recursively queues an unexplored ring.

A provisional `namePending` label may be replaced once by the model's accepted name at the population checkpoint, under the same destination/run/lease. Subsequent geometry, music and art orders use that name. Final names cannot be freely changed, and missing population/description or a wrong lease still rejects atomically. Host receipts preserve finalized names and pre-dispatch topology against older browser snapshots. Authored text is not replaced with procedural prose.

Foreground entry joins the chosen destination's existing prebuild before creating the first quest. The first room still cannot seed a quest, and background construction never creates one. The first quest is seeded only on actual entry into whichever second room the player selects. A completed room is reused rather than rebuilt; genuine run, restore, model, connection or quest changes still fence unfinished work. Entering before a helper finishes can still require waiting for its remaining work, and first-quest authoring remains separate entry-time work; these changes are not a claim of zero latency.

`tests/adjacent-construction.test.cjs` covers the captured failure paths, three independently selected second-room routes, real pending-name code, PNG-name compatibility through the existing visual-asset tests, early disjoint reservations, stale synchronization and strict invalidation. Existing pool/chain tests retain atomic conflict rejection, bounded retries, cache checks and branch-order coverage. These are deterministic/offline checks, not a live-model timing result.

An unfinished quest or its saved tasks takes precedence over missing artifact metadata. Later room entry must not reset its description, task list, task index or seeded flag merely because `Next Artifact` says `None`. Verified completion still permits successor authoring. Genre quest fields use isolated structured requests with the saved world and exact accepted bindings, avoiding the gameplay transcript's conflicting prohibition on inventing items. Placeholder artifact/boss/location names and quest prose reject through the bounded model-validation path, never stock replacements. New bindings publish together only after every field is accepted; failed authoring leaves the prior console and quest state intact. An already rerolled live quest is not automatically restored.

A fully completed, current-run/model prebuild now commits its arrival and room-local population and displays before first-quest authoring starts. Population handoff is staged before commit. The same serialized turn continues quest setup and narration; movement is available, but transactions and new world commands still wait for that turn to finish. The final response does not resend the dungeon or reset the camera. Partial, foreign or mismatched prebuilds retain ordinary construction. Quest inference still takes time, and a room that has not finished prebuilding still requires construction; neither is hidden behind procedural story text.

Finalized exit reports survive serialization and runtime arrival without rebuilding their meshes. This preserves genre-dressed markers and the exact geometry fingerprint, rather than replacing them with generic exit shapes or changing structure order. New exit directions or doorway bindings still rebuild the report. Display acknowledgements retain strict run/room/stamp validation and retry while a foreground turn is busy, so new helper jobs start against the settled quest context. They do not count a busy acknowledgement as successful or recurse into unexplored rings.

`tests/prepared-room-entry.test.cjs` exercises real staged population handoff, a stalled first-quest request after display, immutable genre exit props, rejected stale/partial prebuilds, failure rollback and browser state updates without releasing the command gate. The captured-city probe additionally checks the exact archived fingerprint mismatch in both Node and the browser module. These checks are offline, not live-model/browser timing claims.

## Floor Purposes

Street-connected buildings use the saved LLM-authored city's lower, middle, upper and roof uses instead of replacing all four with the ground-floor business. A physical-use classifier selects an approved venue layout from those words; the original authored use remains in the floor's generation brief. The district's approved mixed-use list supplies the layout when the use is ambiguous. Ground-floor businesses retain their identity.

Floors remain lightweight addresses until entered. Existing furniture, visible native light fixtures, circulation and population generation build the interior once. Reconnecting/reinstalling must preserve visited rooms, contents, completion metadata, resident departures, defeat and inventories. No existing city's saved floors are retroactively repurposed.

## Venue Actions

New populated city establishments bind a local desk to a real, living peaceful staff member. This does not turn guilds, courts or archives into equipment shops. Their normal conversation, books and inventory remain available.

Buy buttons and `buy [item] from [name]` / `sell [item] to [name]` use the same verified economy transaction and nonce. With one nearby registered trader, the name may be omitted; ambiguous or absent traders produce an explicit message, never a model-adjudicated purchase. Busy/paused buttons explain why trading is blocked. The latest current-room server console takes precedence over an older conversation record when preparing a transaction. Server-side rejections are logged as `CommerceRejected` without relaxing stock, money, proximity, floor, run or revision guards.

- Inns offer paid party rest: two units of the setting's currency, restoring conscious injured party members' HP. Rest does not resurrect, stabilize dying characters, refill abilities or change equipment. Local hostiles, unavailable/distant hosts, insufficient funds and stale state block it. Economy receipts prevent duplicate charges.
- Staff can offer local delivery work on request. The LLM authors only a short title, purpose and parcel description, not participants, routes, rewards or prerequisites. Each field is bounded; the local model uses the existing input/output-aware work splitter. No per-resident or eager city-wide job calls occur.
- The engine selects real peaceful participants in already populated, reachable venues of the same city/community. Saved street doorway connections participate in route search. Unknown, hidden, locked or forged connections do not.
- Acceptance issues the existing tagged dispatch item. Only the real item-transfer receipt pays the escrowed reward, once, through existing completion feedback. Asking again or reloading preserves the same offer/completed job; it cannot farm rewards or advance the main quest.

One delivery offer per origin is retained in this slice. No known reachable recipient means a clear request to explore another venue first, not an invented destination. The route search retains its existing bounded local scope. Named actors and lightweight crowds still use the existing room population system; this slice does not add whole-city commuting, arena tournaments or a new economic simulation.

## Verification And Activation

`tests/city-district-loop.test.cjs` exercises the cross-building delivery loop in CotG and all 18 genre worlds with a mocked author response, actual inventory transfer/reward code, replay protection, interruption/concurrency guards, local budgets, fitted furnished floors and saved-state preservation. It is not a live-model or GPU browser test.

Verify source and worker bundle with `node .retort-data/host-local-floors/verify.cjs`. Verification does not change save slots, deploy workers, restart either game server or start a browser. Engine changes require a coordinated update of all three website helpers and gameServer. The current release updater is `.\tools\update-helpers.ps1`. If the running PC server is pinned to the previous release, it exits before deployment and asks for a user-controlled gameServer restart. Keep the game closed, restart only gameServer, then rerun the updater and verify all three helpers before playing. Never run gameplay while engine versions differ. gameServer2 is left alone.
