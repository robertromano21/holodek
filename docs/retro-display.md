# Retro dungeon display: cc110

The enhanced Retro display uses 640x400 logical pixels and 32 simultaneous colors, presented with crisp nearest-neighbor pixels at a 4:3 RGB-monitor aspect ratio. The original sixteen Colodore VIC-II colors remain, supplemented by sixteen charcoal, neutral, amber, cream, brown, blue, green and teal shades. These intermediate shades preserve illuminated ridges and shadowed grooves. The final frame is globally palette-limited, without the stock VIC-II two-color-per-cell constraint.

cc110 is a fictional circa-1992 C64 graphics expansion design, not a historical product or a stock C64 mode. A proposed physical card would have 512 KiB of dedicated video RAM, five bitplanes (160,000 bytes per 640x400 frame), double buffering, a 2D blitter and a separate RGB video output. A suitable monitor would be required; a standard composite connection would not deliver this resolution faithfully. This does not imply that a C64 CPU could run Holodek's modern 3D renderer.

## Driver and register compatibility

TGI is a software graphics interface, not a register set. A hypothetical driver would expose the existing TGI calls while reporting 640x400 pixels and 32 colors. The stock c64-hi.tgi driver cannot gain these abilities merely by accepting larger numbers; an expansion-card-specific driver is needed. Keep VIC-II register meanings and the original sixteen palette indexes intact. Expansion resolution, framebuffer pages and the additional palette entries belong in separate extension registers rather than overloading the original VIC-II bitfields. No physical register addresses or binary driver compatibility are implemented by this browser renderer. It implements the visual display target, not a CPU/bus-level emulator. cc65 TGI documentation: https://cc65.github.io/doc/tgi.html

## Light and geometry

All voxel materials use the existing Modern lighting path, including torch accumulation, material ramps and cast-shadow checks. Retro traces that completed color, emphasizing existing dark transitions and bright ridge pixels rather than inventing scratches or separate illumination. Torch brightness and radius stay steady. A tiny tangential source movement of at most 1/64 world unit changes in discrete 240 ms steps; halo rings use palette colors and sparse pixel stippling while retaining depth and wall occlusion. Modern mode retains its existing shader behavior.

The original geometry, collision and assets are retained. Browser menus, text and maps remain separate accessible UI. Legacy multicolor and hires conversion/export helpers remain available for archival compatibility. RetroGraphics.exportHires() explicitly downsamples the enhanced frame to 320x200 and the original sixteen colors, then applies stock two-color-per-8x8-cell constraints. That PRG is a lossy still-image conversion, not an Aurora framebuffer or an executable viewer.

The exploration map retains zoom, Whole Level, Follow, dragging and discovered-item markers. Hidden items remain hidden.

## Graphics settings

The gold-and-black monitor button between Auto Take and Help opens Graphics Settings. Retro resolution and palette are independent: cc65 (320×200), cc110 (640×400), cc220 (1280×800), each with 16, 32 or 64 colors. Original sixteen VIC-II colors retain their indexes; added palettes are nested and supply neutral, warm and cool gradations. All combinations use crisp nearest-neighbor display pixels, trace existing geometry/light/shadow and retain restrained stepped torch movement. These are C64-inspired expansion targets, not stock VIC-II hardware or per-character color-cell emulation. The archival hires export still explicitly downconverts to legal stock 320×200 two-color cells.

Classic Modern remains the original default at 160×120 internal pixels, with no color filter. Optional Engraved Stone, Moonlit Silver and Amber Lantern presets combine increased sampling, existing architectural relief and color grading. Pixel sharpness changes internal drawing resolution from 160×120 to 640×480; architectural relief adjusts existing carving-field depth; contrast and richness grade the supplied light and materials. Modern presets do not invent new lights, alter game state or rewrite source assets. Classic restores the original unfiltered sampling and the relief setting present when the page loaded. Modern additions reset to Classic on page load; Retro palette/size preferences are remembered. Larger frames cost more GPU and conversion time.

## Shared scene lighting and vivid sprites

Retro walls, floor and voxel surfaces trace the finished Modern lighting, including local illumination and shadow occlusion. Dark tones widen into restrained blue/violet shadow inks and black creases taken from actual gradients; bright edges retain their highlights. Source artwork pigments and the dedicated art-sconce lighting remain intact until final display palette conversion. Characters and pickup billboards retain unlit vibrant sprite colors in Retro while retaining alpha testing and depth occlusion. Classic Modern is unchanged.

Retro now defaults to 32 colors at 320×200. This release adopts that preset once for existing browser preferences; subsequent explicit choices remain saved independently. Modern remains the starting mode.

Retro wall frescoes now share the same authored Retro pigments as their artwork popup. Dedicated artwork light changes brightness with a neutral, bounded 65–105% ramp, preserving hue instead of adding amber pigment. World floors, walls, characters, and Classic Modern keep their existing paths.

The final Retro ink pass reserves solid black for the deepest existing shadows and dark real surface creases, with a stronger intermediate edge ink. It introduces no random scratch texture and leaves artwork-specific pigment lighting and bright highlights separate.

## Independent Modern resolution

Original leaves the renderer at the native resolution it initialized with (currently 160×120). Fine, Extra Fine and Maximum multiply that native resolution by 2, 3 and 4. Choosing a look preserves the selected Modern resolution; Retro palette and size never select Modern resolution. Reset to Classic restores the unfiltered original look, original relief and native resolution. Settings start at Classic/Original on page load. These optional detail levels cost progressively more GPU work.
