'use strict';
const Puzzles = require('../assets/physicalPuzzles');
function designPrompt({ roomName, description, quest, task, seed, recentKinds = [] }) {
  return `Design ONE tangible adventure-game puzzle physically built in the 3D maze, in the tradition of Myst and Ultima Underworld. The player must understand what can be clicked and see each attempt change the apparatus. No popup menus. Data context: ${JSON.stringify({ roomName, description, quest, task, seed, recentKinds })}.
Choose kind sequence (press marked buttons in the procession shown on a plaque), alignment (rotate three-position dials to match an adjacent relief), or channels (toggle channel levers to match an engraved sluice diagram). Vary kind, symbols, function, and history; avoid recent kinds when appropriate. Use 2-4 individually named controls, all local and reachable. Build a plausible device made by the inhabitants for a purpose: surveying, irrigation, an archive, an observatory, a workshop, a temple instrument. The local instruction plaque and opening reading cabinet are automatically built too. No ash/ember/bone seals, poetry-as-password, abstract moral acts, invisible objects, guessing precise prose, remote NPC help, unavoidable traps, consumable costs, limited attempts, or random chance. Required quest mechanisms must always remain retryable. Never create, acquire or relocate a portable object, boss key, monster, campaign exit or bound quest target. The cabinet's revealed lore can point toward the EXISTING quest, but cannot declare its objectives complete.
Return only JSON metadata. Both description AND exact solution are compiled from this validated design, not invented in separate responses:
{"kind":"alignment","title":"room-specific title","context":"one short sentence about the apparatus and its local purpose, max 300 characters","controls":[{"id":"west","label":"West dial","mark":"Crown","options":["Sun","Moon","Wave"],"initial":0,"goal":1},{"id":"east","label":"East dial","mark":"Eye","options":["Sun","Moon","Wave"],"initial":0,"goal":2}],"order":[],"lore":"brief meaningful discovery when the cabinet opens, max 320 characters","exhaustionLimit":4}.
sequence: order must be a permutation of ALL control ids. channels: initial/goal are 0=closed,1=open, options are supplied by the engine. alignment: exactly three distinct concise dial-image options per control, valid initial/goal indexes 0-2. At least one control starts incorrectly set. IDs match [a-z][a-z0-9_]{0,23}. Labels unique max45 characters, plain words ending in button/dial/lever matching kind. Marks unique max28 characters. No coordinates: safe placement is engine-verified. Keep every clue visual/readable and action grammar literal.`;
}
async function generateDesign($, context) {
  $.model = 'gpt-4.1-mini'; $.temperature = .85;
  const prompt = designPrompt(context);
  let failure = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    await $.user`${prompt}${failure ? `\nThe previous design was rejected: ${failure}. Return a corrected complete design.` : ''}`;
    const response = await $.assistant.generation({ maxTokens: 1500 });
    try {
      const raw = String(response?.content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      const definition = Puzzles.compile(JSON.parse(raw));
      console.info('[PuzzleDesign]', JSON.stringify({ source: 'generated', id: definition.id, kind: definition.kind, controls: definition.controls.length }));
      return definition;
    } catch (error) { failure = error.message; }
  }
  const definition = Puzzles.fallback(context.seed, context.roomName);
  console.warn('[PuzzleDesign]', JSON.stringify({ source: 'validated-fallback', reason: failure, id: definition.id, kind: definition.kind }));
  return definition;
}
module.exports = { designPrompt, generateDesign };
