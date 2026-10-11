# Modular Puzzles And Shrine Art

## Implemented Toolbox

The design pass produces one validated definition, used for both the room's puzzle prose and its actual controls. There are seven mechanical families: ordered buttons, three-position dials, sluice levers, linked levers, tracked sliding blocks, reusable counterweights, and ordered chimes. Fifteen themed kits choose an appropriate receiver instead of always building a cabinet.

There are 24 compatible family/kit pairings, four arrangements, five clue treatments and six materials: 2,880 base specification combinations. This is a compositional count, not a claim of 2,880 different reasoning tasks. Orders, goals, linkages, symbols and story discoveries add variations; many can still share a familiar solution strategy.

Ordinary actions remain deterministic server transactions, with no model call. Every installed control and reference plaque must be reachable. Linked-lever goals are checked for reachability before construction; other families have finite, resettable states. Completion still uses the existing verified XP/quest pipeline, with rewards recorded once. Lore can point toward an existing objective but cannot invent or complete a quest. Starting-room quest timing is unchanged.

The existing design request now allows 4,200 output tokens for mechanics plus bounded art and document metadata. It does not make a second paid request for decoration. Invalid definitions retry once, then use a validated fallback. Context fields are length-bounded.

## Presentation

Mechanical changes animate on the pause-aware game clock without persisting transient animation state in IndexedDB. Replaced GPU buffers are released. The existing character sprites and protected command parser are unchanged.

Sculptures combine pose, head, robe, held attribute and creature form. Deity depictions use a compact visual index of the campaign prompt: Mortacia is the tall blonde White Lady with skeletal dragon wings; the other deities retain their draconic origin. Fresco figures reuse the detailed procedural character generator, with separate pigment treatment. Copies are used so preset character data is not changed.

Fresco design now has independent traditions, subjects and articulated figures. Ten visual traditions are available: Renaissance, classical Roman, classical Greek, medieval Gothic, medieval illumination, Byzantine, Egyptian, Mesopotamian, Romanesque and Baroque. These are stylized fantasy adaptations of framing, depth, ornament, profile/frontal arrangements and scale, not museum reproductions or claims of archaeological accuracy. Historical techniques do not import their religions into the campaign.

Ten depicted scene families cover ancestral courts, burial rites, dragon wars, scholars, star maps, forges, river crossings, gardens of souls, gatekeepers and pilgrimages. Up to six figures can independently choose twelve poses, three facings, five garment forms, five head treatments (or class-derived costume) and twenty-nine held attributes. The new painter reassembles head, arm, hand and lower-body pixel layers exported through an optional character-rendering metadata path. Ordinary character raster output is unchanged, the original cached parts are copied, and held painted objects grant no real inventory or magic. Artwork is stored as explicit metadata; the LLM chooses from the validated toolbox during the existing design request, not through additional paid image calls.

All 23 campaign deities have canonical composite emblems and favored-weapon motifs, reconciled with the supplied pantheon text. Mortacia's emblem is the winged White Lady, not a generic skull; Rama's is a flaming heart, not a generic sun. Alternate phoenix, unicorn and turtle emblems do not replace those gods' draconic bodies. Painted draconic effigies also vary build, horn, wing, tail and surface treatments; these are art-direction interpretations of the portfolios, not new campaign anatomy facts or live character changes. Silver and blue moon disks intentionally share geometry but use different pigments. Emblems appear in mural medallions, decorative reliefs, altar fronts and statue plinths. Puzzle-control marks and their verified diagrams retain the separate puzzle glyph library, so a similarly named decorative symbol cannot corrupt a clue.

Depicted figures and statues accept bounded race, className, patron and sex metadata. Nine core races and eleven starting classes mirror the game's existing tables. Thirteen additional creature races and eight lore occupations are available for underworld processions, guilds, shrines and histories. Class costumes and painted tools use the existing character assembler; race anatomy, dwarf/halfling/fey stature and elf proportions are preserved. A mortal knight of Atinus remains a knight, not a misidentified draconic god. Raakshasa anatomy is not defined by the campaign prompt, so the current humanoid interpretation is retained rather than importing a tiger-headed mythology. Patron defaults are iconographic composition choices, not gameplay allegiance. Canonical deity bodies cannot be overridden with mortal race/class metadata. Default paintings use local race/class references and patron-related figures when authored art omits them. No new religion, character stats, inventory item or encounter is created by a depiction.

Frescoes layer perspective architecture, grouped figures, planetary imagery and aged pigment. Their compositions include procession, apotheosis, judgment, lamentation, constellation and cosmogony. Painted pigments are independent of the masonry palette: vermilion, lapis, verdigris and ochre preserve contrast, with room lighting still applied in 3D. Missing authored subjects use the established patron and departed figures, not an arbitrary cartoon creature pair.

Up to six artworks plus one permanent mechanism diagram can be placed. Indoor buildings normally request four decorative pieces; palaces, basilicas and cathedrals request six. Frescoes span continuous wall sections, with 3:2 figure proportions and sizes up to 7.8 tiles wide by 5.2 high when clearance allows. Placement checks every wall segment, adjacent reachable floor and overhead clearance, leaves exits untouched, spreads murals among different wall faces, and shrinks to panels in cramped spaces. The clue diagram is placed first. No room geometry or loot is changed. Reliefs, inscriptions and floor mosaics share the glyph library. Art can be examined locally with a dismissible notice, from either end of a large mural. Surface geometry merges equal-color runs and caps raster dimensions at 144 by 96 in the renderer.

Altars have horned, stepped, draconic, canopied and carved-backplate forms. Canopies have structural supports. Zero to three candles are allowed per authored shrine; wax and flames have distinct geometry and nearby candlelight participates in the existing warm-light system. Altar puzzle kits use mounted offering tracks or incense controls; they do not yet consume inventory offerings.

Existing saved room layouts and puzzle states are not regenerated. Visual animation works with existing controls. New art assemblies and additional families require newly constructed rooms.

## Documents And Inscriptions

The unchanged ordinary loot pass generates 1-5 weapons, shields, armor or Other items. Up to four authored books, spellbooks, scrolls and maps are appended separately, not substituted for combat equipment. They retain ordinary equipped-item modifiers. Their backstories and up to three short chapters are persisted outside the flat object-property lines, with browser room data cached in IndexedDB. Taking a document does not erase its source text; carrying it permits reading it in another room. Existing documents without this metadata keep their original narrative path.

Up to four stone tablets, gravestones, chest tombs and sarcophagi can also carry authored inscriptions. These remain solid scenery, not backpack items. They have distinct voxel and map silhouettes, carved emblems, hover labels and click-to-read commands. Reading checks the living player, room, distance and intervening walls. Repeated reads return the same stored text with no model call. Only an explicitly bound clue document or inscription includes the actual verified mechanism diagram; a nearby permanent plaque keeps mandatory puzzles solvable even if a portable clue is left behind.

Spellbooks reserve bounded spell reference IDs for the future magic system. Reading does not consume an item, equip it, teach/cast spells, award XP or open a tomb. Observed document text enters the character memory ledger as attributed reading, not a newly adjudicated campaign event.

## Inspection And Limits

The isolated environment lab includes all seven families and a shrine-art gallery. It does not require paid model requests or modify an active campaign. The browser UI probe tests local art inspection, input locking, existing pickup/drag behavior and subtitles. The GPU probe checks artwork rendering, intermediate poses and buffer disposal. Unit tests traverse reachable wrong states and confirm an available solution.

Not implemented by this pass: unrestricted Sokoban, room-wide flooding, beam tracing, perspective-triggered solutions, inventory synthesis/forging, item exchanges or NPC-distraction puzzles. Those need dedicated state transitions and ownership checks before the model can offer them. No popup puzzle screens have been introduced.

## Artistic References

These inform composition and construction principles, not copied works or imported real-world gods:

- [V&A: Donatello](https://www.vam.ac.uk/articles/donatello-a-master-at-work), material and relief vocabulary.
- [V&A: Bernini](https://www.vam.ac.uk/articles/bernini-and-baroque), expressive gesture and drapery.
- [National Galleries: Contrapposto](https://www.nationalgalleries.org/art-and-artists/glossary-terms/contrapposto), counterposed weight.
- [Met: Boscoreale Frescoes](https://www.metmuseum.org/essays/boscoreale-frescoes-from-the-villa-of-p-fannius-synistor), painted architectural depth.
- [Berlin Museums: Pergamon Altar](https://www.smb.museum/en/museums-institutions/antikensammlung/about-us/whats-new/detail/3d-model-of-the-pergamon-altar/), integrated architecture and narrative relief.
- [Met: Roman Painting](https://www.metmuseum.org/essays/roman-painting), painted architecture and framed narrative scenes.
- [Met: Byzantine Icon](https://www.metmuseum.org/art/collection/search/466272), gold-ground framing and sacred figure hierarchy.
- [Met: The Hours of the Virgin](https://blog.metmuseum.org/artofillumination/2010/03/24/the-hours-of-the-virgin/), interlace, foliage and manuscript borders.
- [Met: Assyrian Relief Panel](https://www.metmuseum.org/art/collection/search/322613), processional imagery and winged guardians.
- [Met: Stela of Senu](https://www.metmuseum.org/art/collection/search/548593), standing, kneeling and ritual gestures.
