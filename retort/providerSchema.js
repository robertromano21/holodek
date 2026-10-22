'use strict';
// Reuse identical enum schemas: provider limits count values across the entire schema.
function compact(schema) {
  const counts = new Map(), definitions = {}, names = new Map();
  function children(node, visit) {
    for (const child of Object.values(node.properties || {})) visit(child);
    if (node.items) visit(node.items);
    for (const child of node.anyOf || []) visit(child);
  }
  function count(node) {
    if (node.enum) { const key = JSON.stringify(node); counts.set(key, (counts.get(key) || 0) + 1); }
    children(node, count);
  }
  count(schema);
  function encode(node) {
    const key = JSON.stringify(node);
    if (node.enum && counts.get(key) > 1) {
      if (!names.has(key)) { const name = 'enum' + names.size; names.set(key, name); definitions[name] = structuredClone(node); }
      return { $ref: '#/$defs/' + names.get(key) };
    }
    const out = { ...node };
    if (node.properties) out.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, encode(value)]));
    if (node.items) out.items = encode(node.items);
    if (node.anyOf) out.anyOf = node.anyOf.map(encode);
    return out;
  }
  const result = encode(schema);
  if (Object.keys(definitions).length) {
    if (schema.$defs) throw Error('Cannot overwrite an existing provider schema definition.');
    result.$defs = definitions;
  }
  return result;
}
module.exports = { compact };
