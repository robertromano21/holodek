'use strict';
const assert = require('node:assert/strict');
function slotIds(request) {
  const slot = request.parameters?.inhabitants?.type?.[0]?.type?.slot ||
    request.tools?.[0]?.function?.parameters?.properties?.inhabitants?.items?.properties?.slot;
  assert.ok(slot, 'The fake inhabitant model needs the requested slot schema.');
  const ids = slot.enum || Array.from({ length: slot.maximum - slot.minimum + 1 }, (_, index) => slot.minimum + index);
  assert.ok(ids.length && ids.every(id => Number.isInteger(id) && id >= (slot.minimum ?? 0) && id <= (slot.maximum ?? Infinity)));
  assert.equal(new Set(ids).size, ids.length);
  return ids;
}
function batchRows(rows, request) {
  // Select by original position so negative tests keep corrupt row.slot values and duplicate identities.
  return slotIds(request).map(id => rows[id]).filter(row => row !== undefined);
}
module.exports = { slotIds, batchRows };
