'use strict';
const { retortSchemaToJsonSchema } = require('retort-js/dist/tooling');

// Retort's converter omits array cardinality. Preserve it before provider/local validation.
function toJSON(parameters) {
  const schema = retortSchemaToJsonSchema(parameters);
  function bounds(source, target) {
    if (!source || !target || typeof source !== 'object') return;
    if (source.alternatives) {
      for (const key of ['type', 'properties', 'required']) delete target[key];
      target.anyOf = source.alternatives.map(toJSON);
      return;
    }
    if (source.variants) {
      const { field, cases, groups } = source.variants, choices = source.type?.[field]?.enum;
      const branches = groups || Object.entries(cases).map(([value, rule]) => ({ values: [value], ...(Array.isArray(rule) ? { omit: rule } : rule) }));
      const covered = branches.flatMap(branch => branch.values);
      if (!Array.isArray(choices) || covered.length !== choices.length || new Set(covered).size !== choices.length || choices.some(value => !covered.includes(value)))
        throw Error('Discriminated contract cases must cover every enum choice exactly once.');
      const variants = branches.map(branch => {
        const properties = Object.fromEntries(Object.entries(source.type).filter(([key]) => !(branch.omit || []).includes(key)));
        Object.assign(properties, branch.properties || {});
        properties[field] = { ...source.type[field], enum: branch.values };
        return toJSON(properties);
      });
      for (const key of ['type', 'properties', 'required']) delete target[key];
      target.anyOf = variants;
      return;
    }
    if (!Array.isArray(source) && Object.hasOwn(source, 'type')) {
      for (const key of ['minItems', 'maxItems']) if (source[key] !== undefined) {
        if (!Number.isInteger(source[key]) || source[key] < 0) throw Error(`Invalid array ${key}.`);
        target[key] = source[key];
      }
      if (target.minItems > target.maxItems) throw Error('Array minItems exceeds maxItems.');
      source = source.type;
    }
    if (Array.isArray(source)) bounds(source[0], target.items);
    else if (source && typeof source === 'object')
      for (const [key, value] of Object.entries(source)) bounds(value, target.properties?.[key]);
  }
  bounds(parameters, schema);
  return schema;
}
const discriminated = (type, field, cases) => ({ type, variants: { field, cases } });
const discriminatedGroups = (type, field, groups) => ({ type, variants: { field, groups } });
const alternatives = (type, branches) => ({ type, alternatives: branches });
module.exports = { toJSON, discriminated, discriminatedGroups, alternatives };
