'use strict';
const M = require('../assets/campaignMemory');
const ACTIONS = ['Search', 'Dialogue', 'Movement', 'ObjectInteraction', 'PuzzleSolving', 'Combat'];
const RESULTS = ['success', 'partial', 'failure', 'information'];
function extract(raw) {
  const text = String(raw || ''), match = text.match(/\[\[ACTION_METADATA\]\]([\s\S]*?)\[\[\/ACTION_METADATA\]\]/i);
  let candidates = [];
  try { candidates = JSON.parse(match?.[1] || '[]'); } catch { /* Legacy range tables remain valid. */ }
  return { content: text.replace(/\[\[ACTION_METADATA\]\][\s\S]*?(?:\[\[\/ACTION_METADATA\]\]|$)/ig, '').trim(),
    candidates: Array.isArray(candidates) ? candidates.slice(0, 48) : [] };
}
function select(candidates, initial, evidenceIds = []) {
  const allowedEvidence = new Set(evidenceIds), selected = [];
  for (const [i, character] of (initial['Selected Characters'] || []).entries()) {
    const roll = initial['Dice Rolls']?.find(row => row.character === character)?.roll;
    const range = initial['Outcome Ranges']?.[i]?.find(row => roll >= row.low && roll <= row.high);
    if (!Number.isInteger(roll) || !range) continue;
    const matches = candidates.filter(row => row?.actor === character && row.low === range.low && row.high === range.high);
    if (matches.length !== 1) continue;
    const row = matches[0];
    if (!ACTIONS.includes(row.activity) || row.activity !== initial.Action || !RESULTS.includes(row.result) ||
        typeof row.questAttempted !== 'boolean' || !Array.isArray(row.puzzleSteps)) continue;
    selected.push({ actor: character, activity: row.activity, target: M.clean(row.target, 120), result: row.result,
      low: range.low, high: range.high, roll, outcome: M.clean(range.outcome), questAttempted: row.questAttempted,
      puzzleSteps: row.puzzleSteps.filter(step => typeof step === 'string').slice(0, 6).map(step => M.clean(step, 140)),
      evidenceIds: (Array.isArray(row.evidenceIds) ? row.evidenceIds : []).filter(id => allowedEvidence.has(id)).slice(0, 8),
      ...(typeof row.puzzleRequiresExit === 'boolean' ? { puzzleRequiresExit: row.puzzleRequiresExit } : {}),
      ...(typeof row.puzzleRequiresObject === 'boolean' ? { puzzleRequiresObject: row.puzzleRequiresObject } : {}) });
  }
  return selected;
}
function prompt(actors, action, evidenceIds) {
  return `After the unchanged dice-range table append invisible metadata: [[ACTION_METADATA]][{"actor":"exact acting name","low":1,"high":6,"activity":"${action}","target":"existing item, mechanism or activity","result":"failure","questAttempted":false,"puzzleSteps":[],"puzzleRequiresExit":false,"puzzleRequiresObject":false,"evidenceIds":[]}] [[/ACTION_METADATA]]. Include one record for EVERY range for ${JSON.stringify(actors)}. Results: success, partial, failure, information. For PuzzleSolving, success means the ENTIRE current Puzzle Solution was actually performed; a successful intermediate step is partial, not completion. Set puzzleRequiresExit/Object only when that fully solved puzzle explicitly promises the corresponding discovery. Record only puzzle steps actually performed by that potential outcome, not plans or hints. Evidence IDs may only come from ${JSON.stringify(evidenceIds)}. This metadata does not complete quests, grant loot/XP, unlock doors or override requirements. The server chooses only the metadata matching the real die roll; all other alternatives are discarded.`;
}
function flags(initial) {
  const rows = initial?.metadata;
  if (!Array.isArray(rows) || !rows.length || rows.length !== initial['Selected Characters']?.length) return null;
  if (new Set(rows.map(row => row?.actor)).size !== rows.length) return null;
  // Cross-check again at the consumer boundary; alternatives or forged rolls cannot become facts.
  for (const row of rows) {
    const i = initial['Selected Characters'].indexOf(row.actor), roll = initial['Dice Rolls']?.find(d => d.character === row.actor)?.roll;
    const range = initial['Outcome Ranges']?.[i]?.find(r => r.low === row.low && r.high === row.high && r.outcome === row.outcome);
    if (!range || row.roll !== roll || roll < row.low || roll > row.high || row.activity !== initial.Action ||
        !RESULTS.includes(row.result) || typeof row.questAttempted !== 'boolean' || !Array.isArray(row.puzzleSteps)) return null;
  }
  const attempt = rows.some(row => ['Search', 'PuzzleSolving'].includes(row.activity));
  const solved = initial.Action === 'PuzzleSolving' && rows.some(row => row.result === 'success');
  return { engagedInDialogue: initial.Action === 'Dialogue', justLooking: initial.Action === 'ObjectInteraction' && rows.every(row => row.result === 'information'),
    searchAttempted: attempt, searchSuccessful: attempt && rows.some(row => row.result === 'success'),
    objectDiscovered: false, exitDiscovered: false,
    puzzleRequiresExit: solved && rows.some(row => row.result === 'success' && row.puzzleRequiresExit === true),
    puzzleRequiresObject: solved && rows.some(row => row.result === 'success' && row.puzzleRequiresObject === true) };
}
module.exports = { extract, select, prompt, flags };
