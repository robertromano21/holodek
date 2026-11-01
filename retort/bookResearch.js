'use strict';
const I=require('../assets/dungeonInhabitants');
function reading(db,requirement){
  const book=db[requirement.coords]?.readables?.find(b=>b.id===requirement.bookId&&b.name===requirement.value);
  const chapter=book?.chapters?.[requirement.chapter-1];
  const receipt=chapter?.text?.trim()&&(db['0,0,0']?.bookReadings||[]).find(r=>r.source==='engine-book-reading-v1'&&
    r.bookId===book.id&&r.sourceKey===requirement.coords&&r.chapter===requirement.chapter&&r.contentHash===I.hash(chapter.text));
  return{passed:!!receipt,evidence:{source:'database.bookReadings',bookId:book?.id||null,chapter:requirement.chapter,receiptId:receipt?.id||null}};
}
function record(state,plan){
  if(!plan?.allowed||plan.inspect||!plan.record?.chapters?.[plan.chapter-1]?.text?.trim())return false;
  const db=JSON.parse(state.getRoomNameDatabase()||'{}'),book=db[plan.sourceKey]?.readables?.find(b=>b.id===plan.record.id);
  if(!book||book.chapters[plan.chapter-1]?.text!==plan.record.chapters[plan.chapter-1].text)return false;
  const root=db['0,0,0']||={},contentHash=I.hash(book.chapters[plan.chapter-1].text);root.bookReadings||=[];
  if(root.bookReadings.some(r=>r.bookId===book.id&&r.sourceKey===plan.sourceKey&&r.chapter===plan.chapter&&r.contentHash===contentHash))return false;
  root.bookReadings.push({id:require('node:crypto').randomUUID(),source:'engine-book-reading-v1',bookId:book.id,
    sourceKey:plan.sourceKey,chapter:plan.chapter,contentHash,at:Date.now()});
  state.setRoomNameDatabase(JSON.stringify(db));return true;
}
function seeds(db,names=null,limit=3){
  const out=[];
  for(const [coords,r]of Object.entries(db||{}))for(const b of r?.readables||[]){
    if(!['book','spellbook'].includes(b.kind)||b.bookLore?.pending||names&&!names.includes(b.name))continue;
    const chapters=(b.chapters||[]).map((c,i)=>({number:i+1,title:c.title,...(c.text?{excerpt:c.text.slice(0,180)}:{})}));
    if(!chapters.length)continue;
    out.push({bookId:b.id,name:b.name,title:b.title,coords,chapters:chapters.slice(0,3),
      rule:'Inspiration only. Bind reading to a real chapter; no new exits, rewards or spells through prose.'});
    if(out.length>=limit)return out;
  }
  return out;
}
module.exports={record,reading,seeds};
