(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaveGameTranscript = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function capture(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeName === 'BR') return '\n';
    if (['SCRIPT', 'STYLE', 'IMG'].includes(node.nodeName)) return '';
    const text = Array.from(node.childNodes || []).map(capture).join('');
    return ['P', 'DIV', 'PRE', 'SECTION', 'LI', 'H1', 'H2', 'H3'].includes(node.nodeName) ? '\n' + text + '\n' : text;
  }
  function unwrap(value, role) {
    const text = String(value || ''), prefix = '$.' + role + ' `';
    return text.startsWith(prefix) && text.endsWith('`') ? text.slice(prefix.length, -1) : text;
  }
  function restore(browser) {
    const d = browser.data;
    if (d.gameLogFormat === 'text-v2') return d.gameLogText;
    // Early saves used hiddenElement.innerText, which collapses BR elements.
    // Their durable conversation rows still retain the original paragraphs.
    const parts = [];
    for (const row of browser.conversation.rows) {
      const prompt = unwrap(row.prompt, 'user').trim(), response = unwrap(row.response, 'assistant').trim();
      if (prompt && !/^\[(?:Encounter|Meanwhile)\]$/.test(prompt)) parts.push('> ' + prompt);
      if (response && response !== 'Party inventory and currency synchronized.') parts.push(response);
    }
    return parts.length ? parts.join('\n\n') : d.gameLogText;
  }
  return { capture, restore };
});
