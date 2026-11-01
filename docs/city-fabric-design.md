# City Fabric Direction

## Target

Keep roughly 30-60 significant, persistent locations per city: civic landmarks, major establishments, faction seats, district centers and campaign destinations. Surround and connect them with much larger seeded street-and-block fabric. A metropolis is not thirty buildings on an empty field, and size must not require a separate model call for every house.

The reference city map illustrates spatial hierarchy: walls and gates, arterial roads, irregular blocks, waterfront access, open space and recognizable districts. Reuse that hierarchy, not the same map or canonical lore in every genre. Space habitats, arcologies, desert cities, harbors and underworld cities require different layouts, materials, skyline scales and transport.

## Three Layers

- A saved city topology binds major locations, districts, public routes, entrances and city boundaries to stable coordinates.
- Seeded procedural fabric supplies many additional blocks, frontages, courtyards, homes, minor establishments, alleys, infrastructure and occupants. The same seed and parcel coordinates must reproduce the same place.
- Player investigation and encounters can promote any appropriate procedural parcel into richer persistent gameplay. Only nearby chunks need full geometry and active simulation.

The procedural layer is not inert scenery. A seemingly ordinary workshop can hide a problem, a resident can ask for help, and a street encounter can begin a new side story. Conversely, not every door needs a quest and not every stranger needs a dramatic revelation.

## Emergent Gameplay

Investigation, conversation or an encounter may propose a new side job or quest through the existing adjudication and quest-authoring chain. New hooks must:

- Respect the current biome, district, building use, genre, currency, local faction and actual inhabitants.
- Persist the parcel identity, involved characters, commitments, discovered facts and job state after authoring.
- Keep the main campaign and existing active objectives intact; side jobs must not silently replace them.
- Bind targets to real reachable locations and operators, not invent vendors or unreachable buildings in dialogue.
- Award items, money, reputation and objective completion only through verified engine changes.
- Preserve declined, completed, recruited and dead records so revisits do not replay the same introduction or resurrect encounters.
- Give characters only their own witnessed memories and legitimate regional knowledge, even when API models use larger context.

This is compatible with surprises and new scenarios. Determinism governs spatial identity and persistence, not a fixed script of repetitive water-rights disputes, repairs or mandatory quest givers.

## Compilation And Performance

Do not expand all filler into hundreds of eagerly authored room records. Save a bounded city plan plus deterministic parcel/chunk seeds. Generate nearby geometry using approved assets, reserved street routes and actual fixture lighting; activate detailed residents and stories on demand. Streaming must eventually retain skyline continuity while replacing distant blocks with cheaper representations.

The PC remains state authority. Helpers may prepare deterministic geometry, art and bounded authoring proposals, but only the owning room/parcel lease may commit them. Shared campaign facts are read-only dependencies, not permission to overwrite another generation's room or root record. Reuse completed builds and queue adjacent work only from visited locations.

## Current Implementation Boundary

This pass retains the existing 30-60-room city-site plan. The LLM authors a saved city identity, history, skyline, seven districts, major locales and local population proportions in bounded work orders. Seeded frontage descriptors expand those neighborhoods without an eager model request per house. It also adds 54 native urban silhouettes across 18 genres, visible arrival-centered city dressing, explicit city/biome bindings, genre-scoped ecology recipes, staffed new markets and verified public geography for dialogue. Small settlements remain small. Cells, collision routes, current saves and running servers are not retrofitted.

## Vertical Cities

City authorship includes representative tower height, appropriate stairs/ramps/lifts, stacked uses and whether covered upper connections belong in the setting. Modern and future metropolises can span dozens of storeys; medieval and divine underworld capitals are not subject to an arbitrary low genre ceiling. Small settlements retain their own scale.

The compiler reserves six of the existing 30-60 major location slots for two towers' middle, upper and enclosed crown-access stops. Each has stable coordinates, reciprocal up/down transit and a path back to its actual street. Authored covered skybridges connect the two crowns. Floor numbers and physical storeys are explicit saved metadata; private database z layers are identifiers, not a claim that every intermediate floor has been generated. Grounded dialogue receives the actual floor and use. Exterior skyline height follows the authored profile, subject to existing indoor ceilings.

These are connected landmark interiors, not continuous simulated skyscrapers. Intermediate floors, open rooftop platform geometry, visible interiors through windows, and seamless vertical street views still need the same lazy parcel/streaming layer described above. Do not advertise an unbuilt floor or roof as an accessible destination.

## Setting Populations And Names

Each newly constructed setting authors eight native encounter/population groups, their relative frequencies, behaviors, habitats and cultural naming syllables. City demographics reweight that saved table. No prefab genre creature table replaces this authorship. Children of the Grave also samples the original 358-kind D&D-style catalog through a separate nonzero weight; original genre worlds never inherit it.

Random individuals may use deterministic suggestions from the original game.js syllable generator, now shared between browser and server. New suggestions avoid current party/resident names and reserved identities. The LLM may improve those suggestions and still writes each individual's personality, history and voice. Fixed NPCs, named monsters and quest contacts remain LLM-authored; saved names are never rewritten to enforce novelty. Existing-name guidance asks for varied first names, surnames and sound patterns rather than near-identical full names.

Continuous city-wide parcel fabric, streaming between those parcels, and investigation-triggered promotion of individual filler buildings are the next layer, not features claimed complete by this patch. Existing encounter and quest systems must remain usable while that layer is introduced.

## Walk-In Street Blocks

Future outdoor city builds with architecture expansion enabled now compile up to twenty nearby building shells into actual collision cells, with separate parks where space permits. These replace the miniature decorative building ring. Each shell has four broad entrances, shallow steps, a lobby and two purpose bays, a real roof and genre-native upper massing. Major entrances bind to the existing saved building destinations and survive exit-marker reinstallation. Furniture is decorative; only cells define walls, steps and park boundaries. Existing items, roofs, reserved routes and reachability are protected. Already-built saves are not rewritten.

The scale convention is 2.5 metres per cell. Typical metropolis filler footprints are 55-75 metres across; a major anchor uses an 80-by-80-metre footprint. Height follows saved storeys at 3.4 metres each, with generous ground-floor clearance. Small settlements cap filler at three storeys. Roads and sidewalks use real per-cell surfaces in CPU, WebGL, WebGPU and tactical rendering, rather than tiny paving props laid over the biome floor. Parks have open entrances, low boundary walls and native furnishings. Public dialogue can identify the occupied ground-floor parcel without inventing a vendor or claiming unbuilt upper floors are accessible.

The deterministic descriptor supports 1,024 potential parcels in a metropolis district, but this is an address space, not a claim that 1,024 buildings or inhabitants are loaded. Only the bounded nearby patch is compiled in this pass. Continuous neighborhood streaming, occupied intermediate storeys and persistent filler-side-job promotion remain unfinished. Renderer screenshot validation must be reported separately from geometry tests.

## Acceptance Checks For That Layer

- A future metropolis looks dense in every street direction, with distinct districts and visible boundaries or long-range landmarks.
- Routes between major anchors exist in the saved topology and procedural road network; NPC directions follow those routes.
- A selected procedural building can acquire a persistent inhabitant, interior or side job without regenerating its neighbors.
- Returning after an investigation or completed job preserves the same parcel, participants and consequences.
- API models can use richer dialogue context; holodek-1 still uses bounded work orders with input and output reservations.
- Build time, draw counts and active simulation are bounded by the nearby view, not the total area of the city.

## Venue And City-Life Expansion

See [City Life And Architectural Research](city-life-research.md) for the primary-source references, all eighteen genre directions, physical dimensions and explicit implementation boundaries. New city plans now prioritize every authored major locale before seeded filler. Eighteen approved venue functions include arenas, guilds, parks, libraries, performance spaces, baths, transit, temples, courts and food halls alongside the original shops, lodging, workshops, care, homes and civic uses.

Venue footprints and clearances feed the saved city plan, exterior shells and fitted indoor geometry. Native furnishings occupy real reachable floor space. Bounded inhabitant requests author appropriate operators and visitors without another eager model call for each decorative frontage. Previously built rooms and their residents are not retrofitted; the existing feature flags still control activation.
