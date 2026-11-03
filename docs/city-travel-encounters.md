# City Travel Encounters

City streets and public parks share the large-outdoor discovery sampler. City
districts must span at least 64 by 64 cells; the safe opening and host-local
building floors are excluded. Private walk-in building parcels do not advance
the city travel clock and cannot receive a street encounter.

Prepared discoveries retain the wasteland thresholds: 48-72 tiles of new-ground
progress after at least eight seconds of movement, or a quiet-time opportunity
after 45 seconds of movement, 24 tiles walked and an eight-tile excursion.
Standing, tiny back-and-forth movement, disconnected movement and polling gaps
do not earn progress. Previously explored streets still support the quiet-time
path. Existing pacing and exploration counters are persisted with population.

Only unseen mobile groups may use this placement pool. Services, quest contacts,
workers, guards, home-bound and already encountered residents retain their saved
locations and identities. City ground objects are not relocated. Placement uses
reachable public cells 14-20 tiles ahead, avoids occupied cells and never grows
geometry. A nearby hostile or unresolved discovery prevents another placement.

In eligible outdoor areas, ordinary unseen patrols do not require players to
search their original population coordinates. Unencountered groups accidentally
marked fixed are returned to the travel pool once at least 36 tiles offscreen.
Entry proximity only preserves a nearby group when there is actual line of
sight, not merely a short straight-line distance through a wall. Speaking,
discovery, engagement, pursuit sightings, casualties, recruitment and departure
all preserve the known group's location. This recovery reuses its saved members,
stats and loot; it does not generate replacements or alter terrain.

A quest that names members of an ordinary prepared roaming cohort binds their
identities and room, not their arbitrary initial tiles. Such cohorts can still
arrive through travel discovery. Explicit fixed/quest-bound groups and actors,
boss spaces, regional casts, actual camps, venue workers, services and anchored
quest contacts retain their location protections. Quest tasks and their target
names are unchanged by this placement repair.

Supplemental city encounter eligibility uses the same movement sampler, requires
90 seconds of active walking and 48 tiles of exploration (or meaningful travel
over previously explored ground), and permits at most two installed groups per
room. Ordinary civilians and passing speech do not suppress eligibility. Pauses,
combat, focused conversations, service menus, retreats and the safe opening
retain their existing protections. Population visits are tracked through browser
receipt application before another world command can capture its state.

New dangerous rooms partition their existing ordinary population into coherent
encounter groups. Each group independently uses the original engine-owned odds:
60% Hostile, 20% Neutral and 20% Friendly. This replaces the room-level hostile
quota and quiet-neighbor override; there is no separate 85% hostile-room roll.
Population targets are unchanged. Opening rooms, peaceful service interiors,
service operators, quest contacts, existing citizen identities and scripted
casts retain their exceptions. A saved seed cannot be replaced by a stale
browser snapshot or rerolled on a retry. Legacy reservations supply a stable
identity but their old hostile count no longer dictates newly authored casts.
Existing authored populations are never rebalanced by a release upgrade.

The protected opening at 0,0,0 offers neither services nor local jobs, including
saved legacy offers. Residents can greet the player and be recruited. Service
landmarks, counters, invitations, stock authoring and job requests are suppressed
there, without deleting existing actors, inventory or loot. Host-local building
floors remain separate spaces and keep their own venue and encounter rules.

Ordinary cohorts contain 2-6 party-scaled members. The existing population is
partitioned across encounters rather than adding maximum-size fights on top.
The model authors the native identities, histories, motives and dialogue, but
cannot replace engine-selected hostile cohorts with peaceful workers or
arbitrarily change a Neutral or Friendly cohort to Hostile.
City/village civilian-majority rules apply to the civilian slots, not the
separately planned roaming threats. Service and quest-contact slots stay safe.

New ordinary hostile levels use the rounded average of living combat-capable
party members other than Mortacia, through average + 2 (within levels 1-20).
Supplemental encounters hydrate missing map-actor levels from the authoritative
party sheets before rolling. Mortacia still counts toward group size, not the
level average. Starter residents, peaceful residents, existing citizen identities
and scripted/boss encounters retain their existing generation rules. Saved casts
are not rerolled. Generation logs include the party baseline and hostile levels.

Supplemental checks keep their 25% chance per eligible attempt, then use the
same 60% Hostile, 20% Neutral and 20% Friendly disposition. Misses consume the same travel budget
and cooldown as hits; polling cannot repeatedly roll the same opportunity.
At most two supplemental groups are installed per room. These selected groups
must be authored, not silently declined or changed to a different disposition.

Prepared fixed/discovery groups reveal without model calls. A new pre-authored
supplemental reserve is not implemented: the supplemental path still authors
new groups on demand. That latency optimization remains separate.
