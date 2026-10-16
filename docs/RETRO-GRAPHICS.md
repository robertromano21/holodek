# Retro Graphics

Click **Menu > Retro Mode: OFF** to enable the Glazed look. Click again to turn
it off. Every page starts with Retro Mode off, regardless of any older stored
selection. Multicolor and Hi-Res are no longer selectable modes. No server
restart, model call, room regeneration or save migration is required.

## VIC-II Basis

The C64's graphics were more constrained than a low-resolution RGB image:

- Standard bitmap: 320 x 200 dots, two palette colors per 8 x 8 cell.
- Multicolor bitmap: 160 x 200 logical pixels, four colors per 4 x 8 logical
  cell (the area of an 8 x 8 hi-res cell). One color is the global background;
  the other three are selected independently for each cell.
- The screen has 40 x 25 color cells. Each bitmap occupies 8,000 bytes; screen
  RAM supplies color attributes, with color RAM adding the third local color
  in multicolor mode.
- Character modes reuse small character patterns and similar cell attributes.
  Hardware sprites are separate movable overlays; they do not require
  rebuilding a complete bitmap for every movement.

The original [Commodore Programmer's Reference Guide, bitmap introduction](https://www.devili.iki.fi/Computers/Commodore/C64/Programmers_Reference/Chapter_3/page_122.html),
[color attributes](https://www.devili.iki.fi/Computers/Commodore/C64/Programmers_Reference/Chapter_3/page_123.html),
[multicolor bitmap](https://www.devili.iki.fi/Computers/Commodore/C64/Programmers_Reference/Chapter_3/page_127.html)
and [sprite priorities](https://www.devili.iki.fi/Computers/Commodore/C64/Programmers_Reference/Chapter_3/page_144.html)
describe those distinctions. Our RGB values match VICE's bundled
`data/C64/colodore.vpl`. [Colodore](https://www.colodore.com/) explains why a
VIC-II palette is a reconstruction of analog output, not sixteen universal
digital RGB values.

## Implementation

`assets/retroGraphics.js` converts the completed world viewport to 160 x 200
logical pixels and the sixteen VIC-II colors. Reusable small buffers and a
lazy RGB lookup bound the work; Modern never allocates a converter or reads
back pixels. Glazed deliberately allows all sixteen colors within a cell;
it is not a simulation of the VIC-II's local color limits.

The process is grayscale value structure followed by material-specific color:
preserve shape, grooves and face contrast, then color in. Wall textures use
brown/orange with stable, texture-anchored stippling and inked joints. Pillars,
columns and pediments use light gray with darker grooves and face shadows.
Ceilings use yellow with orange/brown structural seams. Indoor floors keep
their existing gray treatment. Outdoor wastelands use a gray floor ramp plus
red flecks among existing dark/gray ground pixels and a solid yellow sky. The
flecks cluster loosely in world space, never replacing whole areas of texture;
forests and other biomes
are not indiscriminately painted as wastelands.

The art stack is **flats, existing shapes, details**. Walls and floors use cached,
low-resolution palette versions of their existing textures, mapped onto the
same perspective surfaces. WebGL and WebGPU keep the existing voxel meshes for
props, including arches, furniture, trees and architecture. There is no special
retro prop-billboard generator. Original carved capitals, fluting, bases,
scale, openings and depth passes remain intact. A black outline is drawn from
the same mesh using four screen-space offsets in one instanced draw, with
depth testing enabled and depth writes disabled, followed by the original
fill. It does not inflate collision meshes or flatten shapes into pictures.
The legacy Canvas fallback retains its existing sprite-based representation.
Missing wall/floor images get simple drawn masonry panels. Source images are
never rewritten.
Live puzzle controls and mesh inscriptions retain their detailed geometry so
an outdated static image cannot hide a changed control or erase a readable clue.

Retro Mode uses bright, steady lighting: no bloom, fog-like torch halos,
projected character shadows or time-varying torch flicker. Painted surfaces
carry their own shade bands; remaining voxel faces retain subtle static
directional contrast. Original world placement and collision geometry remain
unchanged. Loose loot keeps its existing artwork, bright gold/jewel pigments
and an inner black outline, with exact alpha coverage and floor anchoring.
Frescoes replay their saved designs with red, yellow, green and blue pigments;
their subjects, layout and poses stay the same. Puzzle clues are excluded.
The mode is a render-time policy, not a change to the room's stored lights.
Modern restores its existing lighting and effects when selected.

World characters keep their detailed existing world figures and their original
front/side/back construction, not the simpler combat-map sprite sheets. Only
RGB changes: alpha coverage, silhouette, bounds, body calibration, grounded feet,
walk timing and picking remain identical. Mortacia's skin/hair hue families map
to pink/yellow while neutral wings and metal remain gray. Separate map-sheet
color-role metadata gives her tokens those same colors without changing the
approved 2D artwork or its alpha/body metrics. Modern and retro textures have
distinct cache keys. Character coloring is the previous approved treatment,
without additional clothing pigments or a special spirit ramp. Spirits alone
get sparse, stable purple/cyan speckles over their existing colors, with the
same alpha, black outlines and bounds. No saved sprite,
trait spec or stature is overwritten.

The conversion runs immediately after each Canvas/WebGL/WebGPU presentation,
not on a timer or separate animation loop. WebGPU's completed presentation is
used instead of its pre-lighting WebGL source. This avoids delayed/stale copies
of GPU drawing buffers. A pointer-transparent overlay covers exactly the same
viewport, leaving the source canvas, camera projection, hit testing, drag/drop,
combat logic, movement timing and stored artwork untouched. Text and menus stay
unfiltered. The Canvas-rendered tactical map gets the same 16-color palette,
without downsampling, dithering or changing token size, rotation or picking.
Its floor cells are dark gray, grid lines light gray, and walls solid red;
torches, props and item sprites retain distinct palette colors. Its palette
pass runs on Phaser's existing postrender event; sleeping maps
stay asleep after the single redraw needed for a mode switch. Modern restores
the original colors from the untouched map textures.

The bitmap is stretched over the existing viewport, so the game retains its
current widescreen framing and input coordinates rather than enforcing a CRT's
4:3 aspect. Pixel proportions consequently depend on the player's viewport.
This is a VIC-II-inspired conversion with bitmap color restrictions, **not a
VICE graphics backend or a runnable C64 port**. It does not simulate raster
timing, sprite limits, memory banking, badlines or analog CRT artifacts.

If canvas copying is unavailable, the original scene remains visible, the menu
reports the error, and one warning is issued for that source. It does not retry
and flood the console on every movement frame. Reselect a mode to retry.

For diagnostics, `window.RetroGraphics.status()` reports mode, bitmap size,
frames, last conversion time, combat-map conversion time and any error. No
per-frame logging is enabled.

## Verification

`node --test tests/retro-graphics.test.cjs tests/retro-rendering.test.cjs tests/fresco-murals.test.cjs`
checks palette fidelity, deterministic output, unchanged input, reusable buffers,
the one-click toggle and off-on-load behavior even with old stored preferences,
paused redraw, source selection and bounded error reporting. It also checks
unchanged silhouettes of six detailed world character types, body calibration,
stable torch guides, bright rendering uniforms and restoration of Modern
WebGPU settings without changing scene data. Asset checks cover transparent
cutouts, black contours, original mesh retention, cache invalidation,
palette art preservation, Mortacia skin/hair colors, actual map redraw styles,
and unchanged combat-map dimensions/alpha apart from color.

`node tests/run-retro-graphics-probe.cjs` runs an isolated browser profile against
a temporary local fixture server, never the live adventure. It checks actual
Canvas, WebGL and (when an adapter exists) WebGPU frame copying, orientation,
discarded GPU buffers, every animation frame, unchanged mouse targets, mobile
bounds and mode/viewport switching. It also runs an actual Phaser Canvas map
through the postrender hook and verifies original colors return in Modern.
A small production-renderer fixture checks original pillar meshes, a ceiling,
a detailed world character, a non-column prop, depth-tested outlines, steady
output and restoration of lighting uniforms. An outdoor fixture checks the
solid yellow sky and red/gray ground without changing saved biome data.
It verifies the same pillar mesh object survives a mode change, and its Phaser
map checks pink/yellow Mortacia colors as well as gray grid and red walls.
With SwiftShader, production shaders compile unchanged first, then the fixture
specializes only the world light accumulator to the zero-light return already
used by retro mode, avoiding the software driver's shadow-loop JIT stall.
That fixture does not assess Modern shadow appearance; the existing GPU
regression probe tests that separately. The comparison gallery uses an existing
room-art replay image if present; otherwise it uses a synthetic scene. It is not
an end-to-end campaign replay. Reports and images go to ignored `logs/probes/`.

The initial browser checks passed with a real WebGPU context as well as the
software WebGL path. Recent software runs averaged roughly 0.5-1.5 ms for the world
palette pass and about 10 ms for the first full 775 x 775 tactical-map pass.
These are local fixture timings, not a guarantee for other hardware or a
measurement of the full world's render time. Some runs have no WebGPU adapter;
the report explicitly distinguishes a skipped adapter from a tested one.
