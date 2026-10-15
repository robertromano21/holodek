'use strict';
const Icons = require('../assets/shrineIconography');
const Sculpture = require('../assets/sculptureForms');

function prepare(spec) {
  const floor = spec.worldContext?.fortifiedFloor;
  if (floor?.version !== 1) return;
  spec.architecture = floor.patron ? 'temple' : 'castle';
  spec.landmarks ||= [];
  if (!floor.patron) return;
  const deity = Icons.name(floor.patron), canon = Icons.pantheon[deity];
  if (!canon || spec.landmarks.some(l => l.fromTempleSite)) return;
  for (const [type, count] of [['patron_standard', 2], ['patron_relief', 1]]) spec.landmarks.push({
    type, label: `${deity} ${type === 'patron_standard' ? 'sacred standard' : 'sacred relief'}`, count, placement: 'walls',
    condition: [], fromTempleSite: true, shrine: { deity }, inscription: { motif: deity }
  });
  spec.landmarks.push({ type: 'statue', label: `${deity} temple effigy`, count: 1, placement: 'far_end', condition: [],
    fromTempleSite: true, sculpture: Sculpture.visualSpec({ label: `${deity} effigy`, deity, form: canon.form, workmanship: 'carved' }) });
  spec.landmarks.push({ type: 'altar', label: `${deity} sanctuary altar`, count: 1, placement: 'far_end',
    condition: [], fromTempleSite: true, shrine: { deity }, inscription: { motif: deity } });
}

// Complete the physical underside of an upper storey without moving the floor below.
function cover(dungeon, spec) {
  const floor = spec.worldContext?.fortifiedFloor;
  if (floor?.version !== 1 || !floor.stairs?.includes('up') || dungeon.fortifiedCeiling) return;
  const { width, height } = dungeon.layout;
  const shape = floor.patron ? 'coffered_slab' : 'boarded_ceiling', material = floor.patron ? 'stone' : 'wood';
  const tile = `custom_storey_underside_${shape}`;
  dungeon.tiles[tile] = { url: dungeon.tiles.ceiling?.url || dungeon.tiles.wall?.url,
    spriteSpec: { voxelShape: shape, material, profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
  let ceiling = 5;
  for (const c of Object.values(dungeon.cells)) ceiling = Math.max(ceiling, c.ceilHeight || 0, c.roof?.height || 0);
  let covered = 0;
  for (const c of Object.values(dungeon.cells)) if (c.tile === 'floor' && !c.roof) {
    c.roof = { style: floor.patron ? 'coffered' : 'boarded', height: ceiling, slopeX: 0, slopeY: 0, material, zone: 'upper-storey-floor' }; covered++;
  }
  dungeon.sceneStructures ||= [];
  if (covered) for (let y = 0; y < height; y += 32) for (let x = 0; x < width; x += 32)
    dungeon.sceneStructures.push({ tile, shape, role: 'upper-storey-floor', position: { x, y, z: ceiling },
      size: { x: Math.min(32, width - x), y: Math.min(32, height - y), z: .35 } });
  dungeon.fortifiedCeiling = { version: 1, covered, represents: 'underside-of-next-world-z-storey' };
}
module.exports = { prepare, cover };
