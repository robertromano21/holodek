# City Services

Saved service venues appear as discoverable `S` landmarks on the adventurer's map. Labels and discovery banners say `Services Inside`. Homes and parks are excluded; visibility and fog still apply. Names remain saved campaign names.

Nearby service providers offer `Access Services` before any introduction or model request. `Not Now` spends neither. Offers share eight-second spacing and a per-provider ninety-second cooldown. Ordinary resident greetings retain their separate movement/cooldown budget. Character clicks remain optional.

The same proximity flow works on streets, not just inside buildings. Saved job givers show `View Job Offers`; declining creates no encounter or contract. Procedural workers use their saved venue duties and can introduce services/local work when accepted. Only saved contracts are offered or paid. New city seeds have 4-15 residents per building (previously 3-12), with roughly one sidewalk pedestrian per 67 eligible cells rather than 89. Total crowd and visible actor limits remain 2048 and 24; existing completed saved crowds are preserved.

Physical service counters are an additional shortcut. New venue construction includes one genre-native counter and an adjacent work site. Older saved venues use an existing suitable counter/desk/table without rebuilding geometry. Hovering identifies `Service Counter`; clicking it is consent to start services, without a second invitation.

The server resolves counters from saved geometry and actual operator bindings. Players must be within three cells of the counter; the living peaceful attendant must still be visible and within normal speaking range. Counters cannot authorize another venue/floor, an absent operator, or a hidden/hostile attendant. Stock, payment, nonce and revision checks remain authoritative on every transaction.

The selected provider stops wandering during invitations, introductions and menus. Other residents keep moving. Closing, external dismissal, combat, death or room/floor/run changes release the hold. Buy refreshes the same menu directly.

Room-entry task polling is serialized. Completed receipts are consumed once; late responses cannot append false server errors after successful narration.

Live speech can carry authored `passing`, `addressing`, or `question` attention. Passing remarks do not stop normal movement. Directed speakers approach the listener using existing walkable front-of-view goals, then hold through speech and voice-synthesis waits. Questions addressed to the PC keep that hold until a reply/conclusion or the player leaves. Moving more than three cells from the conversation's starting point, leaving hearing range, changing floor/run, combat or death releases it. Rotation can reframe the speaker but never rotates the player's camera or teleports a character. Cached non-question ambient remarks default to passing behavior; legacy live dialogue keeps directed behavior.

Committed foreground quest seeding emits a distinct gold `New Quest` notice (`New Quest Step` for later objectives). It quotes the actual saved quest/objective and stays until dismissed. A stable receipt stored on the task prevents repeats after save/reload; that UI receipt is excluded from immutable task identity so it cannot invalidate quest scene/delivery gates. Preparation, failed construction and ordinary rumors do not emit it. It is interface feedback, not new dialogue, story or a model request.

## Routine Encounters

New population generation receives the living combat party, not just its names. Dungeon hostile slots form coherent groups of 2-6, generally near party size with a one-member variation. Larger parties can seed additional dungeon residents (up to 16 without increasing the existing 24-resident special-floor cap). Each cohort preserves its first authored group label, allegiance and home site across single-slot requests; individuals retain their own model-authored identities, histories and remarks. There is no extra planning model request. Starting guides, service operators, quest contacts, identity-bound citizen introductions, reused saved populations and separately scripted bosses are not routine rebalance targets. Existing level/stat rules remain in place; Dantuea is not weakened to an average fight.

Settlements retain civilian majorities: optional coherent 2-6-member threat cohorts can be authored instead of scattered solo attackers. Each cohort's first member can instead establish a peaceful group; other ordinary city slots remain peaceful. This does not convert existing civilians or raise street spawn frequency.

Supplemental dungeon encounters now require both 32 walked cells and 60 seconds since the last attempt, capped at four per room (previously 48 cells, 120 seconds, two). Settlement interiors retain 48/120/two; outdoors retain 96/90/five. Supplementary groups use living party size plus/minus one, clamped to 2-6. Allegiance remains model-authored, not a fixed hostile probability. Active combat, dialogue, nearby hostiles, unresolved discoveries, starting-room safety, retreat, roster caps and safe placement still gate additions. A peaceful dungeon resident more than eight cells away no longer suppresses additions across 28 cells; settlements keep the broader crowding guard.

Outdoor travel discovery now supports saved groups of five and six, using connected, visible, unoccupied walkable sites without crossing walls, stairs, doors or cliffs. It still alternates toward hostile/peaceful groups when available, does not duplicate/re-author cast, and preserves known or quest-bound residents.

Tests: `city-service-*.test.cjs`, `city-resident-greetings.test.cjs`, `commerce-ui.test.cjs`, `combat-character-ui.test.cjs`, and `prepared-room-entry-polling.test.cjs`.
