'use strict';
// world1 settlement market: supply and demand, biome production, jobs. Only rooms whose market carries
// version 'world1' use it; older saves keep the original fixed prices.
const Flags = require('./worldFlags');
const CATS = ['weapon', 'armor', 'shield', 'potion', 'scroll', 'other'];
const BIOME = {
  cave: { produces: ['weapon', 'armor'], consumes: ['potion', 'other'], jobs: ['haul ore to the surface', 'clear a flooded gallery'] },
  temple: { produces: ['potion', 'scroll'], consumes: ['other', 'shield'], jobs: ['copy a worn liturgy', 'guard the night vigil'] },
  crypt: { produces: ['scroll'], consumes: ['potion', 'weapon'], jobs: ['seal a restless tomb', 'carry grave goods'] },
  fortress: { produces: ['shield', 'armor'], consumes: ['potion', 'other'], jobs: ['stand a watch on the wall', 'deliver muster rolls'] },
  wasteland: { produces: ['other'], consumes: ['potion', 'weapon'], jobs: ['escort a water caravan', 'scout the dunes'] },
  city: { produces: ['scroll', 'other', 'weapon'], consumes: ['potion', 'armor'], jobs: ['repair an aqueduct span', 'unload a harbor barge', 'run guild errands'] },
  default: { produces: ['other'], consumes: ['potion'], jobs: ['carry a sealed letter', 'mend a fence'] }
};
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function category(item) {
  if (item?.spell_scroll || /scroll/i.test(item?.name || '')) return 'scroll';
  if (item?.consumable_kind || /potion|draught|elixir/i.test(item?.name || '')) return 'potion';
  return CATS.includes(item?.type) ? item.type : 'other';
}
function seed(room, geoKey, seedText = '') {
  if (!Flags.on('MARKET_ECONOMY') || !room || room.market) return room?.market || null;
  const biome = Flags.on('CITY_COMPLETE') && room.cityRoom ? (room.cityRoom.district==='undercity'?'cave':'city') : room.citySite || room.environmentIntent?.citySite ? 'city' : room.classification?.biome || 'default', plan = BIOME[biome] || BIOME.default;
  const demand = Object.fromEntries(CATS.map(c => [c, plan.consumes.includes(c) ? 1.4 : plan.produces.includes(c) ? 0.7 : 1]));
  const n = hash(`${seedText}:${geoKey}:market`);
  room.market = { version: Flags.VERSION, biome, produces: plan.produces, consumes: plan.consumes, demand, baseline: { ...demand }, ticks: 0,
    jobs: plan.jobs.slice(0, 1 + n % plan.jobs.length).map((task, i) => ({ id: `job:${geoKey}:${i}`, task, wage: 2 + (n >> (i * 3)) % 5, status: 'open' })) };
  return room.market;
}
function active(room) { return room?.market?.version === Flags.VERSION; }
function factor(room, item) {
  const d = room.market.demand[category(item)] ?? 1;
  return Math.max(0.5, Math.min(2.5, d));
}
function price(room, item, base) { return active(room) ? Math.max(1, Math.round(base * factor(room, item))) : base; }
function salePrice(room, item, base) { return active(room) ? Math.max(1, Math.floor(base * factor(room, item) / 2)) : Math.max(1, Math.floor(base / 2)); }
// Buying makes a good scarcer here; selling floods it. Demand drifts back toward the settlement's baseline.
function trade(room, kind, item) {
  if (!active(room)) return;
  const m = room.market, c = category(item);
  m.demand[c] = Math.max(0.3, Math.min(3, (m.demand[c] ?? 1) + (kind === 'buy' ? 0.12 : -0.15)));
  m.ticks++;
  for (const k of CATS) m.demand[k] += ((m.baseline[k] ?? 1) - m.demand[k]) * 0.05;
}
function view(room) {
  if (!active(room)) return null;
  const m = room.market;
  return { biome: m.biome, produces: m.produces, consumes: m.consumes, jobs: m.jobs,
    scarce: Object.entries(m.demand).filter(([, v]) => v >= 1.3).map(([k]) => k), plentiful: Object.entries(m.demand).filter(([, v]) => v <= 0.8).map(([k]) => k),
    ...(m.routes ? {tradeRoutes:m.routes.rooms.slice()} : {}) };
}
module.exports = { seed, active, price, salePrice, trade, view, category, BIOME };
