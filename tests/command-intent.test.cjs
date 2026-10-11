'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const CommandIntent = require('../assets/commandIntent');
const aliases = {
  n: 'north', north: 'north', s: 'south', south: 'south', e: 'east', east: 'east', w: 'west', west: 'west',
  ne: 'northeast', northeast: 'northeast', nw: 'northwest', northwest: 'northwest',
  se: 'southeast', southeast: 'southeast', sw: 'southwest', southwest: 'southwest',
  u: 'up', up: 'up', d: 'down', down: 'down'
};
test('only complete direction commands and explicit movement verbs trigger travel', () => {
  for (const [input, expected] of Object.entries(aliases)) {
    for (const prefix of ['', 'go ', 'move ', 'walk ', 'run ', 'head ', 'travel ', 'proceed ', 'climb ']) {
      assert.equal(CommandIntent.travelDirection(prefix+input), expected);
      assert.equal(CommandIntent.travelDirection('  '+(prefix+input).toUpperCase()+'!  '), expected);
    }
  }
});
test('directions inside puzzle commands, item commands, questions or dialogue are not travel', () => {
  for (const input of ["What's up?", 'What\u2019s up?', 'say to companions go west', 'say "west"', 'Can we go north?',
    'turn West dial', 'set East dial to Sun', 'inspect North dial', 'press South button', 'pull Down lever',
    'take north star', 'drop sword down', 'pick up sword', 'equip east blade to Mortacia', 'put it down',
    'look up', 'lie down', 'get up', 'walk west and talk', 'the path goes west', 'go', 'move', 'west?', '', null])
    assert.equal(CommandIntent.travelDirection(input), null, String(input));
});
test('the production client uses exact movement detection and keeps its exit and lock gates', () => {
  const source = fs.readFileSync('assets/game.js', 'utf8');
  const body = source.slice(source.indexOf('async function chatbotprocessinput('));
  const expression = body.match(/^\s*let validDirection = ([^;]+);/m)[1];
  const detect = new Function('userInput','window',`return ${expression}`);
  assert.equal(detect('turn West dial', { CommandIntent }), null);
  assert.equal(detect('w', { CommandIntent }), 'west');
  assert.equal(detect('walk down', { CommandIntent }), 'down');
  assert.match(body, /if \(!recentExits.includes\(validDirection\)\)/);
  assert.match(body, /isExitTraversable\(currentCoordinates, validDirection\)/);
  const index = fs.readFileSync('assets/index.html','utf8');
  assert.ok(index.indexOf('/assets/commandIntent.js') < index.indexOf('/assets/game.js'));
});
