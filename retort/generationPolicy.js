'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scopes = new AsyncLocalStorage();
const owners = new AsyncLocalStorage();
const RETRIES = 3, ATTEMPTS = RETRIES + 1;
function scope(work) { return scopes.getStore() ? work() : scopes.run(new Map(), work); }
function budget(key) {
  const units = scopes.getStore();
  if (!units) return { key, used: 0, limit: ATTEMPTS };
  if (!units.has(key)) units.set(key, { key, used: 0, limit: ATTEMPTS });
  return units.get(key);
}
function claim(unit) {
  if (unit.used >= unit.limit) throw Object.assign(Error('Generation recovery budget exhausted: initial attempt plus three retries.'),
    { code: 'GENERATION_BUDGET_EXHAUSTED', unit: unit.key, attempts: unit.used });
  return ++unit.used;
}
function providerRetry(error) {
  if (error?.recoverable === false || error?.fatal || error?.name === 'AbortError' || /CANCEL|ABORT|REFUS|AUTH|STALE/.test(error?.code || '')) return false;
  if (error?.code === 'MODEL_PROVIDER_RETRY') return error.recoverable === true;
  if (String(error?.code || '').startsWith('MODEL_PROVIDER_')) return false;
  const status = error?.status ?? error?.response?.status;
  const category = [error?.code,error?.type,error?.error?.code,error?.error?.type].join(' ');
  if (/quota|billing|credit.balance|spending.limit/i.test(category)) return false;
  if (status === 429 && /insufficient (?:quota|credits?|balance)|exhausted (?:quota|credits?)|credit balance|^quota$/i.test(error?.message || '')) return false;
  return status === 408 || status >= 500 && status <= 599 || status === 429;
}
const ownsTransport = () => !!owners.getStore();
const withTransportOwner = (unit, work) => owners.run(unit, work);
const backoff = attempt => new Promise(resolve => setTimeout(resolve, Math.min(4000, 500 * 2 ** (attempt - 1))));
function recoverable(error, phase = 'validation') {
  if (error?.recoverable === false || ['GENERATION_BUDGET_EXHAUSTED', 'HOLODEK_CONTEXT_BUDGET'].includes(error?.code)) return false;
  if (providerRetry(error)) return true;
  const code = String(error?.code || ''), message = String(error?.message || '');
  if (/CANCEL|ABORT|REFUS|QUOTA|AUTH|STALE|CONTEXT_BUDGET|UNAVAILABLE|QUEUE_FULL/.test(code) ||
      error?.fatal === true || error?.name === 'AbortError' || [401, 403, 429].includes(error?.status) ||
      /declined|refus(?:ed|al)|exhausted quota|invalid api key|unavailable|ECONNREFUSED|ENOTFOUND|Connection error|no (?:OpenAI|xAI).*(?:client|key)|cancelled|canceled|stale (?:run|task)|unsupported.*schema|invalid.*schema/i.test(message)) return false;
  if (phase !== 'transport') return true;
  return ['PC_MODEL_EMPTY', 'MODEL_EMPTY_FINAL', 'MODEL_OUTPUT_LIMIT', 'PC_MODEL_OUTPUT_LIMIT', 'MODEL_SCHEMA'].includes(code) ||
    /structured|schema|function call|returned text/i.test(message);
}
module.exports = { RETRIES, ATTEMPTS, scope, budget, claim, recoverable, providerRetry, ownsTransport, withTransportOwner, backoff };
