(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DungeonDialogueHistory = factory();
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const databases=new WeakMap();
  function append(db, { conversationId, geoKey, speaker, line, runId }) {
    if (!db || !conversationId || !speaker || !line) return Promise.resolve();
    let streams=databases.get(db);
    if(!streams){streams=new Map();databases.set(db,streams);}
    let stream=streams.get(conversationId);
    if(!stream){stream={key:null,busy:false,pending:Promise.resolve()};streams.set(conversationId,stream);}
    if(stream.busy)return stream.pending.then(()=>append(db,{conversationId,geoKey,speaker,line,runId}));
    stream.busy=true;
    const speech = `${String(speaker).slice(0, 70)}: "${String(line).replace(/[\r\n]/g, ' ').slice(0, 320)}"`;
    const work=new Promise((resolve, reject) => {
      const transaction = db.transaction(['conversation'], 'readwrite');
      const store = transaction.objectStore('conversation');
      let recent = [];
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => {stream.key=null;reject(transaction.error || Error('Could not record dialogue.'));};
      function put() {
        // A single rolling transcript entry cannot crowd normal command turns out of retrieval.
        recent = [...recent.filter(row => !runId || !row.runId || row.runId === runId).map(row => ({ ...row, runId: row.runId || runId })),
          { geoKey, speech, speaker, runId, at: Date.now() }].slice(-6);
        const added=store.add({ kind: 'ambient-dialogue', conversationId, runId, dialogue: recent,
          prompt: '$.user `[Meanwhile]`', assistantPrompt: '', systemPrompt: '', personalNarrative: '',
          response: `$.assistant \`${recent.map(row => row.speech).join('\n')}\``, gameConsole: '' });
        added.onsuccess=event=>{stream.key=event.target.result;};
      }
      function scan() {
        const cursor=store.index('conversationId').openCursor(conversationId);
        cursor.onsuccess=event=>{
          const row=event.target.result;
          if(!row){put();return;}
          if(row.value.kind==='ambient-dialogue'){
            recent.push(...(Array.isArray(row.value.dialogue)?row.value.dialogue:[]));row.delete();
          }
          row.continue();
        };
      }
      // Scan old history once after loading; subsequent speech touches only its own entry.
      if(stream.key===null)scan();
      else {
        const request=store.get(stream.key);
        request.onsuccess=event=>{
          const row=event.target.result;
          if(row?.kind!=='ambient-dialogue'||row.conversationId!==conversationId){stream.key=null;scan();return;}
          recent=Array.isArray(row.dialogue)?row.dialogue:[];store.delete(stream.key);put();
        };
      }
    });
    stream.pending=work.finally(()=>{stream.busy=false;});
    return stream.pending;
  }
  return { append };
});
