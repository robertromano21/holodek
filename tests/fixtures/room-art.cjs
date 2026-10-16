'use strict';
const layer = (kind, x, y, w, h, color = 15, shade = 11, detail = 1, count = 4, pattern = 'plain') =>
  ({ kind, x, y, w, h, color, shade, detail, count, pattern });
function temple() {
  return { view: 'interior', horizon: 125, vanishing: 165, sky: 0, ground: 12, shadow: 11, stone: 15, accent: 2, light: 7, groundPattern: 'tiles', layers: [
    layer('wall', 35, 12, 250, 116, 9, 11, 8, 4, 'stone'), layer('door', 144, 43, 44, 81, 15, 11, 7),
    layer('fresco', 71, 35, 54, 35, 2, 9, 7, 3), layer('fresco', 203, 35, 45, 35, 6, 11, 3, 3),
    layer('portico', 50, 7, 226, 126, 15, 12, 1, 6), layer('mosaic', 123, 144, 82, 25, 6, 0, 7, 5),
    layer('brazier', 80, 95, 12, 31, 8, 11, 7), layer('brazier', 229, 95, 12, 31, 8, 11, 7),
    layer('pillar', 6, -10, 25, 179), layer('pillar', 292, -10, 25, 179), layer('rubble', 23, 161, 56, 28, 12, 11, 15, 4),
  ] };
}
function spring() {
  return { view: 'landscape', horizon: 100, vanishing: 155, sky: 7, ground: 11, shadow: 0, stone: 12, accent: 5, light: 13, groundPattern: 'stipple', layers: [
    layer('ridge', 0, 57, 320, 54, 9, 11, 8, 7), layer('ridge', -20, 85, 150, 40, 11, 0, 12, 5),
    layer('portico', 196, 65, 93, 65, 15, 12, 1, 5), layer('stairs', 190, 126, 104, 12, 12, 11, 15, 4),
    layer('pool', 64, 123, 141, 44, 3, 6, 13, 5), layer('grass', 54, 149, 167, 29, 5, 11, 13, 10),
    layer('tree', 12, 50, 64, 125, 11, 9, 8, 4), layer('rubble', 219, 165, 90, 30, 12, 11, 2, 6),
    layer('grass', 92, 113, 90, 13, 5, 0, 13, 5),
  ] };
}
function alien() {
  return { view: 'cavern', horizon: 108, vanishing: 180, sky: 6, ground: 14, shadow: 0, stone: 4, accent: 3, light: 1, groundPattern: 'cracked', layers: [
    layer('ridge', -20, 20, 350, 100, 4, 6, 14, 8), layer('stalactite', 0, -3, 320, 50, 0, 6, 4, 8),
    layer('crystal', 65, 49, 45, 76, 3, 6, 1, 4), layer('crystal', 240, 45, 71, 102, 14, 4, 3, 6),
    layer('arch', 128, 38, 65, 96, 4, 6, 10), layer('river', 92, 108, 130, 91, 6, 0, 3),
    layer('bridge', 56, 140, 199, 28, 4, 6, 14, 3, 'stone'), layer('crystal', -8, 111, 48, 91, 3, 6, 1, 3),
    layer('crystal', 262, 156, 51, 45, 10, 4, 1, 3),
  ] };
}
function vista() {
  const ochre = '#c46c23', dark = '#162f36', gold = '#f3b342', light = '#fff3a0';
  return { view: 'landscape', horizon: 111, vanishing: 167, sky: '#163f4d', ground: '#b77732', shadow: '#322d32', stone: '#a58b62', accent: gold, light, groundPattern: 'sand', layers: [
    layer('sun', 108, -7, 128, 125, '#fff294', '#e3ac4e', light),
    layer('cloud', -15, 19, 124, 43, '#efb752', ochre, light, 6),
    layer('cloud', 234, 15, 105, 41, '#efb752', ochre, light, 5),
    layer('mountain', -9, 52, 125, 69, '#547a6c', dark, '#c4ddb0', 3),
    layer('mountain', 228, 59, 95, 62, '#547a6c', dark, '#c4ddb0', 3),
    layer('dunes', 0, 112, 320, 85, '#de9d3e', '#9e5528', '#fff1a5', 6),
    layer('citadel', 119, 59, 91, 73, '#756a4b', '#142a30', '#e2c579', 5),
    layer('stairs', 136, 130, 60, 15, '#736646', '#23363a', '#f4d483', 8),
    layer('road', 81, 141, 170, 59, '#e1b865', '#9c623d', '#fff0a1', 6),
    layer('pillar', 56, 124, 9, 38, '#b59358', dark, light),
    layer('pillar', 239, 130, 8, 33, '#b59358', dark, light),
    layer('rubble', 0, 176, 68, 24, '#806342', '#192d34', '#d6ab63', 4),
    layer('rubble', 261, 168, 59, 32, '#806342', '#192d34', '#d6ab63', 5),
  ] };
}
module.exports = { layer, temple, spring, alien, vista };
