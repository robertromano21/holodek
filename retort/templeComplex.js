'use strict';
// world1 TEMPLE_COMPLEX: the Ruined Temple Entrance (0,0,0) opens onto a vast complex. Only rooms whose
// classification carries world1Temple (set when a NEW game creates its start room) are affected.
const Flags = require('./worldFlags');
const MIN_GRID = 144;
// Fractions of the grid; the player starts near the south edge, so the complex unfolds northward behind the entrance.
const SECTIONS = [
  { x: .40, y: .74, w: .20, h: .18, role: 'entrance', shape: 'hall' },
  { x: .38, y: .40, w: .24, h: .32, role: 'hall', shape: 'hall', columnOrder: 'corinthian' },
  { x: .10, y: .46, w: .20, h: .18, role: 'chapel', shape: 'hall' },
  { x: .70, y: .46, w: .20, h: .18, role: 'chamber', shape: 'hall' },
  { x: .40, y: .08, w: .20, h: .20, role: 'sanctum', shape: 'round' },
  { x: .10, y: .12, w: .18, h: .20, role: 'gallery', shape: 'hall' },
  { x: .72, y: .12, w: .18, h: .20, role: 'crypt', shape: 'hall' },
  { x: .12, y: .74, w: .18, h: .16, role: 'shrine', shape: 'round' },
  { x: .70, y: .74, w: .18, h: .16, role: 'courtyard', shape: 'hall' }
];
function marked(classification) { return !!(classification?.world1Temple || classification?.templeComplex); }
function mark(classification) { if (Flags.on('TEMPLE_COMPLEX') && classification) classification.world1Temple = true; return classification; }
function gridSize(classification, size) { return marked(classification) ? Math.max(size, MIN_GRID) : size; }
// Add missing halls, sanctums and side chambers behind the entrance; keep the model's own rooms first.
function augment(plan, classification) {
  if (!marked(classification)) return plan;
  const own = Array.isArray(plan?.rooms) ? plan.rooms.slice(0, 16) : [];
  const have = new Set(own.map(r => r?.role));
  const extra = SECTIONS.filter(s => !have.has(s.role) || s.role === 'chamber').slice(0, Math.max(0, 16 - own.length));
  return { ...(plan || {}), rooms: [...own, ...extra], templeComplex: true };
}
module.exports = { SECTIONS, MIN_GRID, marked, mark, gridSize, augment };
