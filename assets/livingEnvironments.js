// Environmental dressing remains separate from the room's single physical puzzle.
(function(root) {
  'use strict';
  const puzzles = typeof module === 'object' && module.exports ? require('./physicalPuzzles') : root.PhysicalPuzzles;
  const THEMES = {
    forge: { name: 'Furnace Court', props: ['furnace', 'brazier', 'rubble'] },
    graves: { name: 'Grave Shrine', props: ['tomb', 'altar', 'dead_tree'] },
    grove: { name: 'Dead Grove', props: ['dead_tree', 'roots', 'tomb'] }
  };
  function chooseTheme(spec = {}) {
    const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
    return /furnace|foundry|forge|kiln|smelter/.test(text) ? 'forge' :
      /mire|swamp|forest|grove|calcified roots|dead trees|withered trees/.test(text) ? 'grove' :
      /temple|grave|crypt|catacomb|burial|ossuary|ruin/.test(text) ? 'graves' : null;
  }
  function enrichSceneSpec(spec) {
    puzzles.enrichSceneSpec(spec);
    const theme = chooseTheme(spec);
    if (!theme) return null;
    spec.landmarks ||= [];
    for (const type of THEMES[theme].props) if (!spec.landmarks.some(l => l.type === type)) spec.landmarks.push({
      type, label: type.replace(/_/g, ' '), count: type === 'dead_tree' ? 3 : 1,
      condition: [], placement: 'scattered', fromLivingEnvironment: true
    });
    return theme;
  }
  const api = { ...puzzles, THEMES, chooseTheme, enrichSceneSpec };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LivingEnvironments = api;
})(typeof window === 'undefined' ? globalThis : window);
