const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheets, partyRoster } = require('../assets/partyRoster');
const sheet = (name, hp = 5) => `${name}\nFemale\nWraith\nMage\nLevel: 2\nAC: 12\nXP: 0\nHP: ${hp}\nMaxHP: 8\nEquipped: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 3`;

test('recruited monster uses party membership, retains sprite, preserves zero HP', () => {
  const sprite = { dataUrl: 'data:recruited-monster' };
  const roster = partyRoster(sheet('PC'), sheet('Wraith', 0), [{ name: 'Wraith', type: 'monster', sprite, mazeX: 4 }]);
  assert.equal(roster[1].type, 'npc');
  assert.equal(roster[1].sprite, sprite);
  assert.equal(roster[1].hp, 0);
  assert.equal(roster[1].mazeX, 4);
});
test('blank lines, labels, variable sheet length and more than six allies do not truncate the dock', () => {
  const npcText = Array.from({ length: 9 }, (_, i) => sheet(`Name: Ally ${i}`).replace('Attack:', 'Trait: Vigilant\nAttack:')).join('\n\n');
  assert.equal(parseSheets(npcText, 'npc').length, 9);
  assert.equal(partyRoster(sheet('PC'), npcText).length, 10);
  assert.equal(partyRoster(sheet('PC'), 'None', [{ name: 'Old Ally', type: 'npc' }]).length, 1);
});
