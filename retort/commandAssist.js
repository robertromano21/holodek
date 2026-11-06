'use strict';
// Structured UI-command classification for CommandAssist.
// Mirrors holodekAdjudication.gate / invitationHint: the model gleans intent; safe default is none.
const Models = require('./gameModels');
const Transport = require('./modelTransport');
const INTENTS = ['equip', 'unequip', 'cast', 'read', 'give', 'drop', 'drink', 'trade', 'none'];
const parameters = {
  intent: { type: String, enum: INTENTS, description: 'UI action intent, or none for story/adjudication commands.' },
  itemHint: { type: String, maxLength: 80, description: 'Optional item or spell name fragment from the command; empty if none.' },
  targetHint: { type: String, maxLength: 80, description: 'Optional character name from the command; empty if none.' },
  slotHint: { type: String, enum: ['armor', 'weapon', 'shield', 'other', 'book', 'scroll', 'any'], description: 'Optional slot or readable kind hint.' }
};
const SYSTEM = `You classify the player's latest short command for UI routing.
Return ONLY the structured JSON object.

intent meanings:
- equip: putting on / wearing / donning gear (armor, weapons, shields, other gear)
- unequip: taking gear off
- cast: casting spells or opening magic menus
- read: reading a book, scroll, tome, ledger, journal, or similar document
- give: handing an inventory item to someone
- drop: discarding inventory
- drink: drinking / quaffing a potion
- trade: shopping, buying, selling, trading
- none: searching, attacking, talking, traveling, puzzles, persuasion, stealth, or any story adjudication

Rules:
- Never invent item or character names that were not in the command; use empty strings when unknown.
- slotHint is armor/weapon/shield/other/book/scroll when the wording clearly points there, otherwise any.
- Prefer none when unsure.

Examples:
1) "put on armor" -> equip, slotHint=armor
2) "wear the leather jerkin" -> equip, itemHint=leather jerkin, slotHint=armor
3) "cast a spell" / "use magic" -> cast
4) "read book" -> read, slotHint=book
5) "read the pale chronicle" -> read, itemHint=pale chronicle, slotHint=book
6) "take off my shield" -> unequip, slotHint=shield
7) "drop something" -> drop
8) "drink" -> drink
9) "trade with the merchant" -> trade
10) "search the room" / "attack the goblin" / "say hello" / "north" -> none`;

function sanitize(value) {
  const intent = INTENTS.includes(value?.intent) ? value.intent : 'none';
  const itemHint = typeof value?.itemHint === 'string' ? value.itemHint.trim().slice(0, 80) : '';
  const targetHint = typeof value?.targetHint === 'string' ? value.targetHint.trim().slice(0, 80) : '';
  const slotHint = ['armor', 'weapon', 'shield', 'other', 'book', 'scroll', 'any'].includes(value?.slotHint) ? value.slotHint : 'any';
  return {
    intent,
    itemHint: intent === 'none' ? '' : itemHint,
    targetHint: intent === 'none' ? '' : targetHint,
    slotHint: intent === 'none' ? 'any' : slotHint
  };
}

async function classify(command) {
  const text = String(command || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!text) return sanitize({ intent: 'none' });
  const model = Models.snapshot().id;
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: 'Player input: ' + JSON.stringify(text) + '\nReturn ONLY the structured JSON object.' }
  ];
  let content = '';
  for await (const chunk of Transport.stream({
    model,
    temperature: 0,
    name: 'commandAssist',
    description: 'Classify a short player UI command.',
    parameters,
    strictAnswer: true
  }, messages, { timeoutMs: 12000 })) {
    if (chunk.contentDelta) content += chunk.contentDelta;
  }
  let parsed;
  try { parsed = JSON.parse(content); } catch { return sanitize({ intent: 'none' }); }
  return sanitize(parsed);
}

function install(app) {
  app.post('/command-assist/classify', async (req, res) => {
    try {
      const result = await classify(req.body?.command);
      res.json(result);
    } catch (error) {
      console.warn('[command-assist] classify failed:', error && error.message);
      res.json({ intent: 'none', itemHint: '', targetHint: '', slotHint: 'any' });
    }
  });
}

module.exports = { INTENTS, parameters, sanitize, classify, install, SYSTEM };
