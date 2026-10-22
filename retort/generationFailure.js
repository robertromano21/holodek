'use strict';
// Diagnostics contain counts, never private reasoning or whole provider responses.
function evidence(completion) {
  const choice = completion?.choices?.[0], message = choice?.message || choice?.delta || {};
  const out = {};
  if (typeof choice?.finish_reason === 'string') out.finishReason = choice.finish_reason;
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const n = completion?.usage?.[key];
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  for (const [key, value] of Object.entries({ finalChars: message.content,
    reasoningChars: message.reasoning || message.reasoning_content }))
    if (typeof value === 'string') out[key] = value.length;
  return out;
}
function failure(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function retryable(error, local) {
  if (local && ['PC_MODEL_EMPTY', 'MODEL_EMPTY_FINAL'].includes(error?.code)) return true;
  return /structured|schema|function call|returned text/i.test(error?.message || '');
}
module.exports = { evidence, failure, retryable };
