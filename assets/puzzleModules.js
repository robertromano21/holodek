(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuzzleModules = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const mechanics = {
    sequence: { suffix: 'button', verb: 'press', positions: 2, ordered: true },
    alignment: { suffix: 'dial', verb: 'turn', positions: 3 },
    channels: { suffix: 'lever', verb: 'pull', positions: 2 },
    interlock: { suffix: 'lever', verb: 'pull', positions: 2 },
    sliding: { suffix: 'block', verb: 'push', positions: 3 },
    balance: { suffix: 'weight', verb: 'adjust', positions: 3 },
    harmonics: { suffix: 'chime', verb: 'strike', positions: 2, ordered: true }
  };
  const kits = {
    lunar_orrery: { kinds: ['alignment'], receiver: 'beacon', material: 'metal' },
    star_mirrors: { kinds: ['alignment'], receiver: 'iris', material: 'crystal' },
    ancestor_seals: { kinds: ['alignment', 'sequence'], receiver: 'statue', material: 'marble' },
    echo_chimes: { kinds: ['harmonics', 'sequence'], receiver: 'beacon', material: 'metal' },
    root_shrine: { kinds: ['channels', 'interlock'], receiver: 'fountain', material: 'wood' },
    forgotten_sluice: { kinds: ['channels'], receiver: 'fountain', material: 'stone' },
    counterweight_gate: { kinds: ['interlock', 'balance'], receiver: 'gate', material: 'stone' },
    wooden_winch: { kinds: ['interlock', 'channels'], receiver: 'gate', material: 'wood' },
    oath_scales: { kinds: ['balance'], receiver: 'statue', material: 'metal' },
    sliding_relief: { kinds: ['sliding'], receiver: 'mosaic', material: 'stone' },
    runic_causeway: { kinds: ['sliding', 'sequence'], receiver: 'iris', material: 'obsidian' },
    procession_altar: { kinds: ['sequence', 'harmonics'], receiver: 'mosaic', material: 'marble' },
    sealed_archive: { kinds: ['alignment', 'sequence', 'channels'], receiver: 'cabinet', material: 'metal' },
    offering_table: { kinds:['sliding'],receiver:'altar',material:'marble' },
    incense_procession: { kinds:['sequence'],receiver:'altar',material:'metal' }
  };
  const arrangements = ['arc', 'row', 'opposed', 'staggered'];
  const clueStyles = ['wall_relief', 'floor_mosaic', 'star_chart', 'carved_tablet', 'woven_banner'];
  const glyphs = {
    sun: ['0010100','0001000','1011101','0111110','1011101','0001000','0010100'],
    moon: ['0011100','0111000','1110000','1110000','1110000','0111000','0011100'],
    wave: ['0000000','0100010','1010101','0001000','0100010','1010101','0001000'],
    star: ['0001000','1001001','0111110','0011100','0111110','1001001','0001000'],
    crown: ['1001001','1001001','1101011','1111111','0111110','0111110','1111111'],
    eye: ['0000000','0011100','0101010','1001001','0101010','0011100','0000000'],
    leaf: ['0000110','0001111','0011101','0111010','1110100','1101000','0010000'],
    tower: ['1010101','1111111','0111110','0110110','0111110','0110110','1111111'],
    bell: ['0001000','0011100','0111110','0111110','0111110','1111111','0001000'],
    serpent: ['0011110','0100000','0011100','0000010','0111100','0100000','0011110'],
    flame: ['0001000','0011000','0111010','1111110','1111111','0111110','0011100'],
    mountain: ['0001000','0010100','0111110','0100010','1100011','1000001','1111111'],
    key: ['0110000','1001000','1001000','0110100','0000010','0000011','0000001'],
    skull: ['0011100','0111110','1010101','1111111','0111110','0101010','0011100'],
    dagger: ['0001000','0001000','0011100','0001000','0011100','0011100','0001000'],
    dragon: ['0000110','0001101','1011100','1110100','0111110','0010100','0110110'],
    cloud: ['0000000','0000000','0011100','0111110','1111111','0111110','0000000'],
    prism: ['0001000','0010100','0101010','1001001','0101010','0010100','0001000'],
    picks: ['0011100','1001001','0100010','0010100','0001000','0010100','0100010'],
    heart: ['0110110','1111111','1111111','0111110','0011100','0001000','0000000'],
    flowers: ['0101010','1111111','0101010','0001000','0101010','0011100','0001000'],
    unicorn: ['0000010','0000110','0111110','1101110','1111110','1111100','0111000'],
    turtle: ['0001000','0011100','0111110','1111111','1111111','0111110','1100011'],
    triangle: ['0001000','0001000','0011100','0011100','0111110','0111110','1111111']
  };
  function bitmap(label, custom = []) {
    const name = String(label || '').trim().toLowerCase(), supplied = custom.find(g => g.name.toLowerCase() === name);
    if (supplied) return supplied.pixels;
    if (glyphs[name]) return glyphs[name];
    let seed = 2166136261;
    for (const c of name) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    return Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => {
      const a = Math.min(x, 6 - x), n = Math.imul(seed ^ (y * 17 + a * 131), 2246822507) >>> 0;
      return x === 3 && y === 3 || n % 5 < 2 ? '1' : '0';
    }).join(''));
  }
  function validateGlyphs(rows) {
    if (rows === undefined) return [];
    if (!Array.isArray(rows) || rows.length > 12) throw Error('At most twelve named visual symbols are allowed.');
    const seen = new Set(Object.keys(glyphs)),images=new Set(Object.values(glyphs).map(rows=>rows.join('')));
    return rows.map(row => {
      if (typeof row?.name !== 'string' || !/^[a-z][a-z '-]{0,27}$/i.test(row.name) || seen.has(row.name.toLowerCase()) ||
          !Array.isArray(row.pixels) || row.pixels.length !== 7 || row.pixels.some(line => !/^[01]{7}$/.test(line)) ||
          !row.pixels.some(line => line.includes('1')) || !row.pixels.some(line => line.includes('0'))||images.has(row.pixels.join(''))) throw Error('Symbols require a unique name and readable 7-by-7 bitmap.');
      seen.add(row.name.toLowerCase());images.add(row.pixels.join(''));return { name: row.name, pixels: [...row.pixels] };
    });
  }
  function toolbox() {
    return { mechanics, kits, arrangements, clueStyles, symbols: Object.keys(glyphs), materials: ['stone','marble','wood','metal','obsidian','crystal'] };
  }
  return { mechanics, kits, arrangements, clueStyles, glyphs, bitmap, validateGlyphs, toolbox };
});
