'use strict';
function segments(path) {
  if (!/^\$(?:\.[A-Za-z_][A-Za-z_0-9]*|\[\d+\])+$/.test(path)) return null;
  const parts = [...path.matchAll(/\.([A-Za-z_][A-Za-z_0-9]*)|\[(\d+)\]/g)].map(match => match[1] ?? Number(match[2]));
  return parts.some(key => ['__proto__', 'prototype', 'constructor'].includes(key)) ? null : parts;
}
function sourceAt(parameters, parts) {
  let source = { type: parameters };
  for (const key of parts) {
    const type = source && typeof source === 'object' && !Array.isArray(source) && Object.hasOwn(source, 'type') ? source.type : source;
    source = typeof key === 'number' ? Array.isArray(type) ? type[0] : null : type?.[key];
    if (!source) return null;
  }
  return source;
}
function prepare(parameters, candidate, issues) {
  if (!candidate || !Array.isArray(issues) || !issues.length || issues.length > 16) return null;
  const paths = [...new Set(issues.map(issue => issue.path))], fields = {}, targets = [];
  if (Object.keys(parameters).every(key => paths.includes('$.' + key))) return null;
  for (const path of paths) {
    const parts = segments(path), source = parts && sourceAt(parameters, parts);
    if (!source || source.optional) return null;
    if (targets.some(target => target.path.startsWith(path + '.') || path.startsWith(target.path + '.') ||
        target.path.startsWith(path + '[') || path.startsWith(target.path + '['))) return null;
    let parent = candidate;
    for (const key of parts.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) return null;
      parent = parent[key];
    }
    if (!parent || typeof parent !== 'object') return null;
    const name = 'fix_' + targets.length;
    fields[name] = source; targets.push({ name, path, parts });
  }
  return { parameters: fields, targets, candidate: structuredClone(candidate) };
}
function apply(plan, corrections) {
  const next = structuredClone(plan.candidate);
  for (const { name, parts } of plan.targets) {
    if (!Object.hasOwn(corrections, name)) throw Error('Required targeted correction missing: ' + name);
    let parent = next;
    for (const key of parts.slice(0, -1)) parent = parent[key];
    parent[parts.at(-1)] = corrections[name];
  }
  return next;
}
function instructions(plan) {
  return plan.targets.map(({ name, path, parts }) => {
    let value = plan.candidate;
    const anchors = {};
    for (const key of parts) {
      if (value && typeof value === 'object' && !Array.isArray(value))
        for (const field of ['id', 'name', 'speaker', 'title', 'subject', 'kind'])
          if (typeof value[field] === 'string') anchors[field] = value[field].slice(0, 120);
      value = value?.[key];
    }
    return { field: name, path, anchors, rejectedValue: (JSON.stringify(value) ?? '[missing]').slice(0, 1600) };
  });
}
function issue(path, expected, actual, message) {
  return { path, expected, actual, message };
}
function invalid(issues) {
  return Object.assign(Error(issues.map(row => `${row.path}: ${row.message || `expected ${row.expected}; received ${row.actual}`}`).join('\n')),
    { code: 'GENERATION_VALIDATION', issues });
}
function wordIssues(value, path, maximum = 20) {
  const count = typeof value === 'string' && value.trim() ? value.trim().split(/\s+/).length : 0;
  return !count || count > maximum ? [issue(path, `1-${maximum} words`, count, `expected 1-${maximum} words; received ${count}`)] : [];
}
module.exports = { prepare, apply, instructions, invalid, issue, wordIssues };
