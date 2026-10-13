(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./stoneCarvings'):root.StoneCarvings,
    typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ReadableItems=api;
})(typeof window==='undefined'?globalThis:window,function(Carvings,Icons){
  'use strict';
  const key=value=>String(value||'').trim().toLowerCase();
  const clean=(s,max)=>typeof s==='string'&&!!s.trim()&&s.length<=max&&!/[<>]/.test(s);
  const fixtureTypes=['stone_tablet','gravestone','chest_tomb','sarcophagus','obelisk'];
  function hasContent(record){
    return Array.isArray(record?.chapters)&&record.chapters.some(c=>typeof c?.text==='string'&&!!c.text.trim());
  }
  function validate(rows){
    if(rows===undefined)return[];
    if(!Array.isArray(rows)||rows.length>4)throw Error('At most four additional readable puzzle pieces.');
    const names=new Set();
    return rows.map((r,i)=>{
      if(!['book','spellbook','scroll','map'].includes(r?.kind)||!clean(r.name,65)||!/^[a-z][a-z '-]+$/.test(r.name)||
        !new RegExp('\\b(?:'+(r.kind==='book'?'book|tome|codex|ledger|journal|chronicle':r.kind==='spellbook'?'spellbook|grimoire':r.kind)+')\\b').test(r.name)||names.has(key(r.name))||
        !clean(r.title,90)||/[\r\n]/.test(r.title)||!clean(r.backstory,350)||
        !['lore','mechanism_clue','route_notes','spell_reference'].includes(r.role)||!Array.isArray(r.chapters)||r.chapters.length<1||r.chapters.length>3||
        r.chapters.some(c=>!clean(c?.title,70)||/[\r\n]/.test(c.title)||!clean(c.text,800)))throw Error('Invalid readable item, backstory or chapters.');
      names.add(key(r.name));
      const clueChapter=r.clueChapter??1;
      if(!Number.isInteger(clueChapter)||clueChapter<1||clueChapter>r.chapters.length)throw Error('A document clue must refer to a real chapter.');
      const modifiers={};
      for(const field of ['attack_modifier','damage_modifier','ac','magic']){
        const value=r.modifiers?.[field]??0;if(!Number.isInteger(value)||value<0||value>8)throw Error('Readable modifiers must be bounded integer item stats.');
        modifiers[field]=value;
      }
      const spellRefs=r.spellRefs??[];
      if(!Array.isArray(spellRefs)||spellRefs.length>6||spellRefs.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9_]{0,31}$/.test(id))||new Set(spellRefs).size!==spellRefs.length)throw Error('Invalid future spell references.');
      return{id:'text_'+i,name:r.name.trim(),kind:r.kind,title:r.title.trim(),backstory:r.backstory.trim(),role:r.role,clueChapter,
        modifiers,spellRefs,chapters:r.chapters.map(c=>({title:c.title.trim(),text:c.text.trim()}))};
    });
  }
  function validateInscriptions(rows){
    if(rows===undefined)return[];
    if(!Array.isArray(rows)||rows.length>4)throw Error('At most four inscribed fixtures.');
    const names=new Set();
    return rows.map((r,i)=>{
      const text=r?.kind==='inscription'?r.chapters?.[0]?.text:r?.text;
      if(!fixtureTypes.includes(r?.type)||!clean(r.name,65)||!/^[a-z][a-z '-]+$/.test(r.name)||names.has(key(r.name))||
        !clean(r.title,90)||/[\r\n]/.test(r.title)||!clean(r.backstory,350)||!clean(text,650)||
        !['lore','mechanism_clue'].includes(r.role)||!['Skull','Dragon','Crown','Moon','Star','Key','Eye','Wave','Sun','Leaf','Mountain','Serpent'].includes(r.motif||'Skull')&&!Icons.name(r.motif))
        throw Error('Invalid inscribed fixture or epitaph.');
      names.add(key(r.name));
      return{id:'inscription_'+i,name:r.name.trim(),title:r.title.trim(),kind:'inscription',type:r.type,
        backstory:r.backstory.trim(),role:r.role,clueChapter:1,motif:Icons.name(r.motif)||r.motif||'Skull',...Carvings.validate(r),chapters:[{title:'Inscription',text:text.trim()}]};
    });
  }
  function intent(input){
    const s=String(input||'').trim().replace(/[.!]+$/,'');
    let m=/^(read|examine|inspect|search)\s+(?:the\s+)?(.+)$/i.exec(s);if(!m)return null;
    let name=m[2],chapter=null;
    const first=/^chapter\s+(\d+)(?:\s+(?:of|in)\s+(?:the\s+)?(.+))?$/i.exec(name);
    const last=/^(.+)\s+chapter\s+(\d+)$/i.exec(name);
    if(first){chapter=Number(first[1]);name=first[2]||'';}else if(last){name=last[1];chapter=Number(last[2]);}
    return {name:key(name),chapter,inspect:key(m[1])!=='read'};
  }
  function passage(record,action,clue=''){
    if(record.kind==='inscription')return`${record.title}\n${action.inspect?record.backstory+'\n':''}${record.chapters[0].text}${record.role==='mechanism_clue'&&clue?'\nThe accompanying diagram: '+clue:''}`;
    const contents=record.chapters.map((c,i)=>`Chapter ${i+1}: ${c.title}`).join('; ');
    if(action.inspect)return`${record.title}\n${record.backstory}\nContents: ${contents}.`;
    const number=action.chapter??1,c=record.chapters[number-1];
    if(!c)return`This ${record.kind} has ${record.chapters.length} chapters. Contents: ${contents}.`;
    return`${record.title}\nChapter ${number}: ${c.title}\n${c.text}${record.role==='mechanism_clue'&&number===record.clueChapter&&clue?'\nThe accompanying diagram: '+clue:''}`;
  }
  function spawn(definition,room,consoleText){
    const records=definition.readables||[],inscriptions=definition.inscriptions||[];
    if(!records.length&&!inscriptions.length)return consoleText;
    // Refuse all collisions before writing any records, including a collision late in the batch.
    for(const r of records){
      const owned=room.objects?.find(v=>key(v.name)===key(r.name));
      if(owned&&key(owned.type)!=='other')throw Error('A readable piece cannot replace existing equipment.');
    }
    if(inscriptions.length){
      room.inscriptions||=[];
      for(const r of inscriptions)if(!room.inscriptions.some(v=>key(v.name)===key(r.name)))room.inscriptions.push({...r,mechanismId:definition.id});
    }
    if(!records.length)return consoleText;
    const names=String(consoleText.match(/^Objects in Room:[ \t]*([^\r\n]*)/m)?.[1]||'').split(',').map(s=>s.trim()).filter(s=>s&&!/^(none|empty)$/i.test(s));
    const properties=consoleText.match(/^Objects in Room Properties:[ \t]*([^\r\n]*)/m)?.[1]?.match(/\{[^{}]*\}/g)||[];
    room.objects ||= [];room.readables ||= [];
    for(const r of records){
      const exists=room.readables.find(v=>key(v.name)===key(r.name));
      const ownedObject=room.objects.find(v=>key(v.name)===key(r.name));
      if(exists)continue;
      const props={...r.modifiers};
      room.readables.push({...r,mechanismId:definition.id});
      if(!ownedObject)room.objects.push({name:r.name,type:'other',properties:props,puzzlePiece:{mechanismId:definition.id,readableId:r.id}});
      if(!names.some(n=>key(n)===key(r.name)))names.push(r.name);
      if(!properties.some(p=>p.includes(`name: "${r.name}"`)))properties.push(`{name: "${r.name}", type: "other", attack_modifier: ${props.attack_modifier}, damage_modifier: ${props.damage_modifier}, ac: ${props.ac}, magic: ${props.magic}}`);
    }
    return consoleText.replace(/^Objects in Room:[^\r\n]*/m,()=>`Objects in Room: ${names.join(', ')||'None'}`)
      .replace(/^Objects in Room Properties:[^\r\n]*/m,()=>`Objects in Room Properties: ${properties.join(', ')||'None'}`);
  }
  return{validate,validateInscriptions,fixtureTypes,hasContent,intent,passage,spawn,key};
});
