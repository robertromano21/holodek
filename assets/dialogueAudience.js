(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DialogueAudience = factory();
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const COMMAND_SEMANTICS = `Player commands are directions to the Grave Master, not verbatim character speech. Unquoted recipient selectors such as "the monsters", "Monsters in Room", "NPCs in Party", "the party" and character names choose whom to address; characters do not hear those routing labels and must not take offense at them. Preserve actual quoted speech, including a deliberate insult inside it; do not censor the word monster when it really is spoken. Unquoted questions and indirect speech still communicate their intended meaning, not their command syntax.
An instruction such as "tell the monsters my tale", "tell them my story" or "explain my exile" authorizes the PC to convey the established account now. Draw its content from the full original system-prompt lore, the selected PC's canonical premise and established personal history. For Mortacia, recount her established exile from Hades and loss of power, using the actual lore rather than requiring the player to repeat it. Narrate the telling and the addressed listeners' informed responses; do not turn it into a mere offer, insist the tale was not told, or ask the player for a quoted script. This fulfills the requested action, not an unsolicited decision for the PC. Do not invent a new past, private motives, an unrequested promise, a recovered artifact or completed quest. Only the actual nearby audience learns what was shared; other residents do not acquire private knowledge remotely. A listener's existing spoken.remember metadata may retain a new disclosure only after the narrative actually conveys it; never label the PC's words as that listener's speech. Stored player-input commands and recollection.player entries are also directions, not literal speech transcripts.`;
  function commandPrompt(input) {
    return `PLAYER COMMAND INTERPRETATION: ${COMMAND_SEMANTICS}\nCurrent command (data): ${JSON.stringify(String(input || '').trim().slice(0, 4000))}`;
  }
  function resolve(input, actors, audibleNames = actors.map(a => a.name)) {
    const living = actors.filter(a => a.type !== 'pc' && (a.hp ?? a.HP ?? 1) > 0 && (a.state || a.State) !== 'Dead');
    const audible = new Set(audibleNames.map(key)), original = String(input || '').trim().slice(0, 4000);
    const prefix = original.split(/["\u201c]/)[0].trim();
    const verbal = prefix.match(/^(?:please\s+|i\s+)?(?:say|ask|tell|talk|speak|chat|address|greet|question|whisper|shout|call)\b\s*(.*)$/i);
    let tail = verbal ? verbal[1].replace(/^(?:to|with|at)\b\s*/i, '') : prefix;
    const explicitTo = !!verbal && /^(?:to|with|at)\b/i.test(verbal[1]);
    const firstCounts = new Map();
    for (const actor of living) { const first = key(actor.name).split(' ')[0]; firstCounts.set(first, (firstCounts.get(first) || 0) + 1); }
    const aliases = living.flatMap(actor => {
      const name = key(actor.name), first = name.split(' ')[0];
      return [name, ...(first.length >= 3 && firstCounts.get(first) === 1 && first !== name ? [first] : [])].map(alias => ({ alias, actor }));
    }).sort((a, b) => b.alias.length - a.alias.length);
    const matches = value => aliases.find(row => new RegExp(`^${escape(row.alias)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(key(value)));
    // A name in the question body is its subject, not necessarily its addressee.
    if (!tail && verbal) {
      const quote = original.match(/["\u201c]([^"\u201d]*)/);
      if (quote && /,/.test(quote[1])) tail = quote[1].split(',')[0].trim();
    }
    let directed = false, kind = 'general', targets = [], requestedState = null;
    const group = tail.match(/^(?:the\s+|my\s+|our\s+)?(?:(friendly|neutral|hostile|dead)\s+)?(monsters?|residents?|inhabitants?|npcs?|companions?|party(?:\s+members)?|everyone|everybody|all(?:\s+of\s+you)?)\b/i);
    if (verbal && group) {
      requestedState = group[1] ? group[1][0].toUpperCase() + group[1].slice(1).toLowerCase() : null;
      const label = group[2].toLowerCase();
      kind = /^(monster|resident|inhabitant)/.test(label) ? 'residents' : /^(npc|companion|party)/.test(label) ? 'party' : 'everyone';
      directed = true;
      targets = living.filter(a => (kind === 'everyone' || a.type === (kind === 'residents' ? 'monster' : 'npc')) &&
        (!requestedState || (a.allegiance || a.state || a.State) === requestedState));
    } else {
      let match = matches(tail);
      if (match && (verbal || /^[^,]+,/.test(tail) || key(tail) === match.alias)) {
        directed = true; kind = 'named';
        while (match) {
          targets.push(match.actor);
          tail = key(tail).slice(match.alias.length).replace(/^\s*(?:,\s*(?:and\s+)?|and\s+|&\s*)/i, '');
          match = matches(tail);
        }
      } else if (explicitTo || verbal && /^[\p{Lu}][\p{L}'\u2019-]+\b/u.test(tail) && !/^(?:What|Who|Where|Why|How|When|If|Whether)\b/.test(tail)) {
        directed = true; kind = 'unavailable';
      }
    }
    if (!directed) targets = living;
    const responders = [...new Set(targets.filter(a => audible.has(key(a.name))).map(a => a.name))];
    const residentConversation = directed && (kind === 'residents' || targets.some(a => a.type === 'monster'));
    const reactors = residentConversation ? living.filter(a => a.type === 'npc' && audible.has(key(a.name)) && !responders.includes(a.name)).map(a => a.name) : [];
    return { directed, kind, requestedState, targets: [...new Set(targets.map(a => a.name))], responders, reactors };
  }
  function prompt(policy) {
    return `Dialogue recipient rule: ${JSON.stringify(policy)}. ${COMMAND_SEMANTICS}\nHearing is not an invitation to answer. Only responders may answer the PLAYER's question. Named recipients take precedence over names merely mentioned in quoted speech. If there are no available responders, narrate that nobody addressed can answer; do not substitute a companion or distant resident. Other nearby characters may listen and react silently. For a resident conversation, at most ONE listed reactor may subsequently respond TO A RESIDENT, not answer the player or deliver unrelated cached commentary. Its short reaction must engage with what that resident ACTUALLY said earlier in THIS response. In spoken metadata include {"speaker":"companion name","replyTo":"exact resident name","reactsTo":"an exact phrase of at least three words from that resident's preceding speech"}. Label the reaction's entire quote with the existing SPEECH markers. No reaction before a resident speaks, no invented or remembered trigger, no chorus, and no generic unsolicited monologues.`;
  }
  function gate(policy, metadata = []) {
    const primary = new Set(policy.responders.map(key)), secondary = new Set(policy.reactors.map(key)), said = new Map();
    let reactionSpeaker = null;
    return passage => {
      const speaker = key(passage.speaker);
      if (primary.has(speaker)) {
        said.set(speaker, [...(said.get(speaker) || []), key(passage.line)]); return true;
      }
      if (!secondary.has(speaker) || !passage.labelled || reactionSpeaker && reactionSpeaker !== speaker) return false;
      const rows = metadata.filter(row => key(row?.speaker) === speaker && typeof row.replyTo === 'string' && typeof row.reactsTo === 'string');
      if (rows.length !== 1) return false;
      const trigger = key(rows[0].reactsTo).replace(/["\u201c\u201d]/g, ''), parent = key(rows[0].replyTo);
      if (!primary.has(parent) || trigger.length < 8 || trigger.split(' ').length < 3 ||
          !said.get(parent)?.some(line => line.includes(trigger))) return false;
      reactionSpeaker = speaker; return true;
    };
  }
  return { resolve, prompt, gate, COMMAND_SEMANTICS, commandPrompt };
});
