// holodek-1 only: help the local fine-tune return schema-shaped structured answers.
// The transport supplies response_format as well as this compact shape instruction.
// Legacy scalar repairs remain logged; missing collections are never fabricated.
function skeleton(s) {
  if (!s || typeof s !== 'object') return '""';
  if (s.enum) return s.enum.filter(v => v !== null).map(v => JSON.stringify(v)).join('|');
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if (t === 'object') return '{' + Object.entries(s.properties || {}).map(([k, c]) => JSON.stringify(k) + ':' + skeleton(c)).join(',') + '}';
  if (t === 'array') return '[' + skeleton(s.items) + (s.minItems > 1 ? ',...' + s.minItems + ' items' : ',...') + ']';
  if (t === 'string') return s.maxLength ? `"text<=${s.maxLength}"` : '"text"';
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'true|false';
  return 'null';
}
function instruction(schema) {
  return `Reply with ONLY one JSON object (no prose, no code fence) exactly in this shape, every key present, no extra keys: ${skeleton(schema)}`;
}
function extract(text) {
  if (!text) return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}
const NAMEY = /name|title|id$/i;
function fallback(s) {
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum.find(v => v !== null);
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('null')) return null;
  const t = types[0];
  if (t === 'boolean') return false;
  if (t === 'number' || t === 'integer') return s.minimum ?? 0;
  if (t === 'array') return [];
  if (t === 'string') return '';
  return undefined;
}
// Fills only MISSING required keys (never replaces a value the model wrote, never invents names).
function repair(value, schema, path = '$', fixed = []) {
  if (!schema || value === null || typeof value !== 'object') return fixed;
  if (Array.isArray(value)) { if (schema.items) value.forEach((v, i) => repair(v, schema.items, `${path}[${i}]`, fixed)); return fixed; }
  for (const key of schema.required || []) {
    const child = schema.properties?.[key];
    if (Object.hasOwn(value, key) || !child) continue;
    const types = [].concat(child.type || []);
    if (NAMEY.test(key) || types.includes('object') || types.includes('array')) continue;
    const v = fallback(child); if (v === undefined) continue;
    value[key] = v; fixed.push(`${path}.${key}`);
  }
  for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key) && typeof value[key] === 'number' && Array.isArray(child.enum) && !child.enum.includes(value[key])) {
    const nums = child.enum.filter(v => typeof v === 'number'); if (!nums.length) continue;
    value[key] = nums.reduce((a, b) => Math.abs(b - value[key]) < Math.abs(a - value[key]) ? b : a); fixed.push(`${path}.${key}(enum)`); }
  for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) repair(value[key], child, `${path}.${key}`, fixed);
  return fixed;
}
// Validation schema for repaired answers: drops minLength so an empty repaired string reaches the caller's own validator/defaults.
function relaxed(s) {
  if (!s || typeof s !== 'object') return s;
  const out = { ...s }; delete out.minLength;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, c]) => [k, relaxed(c)]));
  if (s.items) out.items = relaxed(s.items);
  return out;
}
module.exports = { relaxed, skeleton, instruction, extract, repair };
