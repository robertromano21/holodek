# City Life And Architectural Research

## Design Contract

The LLM authors the city, its history, institutions, districts, significant names and inhabitants. Approved venue roles are functional constraints, not prefab plots or copied campaign locations. Preserve Children of the Grave's own cosmology and cultivated cast. Original worlds never inherit its gods, hero or underworld geography.

Maintain 30-60 persistent major locations, surrounded by deterministic neighborhood fabric. Install each authored major locale exactly once before adding filler. A named venue must have a real destination, reciprocal street access, a physically useful envelope and a bounded authored population when built. City-wide population is not a demand to generate thousands of combatants eagerly.

## Historical And Modern References

- Richborough combines street-front shops, housing, storage, granaries, baths, a port and an amphitheatre. This supports designing a city as connected everyday systems rather than an isolated list of adventure rooms. [English Heritage](https://www.english-heritage.org.uk/learn/teaching-resources/local-learning/richborough-roman-fort-and-amphitheatre/)
- Ostia combines a forum, baths, warehouses, guild seats, multi-storey housing and a principal temple. Use this mixed urban hierarchy as inspiration, not its exact map or religious identities. [Archaeological Park of Ostia Antica](https://www.ostiaantica.beniculturali.it/en/archaeological-sites-and-monuments/ostia-antica/)
- Chesters documents bridge abutments, approach ramps, wing walls and a relationship to adjoining roads. For game geometry, bridge approaches must reach their decks and supports must have grounded endpoints; decorative arches alone are not a traversable bridge. No source drawing is copied. [English Heritage](https://www.english-heritage.org.uk/visit/places/chesters-bridge-abutment-hadrians-wall/history/description/)
- Bodie's surviving boomtown fabric includes diverse homes and businesses, lodging, food, worship and entertainment. Western cities need more than a saloon and sheriff. [National Park Service](https://www.nps.gov/places/bodie-historic-district.htm)
- The Met's account of ancient funerary practices offers visual and cultural reference for remembrance and burial, not replacement lore for Children of the Grave. Its cities also need ordinary social, domestic and cultural lives. [Metropolitan Museum of Art](https://www.metmuseum.org/es/essays/death-burial-and-the-afterlife-in-ancient-greece)
- NASA's habitat work emphasizes life-support systems, while its crop research addresses food production. Space settlements should connect habitation, medicine, food, cargo, recreation and their supporting infrastructure instead of resembling torch-lit temples. [NASA Habitation](https://www.nasa.gov/humans-in-space/deep-space-habitation-overview/), [NASA Space Crops](https://science.nasa.gov/biological-physical/space-crops/)
- Singapore's downtown guidelines link ground-level walkways, through-block passages, underground transit access and elevated pedestrian networks. Adapt the layered connectivity principle for modern and futuristic cities; do not present this game as an engineering-code implementation. [Urban Redevelopment Authority](https://www.ura.gov.sg/guidelines/urban-design/downtown-core/)
- The Empire State Building is a real reference for skyscraper scale. Use physical dimensions, structural cores, active podiums and reachable transit, not a miniature house stretched upward without usable entrances. [Official Building Facts](https://www.esbnyc.com/about/facts-figures)

These sources inform original game-design inferences. They do not establish a universal historical city layout, reproduce a commercial campaign setting, or provide real construction instructions.

## Functions And Genre Interpretation

New major-city plans cover lodging, transit, courts, shops, bars, food halls, temples or contemplation institutions, clinics, baths, housing, parks, civic assembly, guilds, arenas, libraries, workshops, storage and performance. Names and social meaning remain authored. A secular world can interpret a mechanical temple role through its established institutions rather than importing a religion.

| Genre | Urban Life And Architectural Direction |
| --- | --- |
| Fantasy | Guild houses, coaching yards, courts, baths, tournaments, gardens, domestic courts and varied trades. |
| Dark Fantasy / CotG | Memorial gardens, archives, civic hearings, contests, performance and households. CotG adds its canonical funerary culture and underworld; other dark-fantasy worlds use their own inhabitants and cosmology. |
| Mythic | Stoas, processional streets, baths, public debate, contest grounds, theaters and household courts. |
| Science Fiction | Habitat rings or planetary districts, medical and knowledge facilities, food systems, fabrication, cargo and recreation. |
| Cyberpunk | Corporate podiums and towers, public transit, dense housing, worker associations, independent clinics, markets and nightlife. |
| Post-Apocalyptic | Reused civic structures, salvage associations, mutual aid, cultivation, performance and mixed communities; not perpetual water disputes. |
| Steampunk | Passenger interchanges, exhibitions, engineering societies, canals, glasshouses, workshops and residential terraces. |
| Western | Courts, depots, boarding houses, trades, baths, theaters, households and large commercial streets. |
| Modern | Mixed-use blocks, libraries, sports, courts, care, offices, homes, public parks and transport. |
| Noir | Municipal offices, unions, hotels, diners, archives, theaters and residential streets; crime is not everyone's profession. |
| Nautical | Shipwrights, chandlers, customs, maritime courts, storage, pilots, ferries, provisioning and inland neighborhoods. |
| Cosmic Horror | Functioning scholarly or coastal institutions, ordinary households and subtle contrasts with hidden unease. |
| Gothic Horror | Layered streets, hospitals, opera, courts, guilds, memorial gardens, residences and powerful civic or religious monuments. |
| Solarpunk | Ecological corridors, cooperatives, community learning, food systems, sports, mediation and accessible transit. |
| Dieselpunk | Rail hubs, factories, unions, offices, baths, sports, newsreel theaters and mixed housing. |
| Underwater | Pressure transitions, marine cultivation, oxygen infrastructure, medicine, acoustic performance and submersible transit. |
| Prehistoric | Gatherings, seasonal trade, craft lodges, oral knowledge, feasts, kin households and hot springs, within the world's actual capabilities. |
| Desert Fantasy | Shaded souks, caravan courts, baths, scholarly institutions, gardens, hearings and festival grounds. |

## Physical Scale And Playability

The game convention is 2.5 metres per cell. Purpose profiles use different envelopes: an ordinary shop is 40 by 50 metres, an inn 60 by 70, a temple 110 by 130, and an arena 140 by 120. These are major venue complexes, not minimum sizes for every minor frontage. Temple and arena halls have substantially greater headroom than domestic spaces. Monumental public venues do not automatically receive residential skyscraper crowns.

Indoor authored plans are fitted into their saved envelopes instead of silently growing to fill an entire district-sized grid. Rooms remain model-designed; the compiler maps their coordinates, retains their corridor links, enforces usable bounds and places native furnishings on actual floors away from reserved circulation. This is not a fixed prefab floor plan.

Outdoor shells have real collision walls, doors, native supported entrance frames, shallow entrance steps, grounded raised foundations, floor surfaces and roofs. Public parks remain open-air where appropriate; authored enclosed cities and underwater habitats retain a roof/pressure enclosure over public space. City streets and sidewalks have separately recorded widths and surfaces. Modern metropolis boulevards are broader than the historical street profile, but detailed lane hierarchies, curb geometry and freight networks remain future work.

Skyscraper metadata retains the existing bounded maximum of 160 storeys and 3.4 metres per storey. Only saved landmark floors and their reciprocal stairs, lifts, ramps or covered skybridge exits are destinations. Continuous stacked-floor simulation, fully rendered bridge decks between neighborhoods and city-wide streaming are not claimed complete.

## Inhabitants And Activity

Venue staff, colleagues and visitors are authored through existing small population batches. The current setting's population table and city demographic mix remain authoritative; fixed cast members and quest contacts are not renamed, moved or cloned. A named healer or vendor gets a real engine service binding, while a clerk, performer or arena official does not silently become an equipment merchant.

For the local model, only a bounded recent name list enters the prompt; the engine still checks the full global name set and makes unused deterministic name suggestions against it. API models retain their richer context. Local budget tests include 800 previously named citizens and reserve both input and answer tokens in the native 4096-token context.

An arena may host a contest, training, preparation or an unrelated personal scene; no automatic lethal fight is started. A guild may provide social contact without immediately issuing a quest. Lodging, performance and bathing are contextual activities, not newly implemented booking, gambling or bath-service transactions. Existing verified economy and quest mechanisms remain authoritative.

Compact named venues use a smaller inter-group placement gap and prioritize their bound operator. Already placed actors keep their positions. Recruitment, death, mercy, inventory and completed encounters retain existing persistence rules. Public directions can reference reachable named city venues using actual next exits, not coordinate guesses across private storage layers.

Only the major named venues and the bounded nearby block patch become active in this pass. Filler building promotion, detailed per-floor occupancy, full-day crowd schedules and seamless metropolitan streaming still require further implementation.
