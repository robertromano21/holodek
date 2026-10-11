(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommandIntent = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const directions = Object.freeze({
    n: 'north', north: 'north', s: 'south', south: 'south', e: 'east', east: 'east', w: 'west', west: 'west',
    ne: 'northeast', northeast: 'northeast', nw: 'northwest', northwest: 'northwest',
    se: 'southeast', southeast: 'southeast', sw: 'southwest', southwest: 'southwest',
    u: 'up', up: 'up', d: 'down', down: 'down'
  });
  const movement = new RegExp(`^(?:(?:go|move|walk|run|head|travel|proceed|climb)\\s+)?(${Object.keys(directions).join('|')})$`);
  function travelDirection(input) {
    const command = String(input || '').trim().toLowerCase().replace(/[.!]+$/, '').trim();
    const match = movement.exec(command);
    return match ? directions[match[1]] : null;
  }
  return { travelDirection };
});
