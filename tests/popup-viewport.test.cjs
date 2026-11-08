'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const css=fs.readFileSync('assets/gameUiDialogs.css','utf8');
test('shared dialog sizing never overrides owner positioning, including right-anchored exit prompts',()=>{
  assert.doesNotMatch(css,/(?:^|[;{])\s*(?:position|left|right|top|bottom|transform)\s*:/m);
  const index=fs.readFileSync('assets/index.html','utf8');
  assert.match(index,/\.popup-container\s*\{[^}]*position:\s*absolute;[^}]*top:\s*310px;[^}]*right:\s*5px;/s);
});
test('dialog bounds use the effective UI scale and dynamic viewport without scaling the world',()=>{
  assert.match(css,/max-width:\s*calc\(\(100vw - 24px\) \/ var\(--game-ui-scale, 1\)\)/);
  assert.match(css,/max-height:\s*calc\(\(100dvh - 24px\) \/ var\(--game-ui-scale, 1\)\)/);
  const bounds=css.slice(css.indexOf(':is('),css.indexOf('}')+1);
  for(const id of ['dungeon-popup','phaser-popup','game-log-popup','combat-popup'])assert.ok(bounds.includes(':not(#'+id+')'));
  assert.doesNotMatch(css,/\bzoom\s*:|\bscale\s*\(/);
});
test('recruitment has a shrinking scrollable content area and a separate wrapping action footer',()=>{
  assert.match(css,/\.recruitment-dialog > \.commerce-dialog-content\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;/s);
  assert.match(css,/\.recruitment-dialog > \.commerce-dialog-actions\s*\{[^}]*flex-wrap:\s*wrap;[^}]*overflow-y:\s*auto;/s);
  assert.match(css,/\.popup-container\.recruitment-dialog\s*\{[^}]*overflow:\s*hidden !important;/s);
});
test('dialog scrollbars override the hidden page scrollbars and buttons wrap instead of overflowing',()=>{
  assert.match(css,/::-webkit-scrollbar\s*\{\s*display:\s*block;/s);
  assert.match(css,/scrollbar-width:\s*thin;/);
  assert.match(css,/button\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.doesNotMatch(css,/\bdisplay:\s*(?:flex|block)\s*!important/);
});
test('the real save-slot grid allows shrinking inputs and full-row metadata',()=>{
  const source=fs.readFileSync('assets/saveGameUi.js','utf8');
  assert.match(source,/grid-template-columns:minmax\(0,1fr\) auto auto/);
  assert.match(source,/\.save-slot strong,\.save-slot div\{grid-column:1 \/ -1\}/);
  assert.match(source,/\.save-slot input\{min-width:0;width:100%\}/);
});
test('the shared viewport stylesheet is loaded after the existing pixel UI and new browser versions are requested',()=>{
  const index=fs.readFileSync('assets/index.html','utf8');
  assert.ok(index.indexOf('/assets/gameUiDialogs.css?v=viewport-scroll-2')>index.indexOf('/assets/gameUiPixels.css'));
  assert.match(index,/commerceUi\.js\?v=[^"']*popup-viewport-1/);
  assert.match(index,/saveGameUi\.js\?v=[^"']*popup-viewport-1/);
});
