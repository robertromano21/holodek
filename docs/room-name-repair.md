# Missing-Neighbor Naming

A described room with an unnamed adjacent destination previously used a legacy
free-form generation call in CotG on normal models. The model's entire response
was trimmed and saved as the name, allowing a descriptive paragraph into the
adjacency field. Genre games and holodek-1 already used the scoped naming helper.

That repair branch now always calls `holodekRoomWork.roomName`. It uses an isolated
work order with a structured `name` field, not the parent gameplay history and
description. Existing names still require no generation. Existing target
coordinates, locks, keys and saved contents remain unchanged. No character or word
limit has been restored, and quest/regional authoring is unchanged.

This prevents new failures on the repaired branch; it does not rename already
corrupted saved rooms or alter the running session. Regression tests cover CotG,
holodek-1 and genre routing, saved-name reuse, failure without publishing a
neighbor, and raw prose rejection by the existing structured request.

After verification, close and relaunch Holodek, then run
`.\tools\update-helpers.ps1`. The updater checks the exact verified source and all
three selected local or authenticated website helpers. It never restarts either
server or modifies saved games.
