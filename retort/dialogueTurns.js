'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const Audience = require('../assets/dialogueAudience');
const I = require('../assets/dungeonInhabitants');
const turns = new AsyncLocalStorage();
let getPolicy = () => null;

function run(input, callback) { return turns.run({ input: String(input || ''), prompted: false }, callback); }
function policyFor(state) {
  const turn = turns.getStore();
  if (!turn) return null;
  let roster = [];
  try { roster = JSON.parse(state.getCombatCharactersString?.() || '[]'); } catch {}
  if (!Array.isArray(roster)) roster = [];
  const text = state.getUpdatedGameConsole?.() || '';
  if (!roster.length) roster = [...I.parseSheets(text, 'NPCs in Party'), ...I.parseSheets(text)];
  const geo = I.roomKey(text.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
  const coords = geo && Object.fromEntries(geo.split(',').map((n, i) => [['x', 'y', 'z'][i], Number(n)]));
  const dungeon = coords && state.getRoomDungeonForSimulation?.(coords), population = geo && state.getRoomPopulation?.(geo);
  const audible = dungeon ? I.perceive(dungeon, roster, population).conversational.filter(a => I.hasEncountered(a, population)).map(a => a.name) : roster.map(a => a.name);
  return Audience.resolve(turn.input, roster, audible);
}
function focus(population, policy, dialogue) {
  if (!population || !policy) return;
  if (!policy.directed) { delete population.dialogueFocus; return; }
  const duration = dialogue.flatMap(row => I.splitSpeech(row.line)).reduce((sum, line) =>
    sum + Math.min(18000, Math.max(3500, line.trim().split(/\s+/).length * 300 + 700)), 0);
  population.dialogueFocus = { responders: policy.responders, until: Date.now() + Math.min(180000, duration + 15000) };
}
function install(state, inhabitants = I) {
  getPolicy = () => policyFor(state);
  Audience.currentPolicy = getPolicy;
  const extract = inhabitants.extractDialogue;
  if (extract._dialogueTurnGuard) return;
  function guarded(raw, names, options = {}) {
    const policy = options.responsePolicy || getPolicy();
    const result = extract(raw, names, { ...options, responsePolicy: policy });
    const geo = I.roomKey((state.getUpdatedGameConsole?.() || '').match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
    if (turns.getStore() && geo) focus(state.getRoomPopulation?.(geo), policy, result.dialogue);
    return result;
  }
  guarded._dialogueTurnGuard = true; inhabitants.extractDialogue = guarded;
}

// Compatibility for a running pre-refactor demo; fresh Retort code supplies this prompt directly.
function installLegacyPromptGuard() {
  const { RetortAgent } = require('retort-js/dist/agent');
  const original = Object.getOwnPropertyDescriptor(RetortAgent.prototype, 'prompt');
  if (original.get._dialogueTurnGuard) return () => {};
  function get() {
    const prompt = original.get.call(this), agent = this;
    return (...args) => {
      const message = prompt(...args), turn = turns.getStore();
      if (turn && agent.role === 'user') {
        if (message.content.startsWith('Dialogue recipient rule:')) turn.prompted = true;
        if (!turn.prompted && message.content.includes('[[CHARACTER_DIALOGUE]]') && message.content.includes('Replies: refresh')) {
          const policy = getPolicy();
          if (policy?.directed) { turn.prompted = true; agent.conversation.user(Audience.prompt(policy)); }
        }
      }
      return message;
    };
  }
  get._dialogueTurnGuard = true;
  Object.defineProperty(RetortAgent.prototype, 'prompt', { ...original, get });
  return () => Object.defineProperty(RetortAgent.prototype, 'prompt', original);
}
module.exports = { run, policyFor, focus, install, installLegacyPromptGuard };
