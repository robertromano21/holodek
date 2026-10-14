'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'assets/game.js'), 'utf8');
const helpers = source.slice(source.indexOf('function displayLocalCommandResult('), source.indexOf('const roomDatabaseSyncClient'));
const command = source.slice(source.indexOf('async function chatbotprocessinput('), source.indexOf('//const sharedState', source.indexOf('async function chatbotprocessinput(')));

function fixture(value, exits, inventory = ['sepulchral key']) {
  const input = { value }, chat = { innerHTML: 'Prior adventure.' }, visible = { innerHTML: '' }, background = { innerHTML: '' };
  const intervals = new Map(); let timer = 0;
  const context = { console: { log() {} }, window: { CommandIntent: require('../assets/commandIntent') },
    currentCoordinates: { x: 0, y: 0, z: 0 }, inventory, roomNameDatabase: new Map([['0,0,0', { exits }]]),
    roomDatabaseSyncClient: {}, roomConversationHistories: {}, coordinatesToString: () => '0,0,0',
    document: { getElementById: id => id === 'chatuserinput' ? input : chat },
    localStorage: { getItem: () => 'test' }, getPromptsAndResponsesForConversation: async () => [],
    mapToPlainObject: map => Object.fromEntries(map), refreshConsoleExitStatus() {}, scrollToBottom() {},
    syncGameLogTranscript: () => visible.innerHTML = chat.innerHTML,
    syncBackgroundChatLog: () => background.innerHTML = chat.innerHTML,
    updateChatLog: () => { throw Error('Do not publish the temporary Loading transcript before the final result.'); },
    setInterval: fn => { intervals.set(++timer, fn); return timer; }, clearInterval: id => intervals.delete(id),
    fetch: () => { throw Error('A local unlock should not generate an LLM request.'); } };
  vm.runInNewContext(helpers + '\n' + command, context);
  return { context, chat, visible, background, intervals };
}

for (const status of ['locked', 'sealed']) test(`unlocking the southeast ${status} door replaces Loading and synchronizes both Game Logs`, async () => {
  const exit = { status, key: 'sepulchral key' }, f = fixture('unlock door with sepulchral key', { southeast: exit });
  await f.context.chatbotprocessinput();
  assert.equal(exit.status, 'open'); assert.equal(exit.key, null);
  assert.match(f.visible.innerHTML, new RegExp(`The southeast exit has been ${status === 'sealed' ? 'unsealed' : 'unlocked'} using the sepulchral key`));
  assert.equal(f.visible.innerHTML, f.chat.innerHTML); assert.equal(f.background.innerHTML, f.chat.innerHTML);
  assert.doesNotMatch(f.chat.innerHTML, /Loading/); assert.equal(f.intervals.size, 0);
  assert.equal(f.context.window.keepAliveInterval, null);
});

for (const value of ['unlock door', 'unlock door with wrong key', 'unlock door with unknown key']) test(`a rejected local unlock is logged without a lingering Loading timer: ${value}`, async () => {
  const exit = { status: 'locked', key: 'sepulchral key' }, f = fixture(value, { southeast: exit }, ['sepulchral key', 'wrong key']);
  await f.context.chatbotprocessinput();
  assert.equal(exit.status, 'locked'); assert.equal(f.intervals.size, 0);
  assert.equal(f.visible.innerHTML, f.chat.innerHTML); assert.doesNotMatch(f.visible.innerHTML, /Loading/);
});

test('unlocking where there is no lock also completes the local log update', async () => {
  const f = fixture('unlock door with sepulchral key', { southeast: { status: 'open' } });
  await f.context.chatbotprocessinput();
  assert.match(f.visible.innerHTML, /There is no locked exit here/); assert.equal(f.intervals.size, 0);
});
