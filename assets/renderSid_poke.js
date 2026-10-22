#!/usr/bin/env node
// --- DROP-IN REPLACEMENT ---
// Build PRG-oriented ASM AND a PSID-ready ASM + .sid (no defaults, strict).
// Uses xa when available; the bundled strict assembler covers this emitted player.

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
  DUR:    [16,8,4,2,1],   // 2 = half, 1 = whole: held notes (long-form composer); max 16 x t16 ticks <= 255
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
  // Derive every duration from ONE sixteenth unit so all 3 voices stay locked in sync
  // (rounding quarter/eighth separately made voices drift apart over a loop).
  const t16 = Math.max(2, Math.round(ticksPerBeat/4));
  const mul=(d===1)?16:(d===2)?8:(d===4)?4:(d===8)?2:(d===16)?1:2;
  return Math.min(255, t16*mul);
}

// ---------- strict input validation (no defaults) ----------
assert(ALLOWED.KEY.includes(song.key), 'key missing/invalid');
assert(ALLOWED.SCALE.includes(song.scale), 'scale missing/invalid');
assert(Array.isArray(song.voices) && song.voices.length===3, 'voices must be exactly 3');

const roles = new Set(song.voices.map(v=>v.role));
assert(roles.has('LEAD') && roles.has('BASS') && roles.has('ARP_OR_DRUMS'), 'must have LEAD, BASS, ARP_OR_DRUMS');

// ---------- voice data: tracker-style PATTERNS + ORDER lists ----------
// New format (preferred): voice.patterns = [[{note,octave,duration,chord?,wave?}...], ...] and voice.order = [patternIndex,...]
// Old format still accepted: voice.pattern (flat) or voice.patternSections; it is chunked into patterns.
// There is no song-length cap any more: an order list can hold up to 254 entries and patterns are reused.
function validateEvent(ev, vi, i){
  if (ev && ev.cmd) { // zero-time command steps: instrument change or filter setting
    assert(ev.cmd==='inst' || ev.cmd==='filter', `voice ${vi} step ${i} unknown cmd ${ev.cmd}`);
    if (ev.cmd==='inst') { assert(ALLOWED.WAVE.includes(ev.waveform), `voice ${vi} step ${i} inst waveform invalid`);
      const q=ev.adsr||{}; assert([q.attack,q.decay,q.sustain,q.release].every(n=>Number.isInteger(n)&&n>=0&&n<=15), `voice ${vi} step ${i} inst adsr invalid`); }
    return;
  }
  assert(ev && typeof ev==='object', `voice ${vi} step ${i} missing`);
  assert(ALLOWED.NOTE.includes(ev.note), `voice ${vi} step ${i} note invalid`);
  const isRest = String(ev.note).toUpperCase() === 'REST';
  const oct = Number(ev.octave);
  assert(isRest ? true : ALLOWED.OCT.includes(oct), `voice ${vi} step ${i} octave invalid`);
  assert(ALLOWED.DUR.includes(Number(ev.duration)), `voice ${vi} step ${i} duration invalid`);
}
function collectPatternsStrict(v, vi){
  if (Array.isArray(v.patterns) && Array.isArray(v.order) && v.patterns.length && v.order.length){
    assert(v.order.length <= 4000, `voice ${vi} order list too long (max 4000)`); // 16-bit order pointer: ~10+ minute songs
    v.order.forEach(k => assert(Number.isInteger(k) && k>=0 && k<v.patterns.length, `voice ${vi} order entry ${k} invalid`));
    v.patterns.forEach((p,pi) => { assert(Array.isArray(p) && p.length>=1 && p.length<=60, `voice ${vi} pattern ${pi} must have 1..60 steps`); p.forEach((ev,i)=>validateEvent(ev,vi,i)); });
    return { patterns: v.patterns, order: v.order };
  }
  let raw;
  if (Array.isArray(v.pattern) && v.pattern.length) raw = v.pattern;
  else {
    const S = v.patternSections;
    assert(S && Array.isArray(S.intro) && Array.isArray(S.development) && Array.isArray(S.cadence), `voice ${vi} missing patterns/order, pattern or patternSections`);
    raw = [].concat(S.intro, S.development, S.cadence);
  }
  raw.forEach((ev,i)=>validateEvent(ev,vi,i));
  const patterns = []; for (let i=0;i<raw.length;i+=48) patterns.push(raw.slice(i,i+48));
  return { patterns, order: patterns.map((_,i)=>i) };
}

function voiceTablesStrict(v, vi){
  assert(ALLOWED.ROLE.includes(v.role), `voice ${vi} role invalid`);
  assert(ALLOWED.WAVE.includes(v.waveform), `voice ${vi} waveform invalid`);
  const a=v.adsr?.attack, d=v.adsr?.decay, s=v.adsr?.sustain, r=v.adsr?.release;
  assert([a,d,s,r].every(n=>Number.isInteger(n) && ALLOWED.ADSR.includes(n)), `voice ${vi} ADSR invalid`);
  const isPulse = (v.waveform||'').toUpperCase()==='PULSE';
  if (isPulse) assert(Number.isInteger(v.pulseWidth) && v.pulseWidth>=0 && v.pulseWidth<=4095, `voice ${vi} pulseWidth invalid`);
  assert(v.filter && ALLOWED.FILT_T.includes(v.filter.type), `voice ${vi} filter.type invalid`);
  assert(Number.isInteger(v.filter.cutoff) && v.filter.cutoff>=0 && v.filter.cutoff<=2047, `voice ${vi} filter.cutoff invalid`);
  assert(Number.isInteger(v.filter.resonance) && v.filter.resonance>=0 && v.filter.resonance<=15, `voice ${vi} filter.resonance invalid`);
  const { patterns, order } = collectPatternsStrict(v, vi);
  return {
    patterns, order,
    AD: ad((v.adsr.attack|0), (v.adsr.decay|0)),
    SR: sr((v.adsr.sustain|0), (v.adsr.release|0)),
    CTRL_BASE: ctrlBase(v.waveform),
    // PW is initialised for every voice so a later instrument change to PULSE is audible
    PW: isPulse ? (v.pulseWidth|0) : 2048,
    PWM: isPulse ? Math.max(0, Math.min(255, Number(v.pwmSpeed)|0)) : 0,   // optional pulse-width sweep
    VIB: !!v.vibrato,                                                        // optional delayed vibrato (lead)
    _filter: { type: v.filter.type, cutoff: v.filter.cutoff|0, resonance: v.filter.resonance|0 }
  };
}

// freq table for octaves 2..6 (octave 6 only reached by arpeggio offsets)
const freqWords=[]; for(let o=2;o<=6;o++){ for(let i=0;i<12;i++){ freqWords.push(sidWord(hz(NOTE[i],o))); } }
const freqLo=freqWords.map(w=>w&0xFF), freqHi=freqWords.map(w=>w>>8);

const vT = song.voices.map(voiceTablesStrict);

// chord-shape table for per-frame arpeggios (voice 3). Shape 0 = none; shape k lives at offset k*3.
const arpShapes = [[0,0,0]]; const shapeKey = new Map();
function shapeOffset(chord){
  if (!Array.isArray(chord) || chord.length!==3) return 0;
  const c = chord.map(n=>Math.max(0,Math.min(12,n|0))); const k=c.join(',');
  if (!shapeKey.has(k)) { if (arpShapes.length>=80) return 0; shapeKey.set(k, arpShapes.length); arpShapes.push(c); }
  return shapeKey.get(k)*3;
}
// Encode every pattern as 4 bytes per step: [freqIndex|$FF rest, ticks, arpShapeOffset, waveOverride], $FE = end.
// Identical patterns (across all voices) are stored once.
const PAT_BYTES = []; const patKey = new Map(); const VOICE_PATS = [];
const ORDERS = vT.map((t, vi) => {
  const localToGlobal = t.patterns.map(p => {
    const bytesArr = [];
    for (const ev of p) {
      if (ev.cmd === 'inst') { const q = ev.adsr; bytesArr.push(0xFD, ad(q.attack,q.decay), sr(q.sustain,q.release), ctrlBase(ev.waveform)); continue; }
      if (ev.cmd === 'filter') {
        const route = (Array.isArray(ev.route)?ev.route:[]).reduce((m,k)=>m|(1<<(k&3)),0) & 7;
        bytesArr.push(0xFC, Math.max(0,Math.min(255,(ev.cutoff|0)>>3)), (Math.max(-16,Math.min(16,ev.sweep|0)))&0xFF, ((Math.max(0,Math.min(15,ev.resonance|0)))<<4)|route);
        continue;
      }
      const rest = String(ev.note).toUpperCase()==='REST';
      const fidx = rest ? 0xFF : (Math.max(2,Math.min(5,ev.octave|0))-2)*12 + nIdx(ev.note);
      bytesArr.push(fidx, ticksFor(ev.duration|0), (vi===2 && !rest) ? shapeOffset(ev.chord) : 0,
                    (vi===2 && !rest && String(ev.wave||'').toUpperCase()==='NOISE') ? 0x80 : 0);
    }
    bytesArr.push(0xFE);
    const k = bytesArr.join(',');
    if (!patKey.has(k)) { patKey.set(k, PAT_BYTES.length); PAT_BYTES.push(bytesArr); }
    return patKey.get(k);
  });
  // per-voice pattern table (order entries index it; up to 255 patterns per voice, storage shared across voices)
  const used = []; const usedIdx = new Map();
  const order = t.order.map(i => { const g = localToGlobal[i]; if (!usedIdx.has(g)) { usedIdx.set(g, used.length); used.push(g); } return usedIdx.get(g); });
  assert(used.length <= 255, `voice ${vi} has too many unique patterns (${used.length}, max 255)`);
  VOICE_PATS[vi] = used;
  return order;
});
const HAS_ARP = arpShapes.length > 1;
// subtune start points: order positions where every voice begins a command-only pattern (a movement start)
const isCmdOnly = (vi, pos) => { const pat = vT[vi].patterns[vT[vi].order[pos]]; return Array.isArray(pat) && pat.length && pat.every(ev => ev && ev.cmd); };
const SUBTUNE_STARTS = [0];
for (let pos = 1; pos < vT[0].order.length && SUBTUNE_STARTS.length < 32; pos++) {
  if ([0,1,2].every(vi => pos < vT[vi].order.length && isCmdOnly(vi, pos))) SUBTUNE_STARTS.push(pos);
}
const HAS_VIB = vT[0].VIB;
// ---------- derive global filter from per-voice wishes ----------
function deriveFilterGlobal(vtab) {
  // $D418 bits 4..6: LP/BP/HP, low nibble: volume
  // $D417 low nibble: route V0/V1/V2/EXT, high nibble: resonance
  // $D415/$D416: 11-bit cutoff (low 3 bits, high 8 bits).
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
  const cutLo = c11 & 0x07;
  const cutHi = (c11 >> 3) & 0xFF;

  const d417 = ((resMax & 0x0F) << 4) | (routeBits & 0x0F);
  const volBase = modeBits & 0x70; // keep only LP/BP/HP bits; OR with volume later

  return { cutLo, cutHi, d417, volBase };
}

const FCFG = deriveFilterGlobal(vT);

// ---------- hex helpers ----------
const hx  = (n)=> (n&0xFF).toString(16).padStart(2,'0');
const IMM = (n)=> '#$'+hx(n);
const LIT = (n)=> '$'+hx(n);
// xa limits source-line length; long suites must split data without changing addresses.
const byteList = tokens => tokens.map((value, index) => (index ? index % 16 ? ',' : '\n  .byte ' : '') + value).join('');
const bytes  = (arr)=>byteList(arr.map(x=>LIT(x)));
const bytesFF= (arr)=>arr.map(n=>n===255?'$ff':LIT(n)).join(',');

// ---------- shared music tick ----------
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
  // --- optional PWM sweeps (bounce PW between $200 and $E00) ---
  for (let i=0;i<3;i++){
    const t=vT[i]; if (!t.PWM) continue;
    a += `
  LDA v${i}_pwdir
  BNE v${i}_pwdown
  CLC
  LDA v${i}_pwlo
  ADC #${t.PWM}
  STA v${i}_pwlo
  LDA v${i}_pwhi
  ADC #$00
  STA v${i}_pwhi
  CMP #$0E
  BCC v${i}_pwset
  LDA #$01
  STA v${i}_pwdir
  JMP v${i}_pwset
v${i}_pwdown:
  SEC
  LDA v${i}_pwlo
  SBC #${t.PWM}
  STA v${i}_pwlo
  LDA v${i}_pwhi
  SBC #$00
  STA v${i}_pwhi
  CMP #$02
  BCS v${i}_pwset
  LDA #$00
  STA v${i}_pwdir
v${i}_pwset:
  LDA v${i}_pwlo
  STA V${i}_PWLO
  LDA v${i}_pwhi
  STA V${i}_PWHI
`;
  }
  function voiceBlock(i){
    const ZP = `ZP${i}`;
    return `
; voice ${i}
  DEC v${i}_ticks
  BEQ v${i}_trig
  ; hard-restart style gap - release gate one frame before the next note
  LDA v${i}_ticks
  CMP #$01
  BNE v${i}_skip
  LDA v${i}_ctrl_base
  AND #$FE
  STA V${i}_CTRL
v${i}_skip:
  JMP v${i}_done
v${i}_trig:
  LDY v${i}_pos
v${i}_read:
  LDA (${ZP}),Y
  CMP #$FE
  BNE v${i}_chk
  ; end of pattern - advance the 16-bit order pointer, FF loops to the start
  INC ZO${i}
  BNE v${i}_ordok
  INC ZO${i}+1
v${i}_ordok:
  LDY #$00
  LDA (ZO${i}),Y
  CMP #$FF
  BNE v${i}_setpat
  LDA #<v${i}_order
  STA ZO${i}
  LDA #>v${i}_order
  STA ZO${i}+1
  LDA (ZO${i}),Y
v${i}_setpat:
  TAX
  LDA v${i}_pat_lo,x
  STA ${ZP}
  LDA v${i}_pat_hi,x
  STA ${ZP}+1
  LDY #$00
  JMP v${i}_read
v${i}_chk:
  CMP #$FD
  BNE v${i}_chk2
  ; instrument change - AD, SR, waveform
  INY
  LDA (${ZP}),Y
  STA V${i}_AD
  INY
  LDA (${ZP}),Y
  STA V${i}_SR
  INY
  LDA (${ZP}),Y
  STA v${i}_ctrl_base
  INY
  JMP v${i}_read
v${i}_chk2:
  CMP #$FC
  BNE v${i}_have
  ; filter setting - cutoff high byte, sweep per frame, resonance and routing
  INY
  LDA (${ZP}),Y
  STA filt_cut
  STA $D416
  INY
  LDA (${ZP}),Y
  STA filt_sweep
  INY
  LDA (${ZP}),Y
  STA $D417
  LDA vol_base
  ORA #$10
  STA vol_base
  LDA vol_ctr
  CMP #$10
  BCC v${i}_filter_fade
  LDA #$0F
v${i}_filter_fade:
  ORA vol_base
  STA $D418
  INY
  JMP v${i}_read
v${i}_have:
  CMP #$FF
  BEQ v${i}_rest
  TAX
  STX v${i}_base
  LDA freq_lo,x
  STA V${i}_FLO
  LDA freq_hi,x
  STA V${i}_FHI
  LDA v${i}_ctrl_base
  ORA #$01
  STA V${i}_CTRL
${i===0 ? `  LDA #$00
  STA v0_vibt
` : ''}  JMP v${i}_dur
v${i}_rest:
  LDA v${i}_ctrl_base
  AND #$FE
  STA V${i}_CTRL
v${i}_dur:
  INY
  LDA (${ZP}),Y
  STA v${i}_ticks
  INY
${i===2 ? `  LDA (${ZP}),Y
  STA v2_cur_shape
  LDA #$00
  STA v2_arppos
` : ''}  INY
${i===2 ? `  LDA (${ZP}),Y
  BEQ v2_nowave
  ORA #$01
  STA V2_CTRL
v2_nowave:
` : ''}  INY
  STY v${i}_pos
v${i}_done:
`;
  }
  a += voiceBlock(0)+voiceBlock(1)+voiceBlock(2);
  a += `
; --- filter sweep (bounces between the ends of the cutoff range) ---
  LDA filt_sweep
  BEQ fs_done
  BMI fs_down
  CLC
  ADC filt_cut
  BCC fs_store
  JMP fs_flip
fs_down:
  CLC
  ADC filt_cut
  BCS fs_store
fs_flip:
  LDA #$00
  SEC
  SBC filt_sweep
  STA filt_sweep
  JMP fs_done
fs_store:
  STA filt_cut
  STA $D416
fs_done:
`;
  if (HAS_ARP) a += `
; --- per-frame chord arpeggio on voice 2 (50Hz cycle through 3 chord tones) ---
  LDA v2_cur_shape
  BEQ arp_done
  CLC
  ADC v2_arppos
  TAX
  LDA arp_offs,x
  CLC
  ADC v2_base
  TAY
  LDA freq_lo,y
  STA V2_FLO
  LDA freq_hi,y
  STA V2_FHI
  LDX v2_arppos
  INX
  CPX #$03
  BCC arp_store
  LDX #$00
arp_store:
  STX v2_arppos
arp_done:
`;
  if (HAS_VIB) a += `
; --- delayed vibrato on the lead (voice 0) ---
  INC v0_vibt
  LDA v0_vibt
  CMP #$0C
  BCC vib_done
  AND #$07
  TAX
  LDY v0_base
  LDA freq_hi,y
  STA v0_vdelta
  LDA vib_dir,x
  BEQ vib_base
  CMP #$01
  BNE vib_minus
  CLC
  LDA freq_lo,y
  ADC v0_vdelta
  STA V0_FLO
  LDA freq_hi,y
  ADC #$00
  STA V0_FHI
  JMP vib_done
vib_minus:
  SEC
  LDA freq_lo,y
  SBC v0_vdelta
  STA V0_FLO
  LDA freq_hi,y
  SBC #$00
  STA V0_FHI
  JMP vib_done
vib_base:
  LDA freq_lo,y
  STA V0_FLO
  LDA freq_hi,y
  STA V0_FHI
vib_done:
`;
  a += `
  RTS

; freq tables (octaves 2..6)
freq_lo: .byte ${bytes(freqLo)}
freq_hi: .byte ${bytes(freqHi)}
arp_offs: .byte ${bytes(arpShapes.flat())}
vib_dir:  .byte 0,1,1,0,0,2,2,0

; order lists - pattern numbers - FF loops
${[0,1,2].map(i=>`v${i}_order: .byte ${bytes(ORDERS[i].concat([0xFF]))}`).join('\n')}

; pattern pointer table
${[0,1,2].map(i=>`v${i}_pat_lo: .byte ${byteList(VOICE_PATS[i].map(k=>'<pat'+k))}\nv${i}_pat_hi: .byte ${byteList(VOICE_PATS[i].map(k=>'>pat'+k))}`).join('\n')}

; patterns - 4 bytes per step - freq index or FF rest - ticks - arp shape - wave override - FE ends
${PAT_BYTES.map((b,k)=>`pat${k}: .byte ${bytes(b)}`).join('\n')}

; state
filt_cut     .byte ${LIT(FCFG.cutHi)}
filt_sweep   .byte 0
song_no      .byte 0
start_lo     .byte ${bytes(SUBTUNE_STARTS.map(x=>x&0xFF))}
start_hi     .byte ${bytes(SUBTUNE_STARTS.map(x=>(x>>8)&0xFF))}
v0_pos       .byte 0
v1_pos       .byte 0
v2_pos       .byte 0
v0_ticks     .byte 0
v1_ticks     .byte 0
v2_ticks     .byte 0
v0_base      .byte 0
v1_base      .byte 0
v2_base      .byte 0
v0_vibt      .byte 0
v0_vdelta    .byte 0
v2_cur_shape .byte 0
v2_arppos    .byte 0
vol_ctr      .byte 0
vol_base     .byte ${LIT(FCFG.volBase)}
v0_ctrl_base .byte ${LIT(vT[0].CTRL_BASE)}
v1_ctrl_base .byte ${LIT(vT[1].CTRL_BASE)}
v2_ctrl_base .byte ${LIT(vT[2].CTRL_BASE)}
${[0,1,2].map(i=>{ const pw=(vT[i].PW||0); return `v${i}_pwlo .byte ${LIT(pw&0xFF)}\nv${i}_pwhi .byte ${LIT(Math.max(2,Math.min(13,(pw>>8)&0x0F)))}\nv${i}_pwdir .byte 0`; }).join('\n')}
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

; zero-page pattern pointers (one 16-bit pointer per voice)
ZO0 = $F1
ZO1 = $F3
ZO2 = $F5
ZP0 = $F7
ZP1 = $F9
ZP2 = $FB

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

function emitInitBody({ includeIrq }) {
  let a = '';
  // PSID passes the 0-based subtune number in A. Subtune 1 = whole song from the start; subtunes 2..N start at
  // movement boundaries (used for parallel rendering and for jumping to a theme in a SID player).
  a += includeIrq ? `
  LDA #$00
  STA song_no
` : `
  STA song_no
`;

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

  // start every voice at order position 0, pattern step 0; first tick triggers the first note
  for (let i = 0; i < 3; i++) {
    a += `
  LDX song_no
  CLC
  LDA #<v${i}_order
  ADC start_lo,x
  STA ZO${i}
  LDA #>v${i}_order
  ADC start_hi,x
  STA ZO${i}+1
  LDY #$00
  STY v${i}_pos
  LDA (ZO${i}),Y
  TAX
  LDA v${i}_pat_lo,x
  STA ZP${i}
  LDA v${i}_pat_hi,x
  STA ZP${i}+1
  LDA #$01
  STA v${i}_ticks
`;
  }
  a += `
  LDA #$00
  STA vol_ctr
  STA v2_cur_shape
  LDA song_no
  BEQ init_ramp
  ; later subtunes start at full volume (no fade-in) so rendered chunks join seamlessly
  LDA #$10
  STA vol_ctr
  LDA vol_base
  ORA #$0F
  STA $D418
init_ramp:
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
function haveCmd(cmd) {
  const probe = process.platform === 'win32'
    ? spawnSync('where.exe', [cmd], { stdio: 'ignore' })
    : spawnSync('sh', ['-lc', `command -v "${cmd}" >/dev/null 2>&1`], { stdio: 'ignore' });
  return probe.status === 0;
}
let prg;
if (haveCmd('xa')) {
  const a1 = spawnSync('xa', ['-v', sidAsmOut, '-o', sidPrgOut], {stdio:'inherit'});
  if (a1.status !== 0) throw Error('xa failed on SID-core; .sid not produced.');
  prg = fs.readFileSync(sidPrgOut);
} else {
  const assembled = require('../retort/sidAssembler').assemble(emitSidAsm());
  if (assembled.loadAddress !== 0x1000 || assembled.symbols.Play !== 0x1003) throw Error('Invalid SID entry points');
  prg = assembled.data;
  console.log('SID core assembled with the bundled 6502 subset assembler.');
}

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
hdr.writeUInt16BE(0x0001, 0x04);    // version 1: a 0x76-byte header is the v1 layout. As 'v2' (needs 0x7C) sidplayfp read the
                                    // first code bytes as relocation fields and rejected songs whose data passed $4C00.
hdr.writeUInt16BE(0x0076, 0x06);    // dataOffset 0x76
hdr.writeUInt16BE(0x0000, 0x08);    // loadAddress=0 (use first 2 bytes of core)
hdr.writeUInt16BE(0x1000, 0x0A);    // Init
hdr.writeUInt16BE(0x1003, 0x0C);    // Play
hdr.writeUInt16BE(SUBTUNE_STARTS.length, 0x0E);    // songs (1 = full song, 2.. = movements)
hdr.writeUInt16BE(0x0001, 0x10);    // startSong
hdr.writeUInt32BE(0x00000000, 0x12);// speed = 50Hz
writeAsciiPad(hdr, 0x16, 32, song.title    || 'COTG Theme');
writeAsciiPad(hdr, 0x36, 32, song.author   || 'Unknown');
writeAsciiPad(hdr, 0x56, 32, song.released || '');

// Write final SID (header + PRG-with-$1000)
fs.writeFileSync(sidOut, Buffer.concat([hdr, core]));
console.log(`Wrote ${sidOut}`);
