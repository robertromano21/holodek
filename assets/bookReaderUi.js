(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookReaderUi = api;
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  // world1 LIBRARY_BOOKS reader: scrollable popup with cover, table of contents and chapter navigation.
  // Every chapter request is a normal console action ("read chapter N of <name>") through the adjudication path.
  let panel = null;
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
  function close() { panel?.remove(); panel = null; }
  function record(name) { return root.getReadableItemMetadata?.(name) || null; }
  async function act(command) {
    const input = document.getElementById('chatuserinput');
    if (!input || input.value.trim() || typeof root.chatbotprocessinput !== 'function') return false;
    input.value = command; await root.chatbotprocessinput(); return true;
  }
  function render(name, chapter = 0) {
    const r = record(name); if (!r) return false;
    close();
    panel = el('dialog', { id: 'book-reader-popup', className: 'popup-container' });
    panel.style.cssText = 'max-width:640px;width:90vw;max-height:80vh;display:flex;flex-direction:column;';
    const header = el('header', {}, el('strong', { textContent: r.title }), el('button', { type: 'button', textContent: 'X', onclick: close }));
    const meta = el('p', { className: 'book-meta', textContent: `${r.author && !/^(Anonymous|Unknown)$/.test(r.author) ? 'By ' + r.author : 'Author unknown'}${r.published ? ' · ' + r.published : ''}` });
    const toc = el('ol', { className: 'book-toc' });
    r.chapters.forEach((c, i) => toc.append(el('li', {}, el('button', { type: 'button', className: 'popup-button', textContent: c.title + (c.text ? '' : ' (unread)'),
      onclick: async () => { const n = i + 1; if (!r.chapters[i].text) { body.textContent = 'Reading…'; await act(`read chapter ${n} of ${name}`); } render(name, n); } }))));
    const body = el('div', { className: 'book-body' }); body.style.cssText = 'overflow-y:auto;white-space:pre-wrap;flex:1;padding:6px 2px;';
    const c = chapter && r.chapters[chapter - 1];
    body.textContent = c ? `Chapter ${chapter}: ${c.title}\n\n${c.text || 'This chapter has not been read yet.'}` : (r.backstory || '');
    const nav = el('nav', {});
    if (chapter > 1) nav.append(el('button', { type: 'button', className: 'popup-button', textContent: '◀ Previous', onclick: () => toc.children[chapter - 2].firstChild.click() }));
    if (chapter) nav.append(el('button', { type: 'button', className: 'popup-button', textContent: 'Contents', onclick: () => render(name, 0) }));
    if (chapter < r.chapters.length) nav.append(el('button', { type: 'button', className: 'popup-button', textContent: 'Next ▶', onclick: () => toc.children[chapter].firstChild.click() }));
    panel.append(header, meta, chapter ? body : el('div', {}, body, toc), nav);
    panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    document.body.append(panel); panel.showModal?.();
    return true;
  }
  // First click: one action that generates (or loads) the cover + contents, then opens the reader.
  async function open(name) {
    if (!record(name)) await act(`read ${name}`);
    return render(name, 0);
  }
  // Browse view for large collections: subject -> shelf -> book. Only the clicked book is generated (lazy).
  function browse(dungeon, subject = null, shelf = null) {
    const L = root.LibraryBooks, d = dungeon || root.currentDungeon; if (!L || !d) return false;
    close(); panel = el('dialog', { id: 'book-reader-popup', className: 'popup-container' });
    panel.style.cssText = 'max-width:640px;width:90vw;max-height:80vh;display:flex;flex-direction:column;';
    const secs = L.sections(d), title = shelf ? `Shelf ${shelf}` : subject || 'Library catalogue';
    const list = el('div', { className: 'book-body' }); list.style.cssText = 'overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:3px;';
    const btn = (text, fn) => el('button', { type: 'button', className: 'popup-button', textContent: text, onclick: fn });
    if (!subject) [...new Set(secs.map(s => s.subject))].forEach(sub => list.append(btn(`${sub} (${secs.filter(s => s.subject === sub).length} shelves)`, () => browse(d, sub))));
    else if (!shelf) secs.filter(s => s.subject === subject).forEach(s => list.append(btn(`Shelf ${s.shelf}: ${s.subject}, ${s.era}${s.scale === 'ruin' ? ' (damaged)' : ''}`, () => browse(d, subject, s.shelf))));
    else L.books(d).filter(b => b.shelf === shelf).forEach(b => { const r = record(b.name); list.append(btn(r?.title ? `${r.title}${r.author && !/^(Anonymous|Unknown)$/.test(r.author) ? ' - ' + r.author : ''}` : `Unread volume (row ${b.row}, slot ${b.slot})`, () => open(b.name))); });
    const nav = el('nav', {}); if (subject) nav.append(btn('◀ Back', () => browse(d, shelf ? subject : null)));
    panel.append(el('header', {}, el('strong', { textContent: title }), el('button', { type: 'button', textContent: 'X', onclick: close })), list, nav);
    panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    document.body.append(panel); panel.showModal?.(); return true;
  }
  return { open, render, close, browse };
});
