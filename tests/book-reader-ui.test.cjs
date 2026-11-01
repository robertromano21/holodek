'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('a pending book opens its new cover, clickable contents and cached chapters through normal read commands',async()=>{
  const nodes=[];
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.style={cssText:''};this.value='';this.listeners={};nodes.push(this);}
    append(...kids){this.children.push(...kids);}
    remove(){this.removed=true;}
    addEventListener(k,f){this.listeners[k]=f;}
    showModal(){this.modal=true;}
    get firstChild(){return this.children[0];}
    click(){return this.onclick?.();}
  }
  const input=new Node('input'),commands=[];let record={name:'old chronicle',kind:'book',title:'Unread volume',chapters:[],bookLore:{pending:true}};
  const root={dungeonRunId:'run',getReadableItemMetadata:()=>record,chatbotprocessinput:async()=>{
    const command=input.value;input.value='';commands.push(command);
    if(command==='read old chronicle')record={...record,title:'An Original Local History',author:'Unknown',published:'612 S.R.',backstory:'A local history.',bookLore:{version:2},
      chapters:[{title:'The First Account',text:''},{title:'Another Witness',text:''}]};
    else record.chapters[Number(command.match(/chapter (\d+)/)[1])-1].text='The generated and saved chapter.';
  }};
  const document={createElement:tag=>new Node(tag),getElementById:id=>id==='chatuserinput'?input:null,body:new Node('body')};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/bookReaderUi'),'utf8'),{window:root,document});
  assert.equal(await root.BookReaderUi.open('old chronicle'),true);assert.deepEqual(commands,['read old chronicle']);
  assert.ok(nodes.some(n=>n.textContent?.includes('612 S.R.')));
  await nodes.find(n=>n.tag==='button'&&n.textContent==='The First Account (unread)').click();
  assert.deepEqual(commands,['read old chronicle','read chapter 1 of old chronicle']);
  assert.ok(nodes.some(n=>n.textContent?.includes('The generated and saved chapter.')));
  await root.BookReaderUi.open('old chronicle');await nodes.filter(n=>n.tag==='button'&&n.textContent==='The First Account').at(-1).click();
  assert.equal(commands.length,2,'Rereading is cached, not a new generation request');
});
