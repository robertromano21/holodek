'use strict';
// Strict assembler for the emitted SID player's small, documented 6502 subset.
// No macros, includes, expressions-as-JavaScript, or guessed addressing modes.
const table=new Map(),put=(name,mode,op)=>table.set(name+':'+mode,op);
const modes=['ix','zp','imm','abs','iy','zx','ay','ax'];
['ORA','AND','EOR','ADC','STA','LDA','CMP','SBC'].forEach((name,row)=>[1,5,9,13,17,21,25,29].forEach((col,i)=>{
  if(name!=='STA'||col!==9)put(name,modes[i],row*32+col);
}));
for(const [name,codes]of Object.entries({ASL:[[6,'zp'],[10,'acc'],[14,'abs'],[22,'zx'],[30,'ax']],
  LSR:[[70,'zp'],[74,'acc'],[78,'abs'],[86,'zx'],[94,'ax']],
  STX:[[134,'zp'],[142,'abs'],[150,'zy']],STY:[[132,'zp'],[140,'abs'],[148,'zx']],
  LDX:[[162,'imm'],[166,'zp'],[174,'abs'],[182,'zy'],[190,'ay']],LDY:[[160,'imm'],[164,'zp'],[172,'abs'],[180,'zx'],[188,'ax']],
  CPX:[[224,'imm'],[228,'zp'],[236,'abs']],CPY:[[192,'imm'],[196,'zp'],[204,'abs']],
  DEC:[[198,'zp'],[206,'abs'],[214,'zx'],[222,'ax']],INC:[[230,'zp'],[238,'abs'],[246,'zx'],[254,'ax']],
  JMP:[[76,'abs']],JSR:[[32,'abs']]}))for(const [op,mode]of codes)put(name,mode,op);
for(const [name,op]of Object.entries({PHA:72,PLA:104,TXA:138,TYA:152,TAX:170,TAY:168,RTS:96,RTI:64,CLC:24,SEC:56,
  SEI:120,CLI:88,INY:200,INX:232,DEY:136,DEX:202,NOP:234}))put(name,'imp',op);
const branches={BPL:16,BMI:48,BVC:80,BVS:112,BCC:144,BCS:176,BNE:208,BEQ:240};
for(const [name,op]of Object.entries(branches))put(name,'rel',op);
function assemble(source){
  const symbols=new Map(),rows=[],used=new Set();let pc=0,start=null;
  const value=(raw,unknown=false)=>{
    const s=raw.trim(),selector=/^[<>]/.test(s)?s[0]:null,body=selector?s.slice(1):s;
    const m=body.match(/^(\$[\da-f]+|\d+|[a-z_]\w*)(?:\s*([+-])\s*(\d+))?$/i);
    if(!m)throw Error('Unsupported SID assembler expression: '+raw);
    let n=m[1][0]==='$'?parseInt(m[1].slice(1),16):/^\d/.test(m[1])?Number(m[1]):symbols.get(m[1]);
    if(n===undefined){if(unknown)return null;throw Error('Unresolved SID symbol: '+m[1]);}
    n+=(m[2]==='-'?-1:1)*Number(m[3]||0);return selector==='<'?n&255:selector==='>'?(n>>8)&255:n;
  };
  const define=(name,n)=>{if(symbols.has(name))throw Error('Duplicate SID symbol: '+name);symbols.set(name,n);};
  for(const [index,line]of String(source).split(/\r?\n/).entries()){
    try{
      let s=line.split(';')[0].trim();if(!s)continue;
      const constant=s.match(/^(\w+)\s*=\s*(.+)$/);
      if(constant){define(constant[1],value(constant[2]));continue;}
      const origin=s.match(/^\*\s*=\s*(.+)$/);
      if(origin){const at=value(origin[1]);if(start!==null&&at<pc)throw Error('Overlapping SID origin');pc=at;start??=pc;continue;}
      const label=s.match(/^(\w+):\s*(.*)$/)||s.match(/^(\w+)\s+(\.byte.*)$/i);
      if(label){define(label[1],pc);s=label[2].trim();if(!s)continue;}
      if(start===null)throw Error('Missing load origin');
      if(/^\.byte\s/i.test(s)){const data=s.replace(/^\.byte\s+/i,'').split(',');rows.push({pc,data});pc+=data.length;continue;}
      const instruction=s.match(/^(\w+)(?:\s+(.*))?$/);if(!instruction)throw Error('Unsupported statement: '+s);
      const name=instruction[1].toUpperCase();let arg=(instruction[2]||'').trim(),mode='abs';
      if(!arg)mode=table.has(name+':imp')?'imp':'acc';
      else if(Object.hasOwn(branches,name))mode='rel';
      else if(arg[0]==='#'){mode='imm';arg=arg.slice(1);}
      else if(/^\([^()]+\),y$/i.test(arg)){mode='iy';arg=arg.slice(1,-3);}
      else{
        const indexed=arg.match(/^(.+),([xy])$/i);if(indexed)arg=indexed[1];
        const n=value(arg,true),zp=n!==null&&n>=0&&n<=255;
        mode=indexed?(zp?'z':'a')+indexed[2].toLowerCase():zp&&name!=='JMP'&&name!=='JSR'?'zp':'abs';
        if(!table.has(name+':'+mode)&&zp)mode=indexed?'a'+indexed[2].toLowerCase():'abs';
      }
      const op=table.get(name+':'+mode);if(op===undefined)throw Error('Unsupported instruction/mode: '+s+' ('+mode+')');
      const size=['imp','acc'].includes(mode)?1:['abs','ax','ay'].includes(mode)?3:2;
      rows.push({pc,op,mode,arg,size});pc+=size;
      if(pc>0xa000)throw Error('SID core exceeds safe contiguous RAM below $A000');
    }catch(error){throw Error('SID assembly line '+(index+1)+': '+error.message);}
  }
  if(start===null||pc<=start)throw Error('Empty SID assembly');
  const data=Buffer.alloc(pc-start);
  const byte=(at,n)=>{if(used.has(at))throw Error('Overlapping SID bytes');used.add(at);data[at-start]=n&255;};
  for(const row of rows){
    if(row.data){row.data.forEach((v,i)=>{const n=value(v);if(n<0||n>255)throw Error('SID byte out of range');byte(row.pc+i,n);});continue;}
    byte(row.pc,row.op);if(row.size===1)continue;
    let n=value(row.arg);
    if(row.mode==='rel'){n-=row.pc+2;if(n < -128||n>127)throw Error('SID branch out of range: '+row.arg);}
    else if(n<0||n>(row.size===2?255:65535))throw Error('SID operand out of range: '+row.arg);
    byte(row.pc+1,n);if(row.size===3)byte(row.pc+2,n>>8);
  }
  return{loadAddress:start,data,symbols:Object.fromEntries(symbols)};
}
module.exports={assemble};
