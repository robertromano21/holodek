#!/usr/bin/env node
// --- DROP-IN REPLACEMENT ---
// Build PRG-oriented ASM AND a PSID-ready ASM + .sid (no defaults, strict).
// Requires: xa (assembler).

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv.length < 4) {
  console.error('Usage: node renderSid_poke.js <input.json> <output.asm>');
  process.exit(1);
}
const inFile = process.argv[2];
const prgAsmOut = process.argv[3];

const song = JSON.parse(fs.readFileSync(inFile, 'utf8'));

// ---------- enums + strict assert ----------
const ALLOWED = {
  BPM:    [96,104,112,120,128,136,144],
  KEY:    ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
  SCALE:  ['major','minor','dorian','phrygian','mixolydian','lydian'],
  ROLE:   ['LEAD','BASS','ARP_OR_DRUMS'],
  WAVE:   ['TRI','SAW','PULSE','NOISE'],
  DUR:    [16,8,4],
  OCT:    [2,3,4,5],
  NOTE:   ['REST','C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
  // FILT_T includes NONE to allow “no filtering” per-voice; we union modes globally.
  FILT_T: ['NONE','LP','BP','HP','LP+BP','HP+BP'],
  ADSR:   Array.from({length:16}, (_,i)=>i)
};

function assert(cond, msg){ if(!cond) { throw new Error(`renderSid_poke: ${msg}`); } }

// ---------- music helpers ----------
const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PAL = 985248; // Hz
function midi(note, oct){ if(note==='REST')return null; const i=NOTE.indexOf(note); if(i<0)return 60; return 12*(oct+1)+i; }
function hz(note, oct){ const m=midi(note,oct); if(m==null)return null; return 440*Math.pow(2,(m-69)/12); }
function sidWord(f){ const w=Math.round((f*16777216)/PAL); return Math.max(0,Math.min(0xFFFF,w)); }
function nIdx(n){ const i=NOTE.indexOf(n); return i<0?255:i; }
function ctrlBase(w){ w=(w||'').toUpperCase(); if(w==='TRI')return 0x10; if(w==='SAW')return 0x20; if(w==='PULSE')return 0x40; if(w==='NOISE')return 0x80; return 0x20; }
function ad(a,d){ return ((a & 0xF) << 4) | (d & 0xF); }
function sr(s,r){ return ((s & 0xF) << 4) | (r & 0xF); }

// tempo → frames-per-beat at 50Hz
const bpm = song.bpm;
assert(ALLOWED.BPM.includes(bpm), 'bpm missing/invalid');
const ticksPerBeat = Math.max(1, Math.round((50*60)/bpm));
// durations: 4=quarter, 8=eighth, 16=sixteenth
function ticksFor(d){
  assert(ALLOWED.DUR.includes(Number(d)), `duration invalid: ${d}`);
  const mul=(d===4)?1:(d===8)?0.5:(d===16)?0.25:0.5;
  return Math.max(1, Math.round(ticksPerBeat*mul));
}

// ---------- strict input validation (no defaults) ----------
assert(ALLOWED.KEY.includes(song.key), 'key missing/invalid');
assert(ALLOWED.SCALE.includes(song.scale), 'scale missing/invalid');
assert(Array.isArray(song.voices) && song.voices.length===3, 'voices must be exactly 3');

const roles = new Set(song.voices.map(v=>v.role));
assert(roles.has('LEAD') && roles.has('BASS') && roles.has('ARP_OR_DRUMS'), 'must have LEAD, BASS, ARP_OR_DRUMS');

function collectPatternStrict(v, vi){
  // Either explicit pattern (64..192 steps) OR sections intro/development/cadence (each 16)
  if (Array.isArray(v.pattern) && v.pattern.length){
    assert(v.pattern.length>=64 && v.pattern.length<=192, `voice ${vi} pattern length must be 64..192`);
    return v.pattern;
  }
  const S = v.patternSections;
  assert(S && Array.isArray(S.intro) && Array.isArray(S.development) && Array.isArray(S.cadence),
         `voice ${vi} missing patternSections`);
  assert(S.intro.length===16 && S.development.length===16 && S.cadence.length===16,
         `voice ${vi} each section must have exactly 16 steps`);
  return ([]).concat(S.intro, S.development, S.cadence); // 48 steps; will loop
}

function voiceTablesStrict(v, vi){
  // Header fields (strict-ish)
  assert(ALLOWED.ROLE.includes(v.role), `voice ${vi} role invalid`);
  assert(ALLOWED.WAVE.includes(v.waveform), `voice ${vi} waveform invalid`);
  const a=v.adsr?.attack, d=v.adsr?.decay, s=v.adsr?.sustain, r=v.adsr?.release;
  assert([a,d,s,r].every(n=>Number.isInteger(n) && ALLOWED.ADSR.includes(n)), `voice ${vi} ADSR invalid`);

  // pulseWidth: only matters for PULSE; allow 0..4095 there; ignore otherwise
  const isPulse = (v.waveform||'').toUpperCase()==='PULSE';
  if (isPulse) {
    assert(Number.isInteger(v.pulseWidth) && v.pulseWidth>=0 && v.pulseWidth<=4095, `voice ${vi} pulseWidth invalid`);
  }

  // filter block: accept generator ranges; type must be from set (NONE allowed)
  assert(v.filter && ALLOWED.FILT_T.includes(v.filter.type), `voice ${vi} filter.type invalid`);
  assert(Number.isInteger(v.filter.cutoff) && v.filter.cutoff>=0 && v.filter.cutoff<=2047, `voice ${vi} filter.cutoff invalid`);
  assert(Number.isInteger(v.filter.resonance) && v.filter.resonance>=0 && v.filter.resonance<=15, `voice ${vi} filter.resonance invalid`);

  const raw = collectPatternStrict(v, vi);

  // Validate steps
  for (let i=0;i<raw.length;i++){
    const ev = raw[i];
    assert(ev && typeof ev==='object', `voice ${vi} step ${i} missing`);
    assert(ALLOWED.NOTE.includes(ev.note), `voice ${vi} step ${i} note invalid`);
    const isRest = String(ev.note).toUpperCase() === 'REST';
    const oct = Number(ev.octave);
    const octaveOk = isRest ? (oct === 0) : ALLOWED.OCT.includes(oct);
    assert(octaveOk, `voice ${vi} step ${i} octave invalid`);
    assert(ALLOWED.DUR.includes(Number(ev.duration)), `voice ${vi} step ${i} duration invalid`);
  }

  const MAX_STEPS = Math.min(192, Math.max(16, raw.length)); // strict: no padding
  const pat = raw.slice(0, MAX_STEPS);

  // First non-REST index (fallback 0 if all REST)
  let initStep = 0;
  for (let i=0;i<pat.length;i++){
    if ((pat[i].note||'').toUpperCase() !== 'REST') { initStep = i; break; }
  }

  return {
    notes: pat.map(ev=>nIdx(ev.note)),
    // For RESTs the octave is irrelevant; we still clamp for non-REST lookups.
    octs:  pat.map(ev=>Math.max(2,Math.min(5,ev.octave|0))),
    tix:   pat.map(ev=>ticksFor(ev.duration|0)),
    AD: ad((v.adsr.attack|0), (v.adsr.decay|0)),
    SR: sr((v.adsr.sustain|0), (v.adsr.release|0)),
    CTRL_BASE: ctrlBase(v.waveform),
    // Only meaningful for PULSE; others leave PW null.
    PW: isPulse ? (v.pulseWidth|0) : null,
    INIT_STEP: initStep,
    LEN: pat.length,
    _filter: { type: v.filter.type, cutoff: v.filter.cutoff|0, resonance: v.filter.resonance|0 }
  };
}

// freq table for octaves 2..5
const freqWords=[]; for(let o=2;o<=5;o++){ for(let i=0;i<12;i++){ freqWords.push(sidWord(hz(NOTE[i],o))); } }
const freqLo=freqWords.map(w=>w&0xFF), freqHi=freqWords.map(w=>w>>8);

const vT = song.voices.map(voiceTablesStrict);

// ---------- derive global filter from per-voice wishes ----------
function deriveFilterGlobal(vtab) {
  // $D418 bits 4..6: LP/BP/HP, low nibble: volume
  // $D417 low nibble: route V0/V1/V2/EXT, high nibble: resonance
  // $D415/$D416: 11-bit cutoff (low 8, high 3)
  let modeBits = 0; // $D418 bits 4..6
  let routeBits = 0; // $D417 bits 0..2
  let resMax = 0;
  const cutoffs = [];

  function want(type, voiceIndex) {
    const T = (type||'NONE').toUpperCase();
    if (T==='NONE') return;
    // union modes
    if (T.includes('LP')) modeBits |= 0x10;
    if (T.includes('BP')) modeBits |= 0x20;
    if (T.includes('HP')) modeBits |= 0x40;
    // route this voice into the filter
    routeBits |= (1 << voiceIndex);
  }

  vtab.forEach((t, i) => {
    const { type, cutoff, resonance } = t._filter;
    want(type, i);
    resMax = Math.max(resMax, resonance|0);
    if (type && type.toUpperCase() !== 'NONE') cutoffs.push(cutoff|0);
  });

  const cutoff = cutoffs.length ? Math.round(cutoffs.reduce((a,b)=>a+b,0)/cutoffs.length) : 0;
  const c11 = Math.max(0, Math.min(2047, cutoff));
  const cutLo = c11 & 0xFF;
  const cutHi = (c11 >> 8) & 0x07;

  const d417 = ((resMax & 0x0F) << 4) | (routeBits & 0x0F);
  const volBase = modeBits & 0x70; // keep only LP/BP/HP bits; OR with volume later

  return { cutLo, cutHi, d417, volBase };
}

const FCFG = deriveFilterGlobal(vT);

// ---------- hex helpers ----------
const hx  = (n)=> (n&0xFF).toString(16).padStart(2,'0');
const IMM = (n)=> '#$'+hx(n);
const LIT = (n)=> '$'+hx(n);
const bytes  = (arr)=>arr.map(x=>LIT(x)).join(',');
const bytesFF= (arr)=>arr.map(n=>n===255?'$ff':LIT(n)).join(',');

// ---------- shared music tick (volume ramp) ----------
function emitTickBodyAsm() {
  let a = '';
  a += `
; --- shared music tick ---
DoTick:
  ; ramp volume while preserving filter mode bits in $D418
  LDA vol_ctr
  CMP #$10
  BCS DoVoices
  ORA vol_base
  STA $D418
  INC vol_ctr

DoVoices:
`;
  function voiceBlock(i){
    return `
; voice ${i}
  DEC v${i}_ticks
  BNE v${i}_done
v${i}_trig:
  LDX v${i}_step
  LDA v${i}_notes,x
  CMP #$FF
  BEQ v${i}_rest

  TAY
  STY v${i}_note_tmp

  LDA v${i}_octs,x
  SEC
  SBC #$02
  TAX
  LDA octMul12,x
  CLC
  ADC v${i}_note_tmp
  TAY
  LDA freq_lo,y
  STA V${i}_FLO
  LDA freq_hi,y
  STA V${i}_FHI

  LDA v${i}_ctrl_base
  ORA #$01
  STA V${i}_CTRL
  JMP v${i}_dur

v${i}_rest:
  LDA v${i}_ctrl_base
  AND #$FE
  STA V${i}_CTRL

v${i}_dur:
  LDX v${i}_step
  LDA v${i}_ticks_tbl,x
  STA v${i}_ticks
  INX
  CPX v${i}_len
  BCC v${i}_next
  LDX #$00
v${i}_next:
  STX v${i}_step
v${i}_done:
`;
  }
  a += voiceBlock(0)+voiceBlock(1)+voiceBlock(2);
  a += `
  RTS

octMul12: .byte 0,12,24,36

; freq tables (octaves 2..5)
freq_lo: .byte ${bytes(freqLo)}
freq_hi: .byte ${bytes(freqHi)}

; data tables
v0_notes: .byte ${bytesFF(vT[0].notes)}
v0_octs:  .byte ${bytes(vT[0].octs)}
v0_ticks_tbl: .byte ${bytes(vT[0].tix)}

v1_notes: .byte ${bytesFF(vT[1].notes)}
v1_octs:  .byte ${bytes(vT[1].octs)}
v1_ticks_tbl: .byte ${bytes(vT[1].tix)}

v2_notes: .byte ${bytesFF(vT[2].notes)}
v2_octs:  .byte ${bytes(vT[2].octs)}
v2_ticks_tbl: .byte ${bytes(vT[2].tix)}

; state
v0_step      .byte 0
v1_step      .byte 0
v2_step      .byte 0
v0_ticks     .byte 0
v1_ticks     .byte 0
v2_ticks     .byte 0
v0_note_tmp  .byte 0
v1_note_tmp  .byte 0
v2_note_tmp  .byte 0
vol_ctr      .byte 0
vol_base     .byte ${LIT(FCFG.volBase)}
v0_ctrl_base .byte ${LIT(vT[0].CTRL_BASE)}
v1_ctrl_base .byte ${LIT(vT[1].CTRL_BASE)}
v2_ctrl_base .byte ${LIT(vT[2].CTRL_BASE)}
v0_len       .byte ${LIT(vT[0].LEN)}
v1_len       .byte ${LIT(vT[1].LEN)}
v2_len       .byte ${LIT(vT[2].LEN)}
`;
  return a;
}

// ---------- equates ----------
function emitCommonEquates() {
  return `
; VIC + IRQ
VIC_RASTER   = $D012
VIC_CTRL1    = $D011
VIC_IRQSTAT  = $D019
VIC_IRQEN    = $D01A
KERNAL_IRQLO = $0314
KERNAL_IRQHI = $0315

; Voice 0
V0_FLO  = $D400
V0_FHI  = $D401
V0_PWLO = $D402
V0_PWHI = $D403
V0_CTRL = $D404
V0_AD   = $D405
V0_SR   = $D406

; Voice 1
V1_FLO  = $D407
V1_FHI  = $D408
V1_PWLO = $D409
V1_PWHI = $D40A
V1_CTRL = $D40B
V1_AD   = $D40C
V1_SR   = $D40D

; Voice 2
V2_FLO  = $D40E
V2_FHI  = $D40F
V2_PWLO = $D410
V2_PWHI = $D411
V2_CTRL = $D412
V2_AD   = $D413
V2_SR   = $D414
`;
}

// ---------- init bodies ----------
function emitInitBody({ includeIrq }) {
  let a = '';

  if (includeIrq) {
    a += `
  SEI
  LDA #$7F
  STA $DC0D
  STA $DD0D
  BIT $DC0D
  BIT $DD0D
  LDA #<Irq
  STA KERNAL_IRQLO
  LDA #>Irq
  STA KERNAL_IRQHI
  LDA VIC_CTRL1
  AND #$7F
  STA VIC_CTRL1
  LDA #$20
  STA VIC_RASTER
  LDA #$01
  STA VIC_IRQEN
  LDA #$01
  STA VIC_IRQSTAT
`;
  }

  // --- Global filter setup ---
  // $D415 (cutoff low), $D416 (cutoff high 3 bits), $D417 (resonance+routing)
  a += `
  LDA ${IMM(FCFG.cutLo)}
  STA $D415
  LDA ${IMM(FCFG.cutHi)}
  STA $D416
  LDA ${IMM(FCFG.d417)}
  STA $D417
`;

  for (let i = 0; i < 3; i++) {
    const t = vT[i];
    const pwlo = t.PW != null ? (t.PW & 0xFF) : 0;
    const pwhi = t.PW != null ? ((t.PW >> 8) & 0x0F) : 0;

    a += `
  ; voice ${i} ADSR/CTRL${t.PW != null ? ' + PW' : ''}
  LDA ${IMM(t.AD)}
  STA V${i}_AD
  LDA ${IMM(t.SR)}
  STA V${i}_SR
  LDA ${IMM(t.CTRL_BASE)}
  STA V${i}_CTRL
`;
    if (t.PW != null) {
      a += `  LDA ${IMM(pwlo)}
  STA V${i}_PWLO
  LDA ${IMM(pwhi)}
  STA V${i}_PWHI
`;
    }
  }

  a += `
  LDA ${IMM(vT[0].INIT_STEP & 0xFF)}
  STA v0_step
  LDA ${IMM(vT[1].INIT_STEP & 0xFF)}
  STA v1_step
  LDA ${IMM(vT[2].INIT_STEP & 0xFF)}
  STA v2_step
`;

  function primeVoice(i){
    return `
  ; --- Prime voice ${i} once at init ---
  LDX v${i}_step
  LDA v${i}_notes,x
  CMP #$FF
  BEQ v${i}_prime_rest

  TAY
  STY v${i}_note_tmp

  LDA v${i}_octs,x
  SEC
  SBC #$02
  TAX
  LDA octMul12,x
  CLC
  ADC v${i}_note_tmp
  TAY
  LDA freq_lo,y
  STA V${i}_FLO
  LDA freq_hi,y
  STA V${i}_FHI

  LDA v${i}_ctrl_base
  ORA #$01
  STA V${i}_CTRL
  JMP v${i}_prime_setdur

v${i}_prime_rest:
  LDA v${i}_ctrl_base
  AND #$FE
  STA V${i}_CTRL

v${i}_prime_setdur:
  LDX v${i}_step
  LDA v${i}_ticks_tbl,x
  STA v${i}_ticks
`;
  }
  a += primeVoice(0) + primeVoice(1) + primeVoice(2);

  a += `
  LDA #$00
  STA vol_ctr
`;

  return a;
}

// ---------- PRG ASM ----------
function emitPrgAsm() {
  let a = '';
  a += `* = $0801
.word $080b
.word 10
.byte $9e
.text "2064"
.byte 0

* = $0810
`;
  a += emitCommonEquates();
  a += `
Start:
`;
  a += emitInitBody({ includeIrq: true });
  a += `
  CLI
Forever:
  JMP Forever

Irq:
  PHA
  TXA
  PHA
  TYA
  PHA
  LDA VIC_IRQSTAT
  STA VIC_IRQSTAT
  JSR DoTick
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI
`;
  a += emitTickBodyAsm();
  return a;
}

// ---------- SID ASM ----------
function emitSidAsm() {
  let a = '';
  a += `* = $1000
`;
  a += emitCommonEquates();
  a += `
Init:
  JMP RealInit         ; exactly 3 bytes at $1000..$1002

* = $1003
Play:
  PHA
  TXA
  PHA
  TYA
  PHA
  JSR DoTick
  PLA
  TAY
  PLA
  TAX
  PLA
  RTS

RealInit:
`;
  a += emitInitBody({ includeIrq: false });
  a += `
  RTS
`;
  a += emitTickBodyAsm();
  return a;
}

// ---------- Write ASM files ----------
const baseDir = path.dirname(prgAsmOut);
const baseName = path.basename(prgAsmOut).replace(/\.asm$/i,'');
const sidAsmOut = path.join(baseDir, baseName + '_sid.asm');
const sidPrgOut = path.join(baseDir, baseName + '_sid.prg');
const sidOut    = path.join(baseDir, baseName + '.sid');

fs.writeFileSync(prgAsmOut, emitPrgAsm(), 'utf8');
fs.writeFileSync(sidAsmOut, emitSidAsm(), 'utf8');
console.log(`Wrote ${prgAsmOut}`);
console.log(`Wrote ${sidAsmOut}`);

// ---------- Assemble + wrap ----------
function haveCmd(cmd){ return spawnSync('bash',['-lc',`command -v ${cmd}`]).status===0; }
if (!haveCmd('xa')) {
  console.error('WARN: xa not found in PATH; skipping .sid build.');
  process.exit(0);
}

const a1 = spawnSync('xa', ['-v', sidAsmOut, '-o', sidPrgOut], {stdio:'inherit'});
if (a1.status !== 0) {
  console.error('xa failed on SID-core; .sid not produced.');
  process.exit(1);
}

// Read the assembler output
let prg = fs.readFileSync(sidPrgOut);

// Ensure the PRG begins with the 2-byte load address $1000 (00 10).
let core = prg;
if (!(core[0] === 0x00 && core[1] === 0x10)) {
  core = Buffer.concat([Buffer.from([0x00, 0x10]), core]);
}

// --- PSID v2 header (0x76 bytes), big-endian ---
function writeAsciiPad(buf, off, len, s){
  const t = Buffer.from((s||'').toString().slice(0,len), 'ascii');
  t.copy(buf, off);
  for (let i=t.length; i<len; i++) buf[off+i]=0;
}

const hdr = Buffer.alloc(0x76, 0);
hdr.write('PSID', 0, 'ascii');
hdr.writeUInt16BE(0x0002, 0x04);    // version 2
hdr.writeUInt16BE(0x0076, 0x06);    // dataOffset 0x76
hdr.writeUInt16BE(0x0000, 0x08);    // loadAddress=0 (use first 2 bytes of core)
hdr.writeUInt16BE(0x1000, 0x0A);    // Init
hdr.writeUInt16BE(0x1003, 0x0C);    // Play
hdr.writeUInt16BE(0x0001, 0x0E);    // songs
hdr.writeUInt16BE(0x0001, 0x10);    // startSong
hdr.writeUInt32BE(0x00000000, 0x12);// speed = 50Hz
writeAsciiPad(hdr, 0x16, 32, song.title    || 'COTG Theme');
writeAsciiPad(hdr, 0x36, 32, song.author   || 'Unknown');
writeAsciiPad(hdr, 0x56, 32, song.released || '');

// Write final SID (header + PRG-with-$1000)
fs.writeFileSync(sidOut, Buffer.concat([hdr, core]));
console.log(`Wrote ${sidOut}`);
