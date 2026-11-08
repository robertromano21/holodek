'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1';process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../assets/spriteExpansion'),P=require('../retort/genreAssetPolicy');
const world=genre=>({kind:'homebrew',seed:'sprite-generation',genres:[genre],genreWeights:[{genre,weight:1}]});
for(const [genre,g]of Object.entries(E.CATALOG))test('generated asset directives expose only in-genre sprite keywords '+genre,()=>{const setting=world(genre),c=P.catalog({},setting);assert.deepEqual(c.spriteRaces,g.creatures.map(e=>e.key));assert.deepEqual(c.spriteCallings,g.roles.map(e=>e.key));const directive=P.directive({},setting);for(const e of [...g.creatures,...g.roles])assert.ok(directive.includes(e.key));});
test('built-in generated sprite choices contain only the three fantasy genres',()=>{const c=P.catalog({},null),genres=['fantasy','dark-fantasy','mythic'];assert.equal(c.spriteRaces.length,12);assert.equal(c.spriteCallings.length,12);for(const e of E.creatures)assert.equal(c.spriteRaces.includes(e.key),genres.includes(e.genre));for(const e of E.roles)assert.equal(c.spriteCallings.includes(e.key),genres.includes(e.genre));});
