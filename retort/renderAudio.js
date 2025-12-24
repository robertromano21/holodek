const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function renderRoomMusic(sidPath, outBaseNoExt, seconds = 20) {
  // outBaseNoExt example: /home/.../sid/current_room  (no .wav suffix)
  // sidplayfp on some builds appends ".wav" even if you pass one.
  const sidArgs = [`-w${outBaseNoExt}`, `-t${seconds}`, sidPath];
  const run = spawnSync('sidplayfp', sidArgs, { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('sidplayfp failed');

  // Normalize filename: check the common variants and end up with "<base>.wav".
  const want = `${outBaseNoExt}.wav`;
  const variants = [
    want,
    `${want}.wav`,                 // ".wav.wav" case
    `${outBaseNoExt}.WAV`,         // uppercase extension
    `${outBaseNoExt}.wav.wav`,     // just in case...
  ];
  const found = variants.find(p => fs.existsSync(p));
  if (!found) {
    throw new Error(`WAV missing after sidplayfp: tried ${variants.map(v => path.basename(v)).join(', ')}`);
  }

  if (found !== want) {
    // Move/rename to the canonical name
    try { fs.renameSync(found, want); } catch {
      // If cross-device issues occur, copy instead
      fs.copyFileSync(found, want);
      fs.unlinkSync(found);
    }
  }
  return want;
}

module.exports = { renderRoomMusic };
