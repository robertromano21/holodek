'use strict';
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['retort/settingLayer.js', 'retort/homebrewStoryPrompts.js', 'retort/graveMasterStoryPrompts.js',
  'retort/genreStoryPalette.js', 'retort/genreCharacterPalette.js', 'retort/generatedNames.js',
  'retort/holodekRoomWork.js', 'retort/holodekPopulationPrompt.js', 'retort/inhabitantGeneration.js',
  'retort/roomDescription.js', 'retort/regionalAdventure.js', 'retort/homebrewRegionalAdventure.js',
  'retort/itemAuthoring.js', 'retort/roomCast.js', 'retort/worldAuthoringHistory.js'];
function exportReview(output = path.join(ROOT, '.retort-data/prompt-review')) {
  const destination = path.resolve(output);
  if (!destination.startsWith(ROOT + path.sep)) throw Error('Prompt review output must remain inside this project.');
  fs.mkdirSync(destination, { recursive: true });
  const rows = [], candidates = [];
  for (const file of FILES) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8'), name = file.replace(/\//g, '--') + '.md';
    const lines = source.split(/\r?\n/);
    fs.writeFileSync(path.join(destination, name), '# ' + file + '\n\nSource templates, not a captured API request. Interpolations remain visible.\n\n```js\n' +
      lines.map((line, index) => String(index + 1).padStart(4) + ' ' + line).join('\n') + '\n```\n');
    rows.push({ file, name, characters: source.length });
    lines.forEach((line, index) => {
      if (/\be\.g\.|\bexamples?\b|such as|for example|Mara Venn|\bQuay\b/i.test(line))
        candidates.push('- `' + file + ':' + (index + 1) + '` ' + line.trim().slice(0, 280).replace(/`/g, "'"));
    });
  }
  const index = '# Prompt Review\n\n' +
    'Static authoring templates only. No saves, API keys, SSH credentials, server logs or player dialogue were read. No model calls were made.\n\n' +
    'Character counts below measure source size, not actual prompt tokens. Runtime context and provider token accounting must be measured separately. ' +
    'An example match is a review lead, not proof of what caused a generated name. CotG lore is intentionally present in canonical-only templates. ' +
    'Offline fixtures and production authoring coexist in settingLayer; inspect their routing before changing them.\n\n' +
    '## Templates\n\n' + rows.map(row => '- [' + row.file + '](' + row.name + ') (' + row.characters + ' source characters)').join('\n') +
    '\n\n## Example And Name Leads\n\n' + candidates.join('\n') + '\n';
  fs.writeFileSync(path.join(destination, 'index.md'), index);
  return { index: path.join(destination, 'index.md'), files: rows.length, exampleLeads: candidates.length, paidRequests: 0 };
}
if (require.main === module) console.log(JSON.stringify(exportReview(), null, 2));
module.exports = { exportReview, FILES };
