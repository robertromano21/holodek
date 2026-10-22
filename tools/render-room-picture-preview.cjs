// world1 room pictures: BEFORE (original painter, original kinds) vs AFTER (catalog kinds + lighting + crisp dithered pixel finish).
'use strict';
const { createCanvas } = require('canvas');
const fs = require('node:fs'), path = require('node:path');
const out = process.argv[2] || path.join(__dirname, '..', 'room-picture-preview');
const before = require(process.argv[3] || '/tmp/roomIllustration.orig.js'), after = require('../assets/roomIllustration');
fs.mkdirSync(out, { recursive: true });
const L = (kind, x, y, w, h, color, shade, detail, count = 3, pattern = 'stone') => ({ kind, x, y, w, h, color, shade, detail, count, pattern });
const rooms = {
  'Ruined Temple Entrance': {
    before: { view: 'interior', horizon: 120, vanishing: 160, sky: '#2a2420', ground: '#6a5a44', shadow: '#1a1410', stone: '#8a7a60', accent: '#c9a050', light: '#e8d8a0', groundPattern: 'tiles',
      layers: [L('wall', 0, 10, 320, 120, '#8a7a60', '#5a4a38', '#b8a888'), L('portico', 90, 30, 140, 95, '#b8a888', '#6a5a44', '#e8d8a0', 4), L('pillar', 20, 20, 24, 110, '#a89878', '#5a4a38', '#d8c8a0'),
        L('pillar', 276, 20, 24, 110, '#a89878', '#5a4a38', '#d8c8a0'), L('stairs', 110, 125, 100, 30, '#8a7a60', '#5a4a38', '#c8b890', 4), L('rubble', 30, 150, 80, 30, '#7a6a50', '#4a3a28', '#a89878', 4)] },
    after: { view: 'interior', horizon: 118, vanishing: 160, sky: '#241c18', ground: '#6a5a44', shadow: '#140e0a', stone: '#9a8868', accent: '#d8a850', light: '#f0e0a8', groundPattern: 'tiles',
      palette: 'marble_dawn', lighting: 'shaft_from_above', composition: 'symmetrical_nave', motif: 'meander_field',
      layers: [L('coffered_ceiling', 0, 0, 320, 34, '#a89878', '#5a4a38', '#e8d8a0', 6), L('wall', 0, 34, 320, 92, '#8a7a60', '#5a4a38', '#b8a888'), L('cornice_band', 0, 34, 320, 10, '#5a4a38', '#a89878', '#f0e0a8'),
        L('tracery_window', 136, 40, 48, 60, '#b8a888', '#5a4a38', '#f0e0a8'), L('colonnade', 40, 46, 240, 80, '#b8a888', '#6a5a44', '#e8d8a0', 5), L('dado_band', 0, 100, 320, 12, '#5a4a38', '#a89878', '#e8d8a0'),
        L('light_rays', 120, 0, 90, 140, '#f0e0a8', '#d8c890', '#fff0c0', 3), L('altar', 130, 108, 60, 26, '#a89878', '#5a4a38', '#e8d8a0'), L('stairs', 110, 130, 100, 26, '#8a7a60', '#5a4a38', '#c8b890', 4),
        L('banner', 70, 50, 18, 50, '#8a2e3a', '#4a1a20', '#e5c060'), L('banner', 232, 50, 18, 50, '#8a2e3a', '#4a1a20', '#e5c060'), L('pillar', 6, 10, 26, 150, '#a89878', '#5a4a38', '#d8c8a0'),
        L('pillar', 288, 10, 26, 150, '#a89878', '#5a4a38', '#d8c8a0'), L('rubble', 30, 160, 80, 30, '#7a6a50', '#4a3a28', '#a89878', 4), L('bones', 220, 168, 60, 20, '#d8d0b8', '#8a8070', '#f0e8d0', 3)] } },
  'Tartarus Wasteland': {
    before: { view: 'landscape', horizon: 110, vanishing: 160, sky: '#e8c040', ground: '#c89a50', shadow: '#5a3a1a', stone: '#a87a40', accent: '#e8d070', light: '#fff0a0', groundPattern: 'sand',
      layers: [L('sun', 240, 20, 30, 30, '#fff0a0', '#e8c040', '#ffffff'), L('mountain', 0, 50, 320, 60, '#a87a40', '#6a4a20', '#d8b070', 5), L('dunes', 0, 100, 320, 40, '#c89a50', '#8a6a30', '#e8c080', 4),
        L('obelisk', 200, 60, 20, 60, '#a87a40', '#5a3a1a', '#e8c080'), L('rubble', 40, 140, 100, 30, '#a87a40', '#5a3a1a', '#d8b070', 5), L('mist', 0, 90, 320, 20, '#f0d890', '#e8c070', '#fff0b0', 4)] },
    after: { view: 'landscape', horizon: 112, vanishing: 160, sky: '#f2d34a', ground: '#d8a63a', shadow: '#3f2a16', stone: '#9b6a2a', accent: '#7a3d22', light: '#ffef9a', groundPattern: 'sand',
      palette: 'tartarus_noon', lighting: 'sandstorm_haze', composition: 'low_angle_monument', motif: 'step_fret',
      layers: [L('sun', 250, 14, 26, 26, '#ffef9a', '#f2d34a', '#ffffff'), L('mountain', 0, 40, 320, 72, '#9b6a2a', '#6a4418', '#d8a63a', 6), L('pyramid_smooth', 20, 62, 90, 50, '#c8964a', '#7a5228', '#ffe0a0'),
        L('pyramid_stepped', 130, 36, 150, 78, '#c8964a', '#7a5228', '#ffe0a0', 5), L('dunes', 0, 104, 320, 40, '#d8a63a', '#8a6a30', '#f0c880', 4), L('sphinx_like', 40, 110, 70, 40, '#b8864a', '#6a4418', '#ffe0a0'),
        L('dragon_skull', 220, 140, 70, 34, '#e8dcc0', '#8a7a60', '#fff4dc'), L('bones', 150, 160, 70, 20, '#e8dcc0', '#8a7a60', '#fff4dc', 4), L('palm', 290, 100, 26, 60, '#3f6a2e', '#5a3a1a', '#8ab060', 3),
        L('sandstorm', 0, 80, 320, 70, '#f0d890', '#d8b060', '#fff0b0', 3), L('rubble', 10, 165, 120, 30, '#9b6a2a', '#3f2a16', '#d8a63a', 5), L('campfire', 120, 150, 24, 20, '#ff9a30', '#5a3a1a', '#ffe070', 3)] } },
  'Ossuary Crypt': {
    before: { view: 'interior', horizon: 125, vanishing: 160, sky: '#1a1410', ground: '#4a3a28', shadow: '#0a0806', stone: '#6a5a44', accent: '#c8a050', light: '#e8c070', groundPattern: 'cracked',
      layers: [L('wall', 0, 0, 320, 130, '#5a4a38', '#3a2a1a', '#8a7a60'), L('arch', 110, 30, 100, 100, '#7a6a50', '#3a2a1a', '#a89878'), L('grave', 40, 100, 40, 40, '#7a6a50', '#3a2a1a', '#a89878'),
        L('grave', 240, 100, 40, 40, '#7a6a50', '#3a2a1a', '#a89878'), L('brazier', 140, 120, 40, 40, '#ff9a30', '#5a3a1a', '#ffe070'), L('rubble', 0, 160, 320, 30, '#5a4a38', '#2a1a10', '#8a7a60', 4)] },
    after: { view: 'interior', horizon: 125, vanishing: 160, sky: '#140e0a', ground: '#4b3219', shadow: '#0a0604', stone: '#8b6331', accent: '#5c7a52', light: '#e0c37a', groundPattern: 'cracked',
      palette: 'tomb_ochre', lighting: 'candle_pools', composition: 'corridor_depth', motif: 'bone_ossuary_grid',
      layers: [L('vault', 0, 0, 320, 40, '#6a4a28', '#3a2410', '#c79a52'), L('wall', 0, 40, 320, 90, '#5a4428', '#3a2a1a', '#8b6331'), L('frieze_band', 0, 44, 320, 14, '#3a2410', '#8b6331', '#e0c37a'),
        L('arch', 120, 46, 80, 84, '#8b6331', '#3a2410', '#c79a52'), L('bookshelf', 20, 60, 50, 70, '#6a2a2a', '#3a2410', '#e0c37a', 4), L('sarcophagus', 120, 110, 80, 34, '#a07a40', '#4b3219', '#e0c37a'),
        L('lantern', 90, 70, 8, 14, '#e0c37a', '#3a2410', '#fff0b0'), L('lantern', 222, 70, 8, 14, '#e0c37a', '#3a2410', '#fff0b0'), L('dado_band', 0, 116, 320, 10, '#3a2410', '#8b6331', '#e0c37a'),
        L('bones', 230, 140, 80, 30, '#e8dcc0', '#8a7a60', '#fff4dc', 5), L('dragon_skull', 250, 100, 50, 30, '#e8dcc0', '#8a7a60', '#fff4dc'), L('rubble', 0, 165, 140, 30, '#5a4a38', '#2a1a10', '#8b6331', 4)] } },
  'Harbor Market Street': {
    before: { view: 'courtyard', horizon: 110, vanishing: 160, sky: '#7ab0d8', ground: '#a87a50', shadow: '#3a2a1a', stone: '#c8a070', accent: '#c04a2a', light: '#fff0c0', groundPattern: 'stone',
      layers: [L('building', 0, 30, 110, 90, '#c8a070', '#8a6a40', '#f0d8a8', 3), L('building', 210, 20, 110, 100, '#c8a070', '#8a6a40', '#f0d8a8', 3), L('tower', 140, 10, 40, 100, '#b8905a', '#7a5a30', '#e8c890', 3),
        L('road', 100, 110, 120, 90, '#a87a50', '#6a4a28', '#d8b080'), L('tree', 110, 60, 30, 60, '#3a7a3a', '#2a4a2a', '#8ab060', 3), L('pool', 140, 150, 60, 20, '#3a7aa0', '#2a4a6a', '#a0d0f0')] },
    after: { view: 'courtyard', horizon: 108, vanishing: 160, sky: '#7ab0d8', ground: '#a3703e', shadow: '#3b2617', stone: '#d9a86a', accent: '#c04a2a', light: '#fff0c0', groundPattern: 'stone',
      palette: 'sandstone_market', lighting: 'golden_hour', composition: 'diagonal_recession', motif: 'tracery_field',
      layers: [L('cloud', 20, 10, 120, 20, '#e8f0f8', '#b8c8d8', '#ffffff', 3), L('aqueduct', 0, 40, 320, 40, '#d9a86a', '#8a6a40', '#f0d8a8', 6), L('tiered_roof', 120, 20, 80, 90, '#a83a22', '#5e1c10', '#e8823a', 3),
        L('building', 0, 50, 110, 80, '#d9a86a', '#8a6a40', '#f0d8a8', 3), L('building', 210, 40, 110, 90, '#d9a86a', '#8a6a40', '#f0d8a8', 3), L('frieze_band', 0, 100, 110, 8, '#8a6a40', '#d9a86a', '#fff0c0'),
        L('canopy', 30, 110, 60, 40, '#c04a2a', '#7a2a1a', '#f0a070'), L('canopy', 230, 110, 60, 40, '#3a7aa0', '#1a4a6a', '#90c0e0'), L('fountain', 135, 120, 50, 44, '#d9a86a', '#8a6a40', '#a0d0f0'),
        L('lantern', 104, 96, 6, 12, '#fff0c0', '#3b2617', '#ffe090'), L('banner', 200, 60, 14, 40, '#2a6a6a', '#1a3a3a', '#e8c070'), L('balustrade', 0, 150, 120, 16, '#d9a86a', '#8a6a40', '#f0d8a8'),
        L('waterfall', 290, 120, 20, 50, '#3a7aa0', '#1a4a6a', '#a0d0f0'), L('cypress', 112, 70, 14, 50, '#2a5a2e', '#1a3a1e', '#5a8a4e'), L('road', 110, 165, 100, 35, '#a3703e', '#6a4a28', '#d8b080')] } }
};
const W = 320, H = 200, S = 2, c = createCanvas(2 * W * S + 48, Object.keys(rooms).length * (H * S + 34) + 30), ctx = c.getContext('2d');
ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#100c0a'; ctx.fillRect(0, 0, c.width, c.height);
ctx.fillStyle = '#e8dcc0'; ctx.font = '13px monospace'; ctx.fillText('BEFORE (original painter)                                            AFTER (catalog + lighting + 160x100 ordered-dither, nearest x2)', 16, 20);
Object.entries(rooms).forEach(([name, r], i) => {
  const y = 30 + i * (H * S + 34);
  for (const [k, painter, plan] of [[0, before, r.before], [1, after, r.after]]) {
    const pic = createCanvas(W, H), g = pic.getContext('2d'); painter.paint(g, plan, name);
    fs.writeFileSync(path.join(out, `${name.toLowerCase().replace(/\W+/g, '-')}-${k ? 'after' : 'before'}.png`), pic.toBuffer());
    ctx.drawImage(pic, 16 + k * (W * S + 16), y, W * S, H * S);
  }
  ctx.fillStyle = '#e8dcc0'; ctx.fillText(name, 16, y + H * S + 18);
});
fs.writeFileSync(path.join(out, 'room-pictures-before-after.png'), c.toBuffer());
