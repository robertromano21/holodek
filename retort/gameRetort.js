'use strict';
const Base = require('retort-js');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('retort-js/dist/logger');
const { RetortMessage } = require('retort-js/dist/message');
const { logMessage } = require('retort-js/dist/log-message');
const Models = require('./gameModels');
const Transport = require('./modelTransport');

// Replay deltas with explicit completion/error signalling, unlike Retort 0.0.4's
// detached stream producer, which can leave all consumers waiting on an API error.
function replay(source) {
  const chunks = [], waiters = new Set();
  let ended = false, failure;
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  (async () => {
    try { for await (const chunk of source) { chunks.push(chunk); wake(); } }
    catch (error) { failure = error; }
    finally { ended = true; wake(); }
  })();
  return async function* () {
    let index = 0, content = '';
    while (true) {
      while (index < chunks.length) {
        const chunk = chunks[index++]; content += chunk.contentDelta;
        yield { ...chunk, content };
      }
      if (ended) { if (failure) throw failure; return; }
      await new Promise(resolve => waiters.add(resolve));
    }
  };
}
class GameMessage {
  constructor(role, json, source, log) {
    this.id = RetortMessage.createId(); this.role = role; this.json = json; this._content = null;
    const getStream = replay(source);
    this.promise = (async () => {
      let content = '';
      for await (const chunk of getStream()) {
        content += chunk.contentDelta;
        for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) if (chunk[key] !== undefined) this[key] = chunk[key];
      }
      this._content = content; return this;
    })();
    Object.assign(this.promise, { id: this.id, role, message: this, getStream, stream: (async function* () {
      for await (const chunk of getStream()) yield chunk.content;
    })() });
    // Observe failures without swallowing the rejection returned to the caller.
    this.promise.then(message => log(message), () => {}).catch(() => {});
  }
  get content() { if (this._content === null) throw new Error('Message not yet resolved; await message.promise.'); return this._content; }
  get result() { return this.json ? JSON.parse(this.content) : this.content; }
  toString() { return this.content; }
  toJSON() { return { id: this.id, role: this.role, content: this.content }; }
}
function createRuntime({ models = Models, client, log = logMessage, timeoutMs, prepareMessages } = {}) {
  const scope = new AsyncLocalStorage();
  function install(conversation, ancestors) {
    if (conversation.model === 'gpt-3.5-turbo') conversation.model = 'gpt-4.1-mini';
    function generate(role, push) {
      return generationSettings => {
        const settings = { ...conversation.settings, ...generationSettings };
        const prior = conversation.messages.map(message => message.promise);
        async function* source() {
          let messages = await Promise.all(prior.map(async message => { const m = await message; return { role: m.role, content: m.content }; }));
          if (prepareMessages) {
            // Inherit literal instructions, never pending parent generations or their results.
            const inheritedMessages = ancestors.flatMap(parent => parent.messages
              .filter(message => message instanceof RetortMessage)
              .map(message => ({ role: message.role, content: message.content })));
            messages = await prepareMessages(messages, { inheritedMessages, settings });
          }
          yield* Transport.stream(settings, messages, { models, client, timeoutMs });
        }
        const message = new GameMessage(role, !!settings.parameters, source(), log);
        if (push) conversation.messages.push(message);
        message.promise.catch(() => {
          const index = conversation.messages.indexOf(message);
          if (index !== -1) conversation.messages.splice(index, 1);
        });
        return message.promise;
      };
    }
    for (const [role, agent] of [['user', conversation.user], ['assistant', conversation.assistant], ['system', conversation.system]]) {
      Object.defineProperty(agent, 'generation', { configurable: true, get: () => generate(role, true) });
    }
    Object.defineProperty(conversation, 'generation', { configurable: true, get: () => generate('assistant', false) });
    conversation.run = run;
    return conversation;
  }
  function retort(callback) {
    const value = Base.retort(($, ...args) => models.withSnapshot(() => {
      const ancestors = scope.getStore() || [];
      const conversation = install($, ancestors);
      return scope.run([...ancestors, conversation], () => callback(conversation, ...args));
    }));
    value.retortHash = createHash(callback.toString());
    return value;
  }
  function run(value, params, options) { return Base.run(typeof value === 'function' ? retort(value) : value, params, options); }
  return { retort, run };
}
module.exports = { ...createRuntime(), createRuntime, replay };
