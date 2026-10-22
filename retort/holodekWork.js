'use strict';
const Budget = require('./holodekBudget');
const Schema = require('./structuredSchema');
const H = require('./holodekStructured');
const Policy = require('./generationPolicy');
const MAX_ANSWER = 700;
function shape(source) {
  const type = source && typeof source === 'object' && !Array.isArray(source) && Object.hasOwn(source, 'type') ? source.type : source;
  return { type, object: type && typeof type === 'object' && !Array.isArray(type) ? type : null,
    array: Array.isArray(type) ? type : null };
}
function outputTokens(schema) {
  if (schema.anyOf) return Math.max(...schema.anyOf.map(outputTokens));
  if (Array.isArray(schema.type)) schema = { ...schema, type: schema.type.find(type => type !== 'null') };
  if (schema.enum) return Math.max(...schema.enum.map(value => Budget.est(JSON.stringify(value))), 1);
  if (schema.type === 'object') return 2 + Object.entries(schema.properties || {}).reduce((n, [key, child]) => n + Budget.est(key) + 3 + outputTokens(child), 0);
  if (schema.type === 'array') return 2 + (schema.maxItems ?? schema.minItems ?? 4) * (outputTokens(schema.items || {}) + 1);
  if (schema.type === 'string') return Math.ceil((schema.maxLength || 240) / 3.5) + 2;
  return 8;
}
function dependencyView(value) {
  if (Array.isArray(value)) {
    if (value.every(row => row === null || typeof row !== 'object')) return value;
    return { count: value.length, identities: value.map(row => row && typeof row === 'object' ?
      Object.fromEntries(['id', 'name', 'role', 'slot', 'type', 'kind', 'x', 'y', 'w', 'h', 'floor', 'fromRoom', 'toRoom', 'points', 'mark', 'options', 'initial', 'goal']
        .filter(key => row[key] !== undefined).map(key => [key, row[key]])) : row),
      latest: value.slice(-1).map(dependencyView) };
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    child && typeof child === 'object' ? dependencyView(child) : child]));
  return value;
}
function prompt(brief, path, accepted, correction = '') {
  return `BOUNDED AUTHORING WORK ORDER. Complete ONLY ${path}; this is not a gameplay turn. Return the requested JSON fields, no menus or narrative outside them. Use concise prose while retaining required names, IDs and constraints.
${brief}
${Number.isInteger(accepted.nextIndex) ? `THIS CALL AUTHORS NEW ROW ${accepted.nextIndex + 1} of ${accepted.totalRows} (one-based). The previous rows are finished. Do NOT repeat their names or return them again. If the schema requests multiple rows, continue forward from this row only.` : ''}
Previously accepted choices (read-only dependencies, not permission to rewrite them): ${JSON.stringify(dependencyView(accepted))}.
${correction ? 'Correct this validation issue without changing unrelated accepted choices: ' + correction : ''}`;
}
function estimate(parameters, text) {
  const schema = require('./modelTransport').strictSchema(Schema.toJSON(parameters));
  const guide = require('node:fs').readFileSync(require('node:path').join(__dirname, '../prompts/grave-master-local-holodek1.md'), 'utf8').trim();
  const messages = [{ role: 'system', content: guide }, { role: 'system', content: H.instruction(schema) }, { role: 'user', content: text }];
  return { input: Budget.tally(messages, [{ response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } } }]).total,
    output: outputTokens(schema) };
}
async function request($, options) {
  const C = require('./generationContracts');
  const { component, parameters, validate = value => value, context = {}, localWork } = options;
  let root = {}, calls = 0, response = '';
  const recovery = { retryParts: 0, splitParts: 0, repairedLeaves: 0, resumedParts: 0 };
  const checkpoint = localWork.checkpoint || new Map();
  const ruleFor = name => localWork.arrays?.[name] || localWork.arrays?.[name.replace(/\[\d+\]/g, '')] ||
    localWork.arrays?.[name.split('.').at(-1)] || {};
  const briefFor = (path, prior) => localWork.brief + (localWork.specific ? '\nCURRENT PART ONLY: ' + localWork.specific(path, prior) : '');
  async function part(fields, path, dependencies, correction = '', repairing = false) {
    const key = require('node:crypto').createHash('sha256').update(JSON.stringify({ component, context, path,
      model: require('./gameModels').current().id, brief: briefFor(path, dependencies),
      schema: Schema.toJSON(fields), dependencies, strict: options.strictAnswer !== false })).digest('hex');
    if (checkpoint.has(key)) {
      recovery.resumedParts++;
      console.info('[HolodekWork]', JSON.stringify({ component, path, phase: 'resumed' }));
      return structuredClone(checkpoint.get(key));
    }
    const accepted = {}; let remaining = fields;
    function validatePart(value) {
      for (const field of localWork.uniqueFields?.(path) || ['name']) {
        const names = new Set((dependencies.acceptedRows || []).map(row => row?.[field]?.trim().toLowerCase()).filter(Boolean));
        for (const row of value.rows || [value]) if (typeof row?.[field] === 'string') {
          const name = row[field].trim().toLowerCase();
          if (names.has(name)) throw Object.assign(Error(`${field}: ${JSON.stringify(row[field])} is already an accepted row. Author a NEW distinct ${field} for row ${(dependencies.nextIndex || 0) + 1}; never copy completed rows.`),
            value.rows ? {} : { rejectedAnswer: value, invalidFields: [field] });
          names.add(name);
        }
      }
      localWork.validatePart?.(path, value, dependencies);
      return value;
    }
    const unit = Policy.budget(component + '|' + JSON.stringify(context) + '|' + path);
    for (let attempt = 1; attempt <= Policy.ATTEMPTS; attempt++) {
      if (attempt > 1) recovery.retryParts++;
      const brief = briefFor(path, dependencies);
      const text = prompt(brief, path, { ...dependencies, ...accepted }, correction), size = estimate(remaining, text);
      if (size.input > Budget.CEILING || size.output > Budget.ANSWER) throw Object.assign(Error(
        `holodek-1 work order ${component}.${path} exceeds its input/output allowance (${size.input}/${size.output}); split this part further.`), { code: 'HOLODEK_CONTEXT_BUDGET' });
      console.info('[HolodekWork]', JSON.stringify({ component, path, phase: 'requested', inputEstimate: size.input,
        answerEstimate: size.output, context: Budget.CONTEXT, answerReserve: Budget.ANSWER }));
      const work = async agent => {
        agent.model = $.model || 'gpt-4.1-mini'; agent.temperature = $.temperature ?? .7;
        await agent.user(text);
        return C.request(agent, { component: component + '-part', context: { ...context, path }, parameters: remaining,
          strictAnswer: options.strictAnswer !== false, retryHint: options.retryHint,
          validate: value => { validatePart({ ...accepted, ...value }); return value; }, budget: unit, delegated: true });
      };
      calls++;
      const result = typeof $.run === 'function' ? await $.run(work, null, { shouldSaveToLog: false }) : await work($);
      if (!result.value) {
        const error = result.error || Error('No validated answer for ' + component + '.' + path);
        if (['MODEL_OUTPUT_LIMIT', 'PC_MODEL_OUTPUT_LIMIT'].includes(error.code) && Object.keys(remaining).length > 1) {
          recovery.splitParts++;
          // Retry smaller work orders, never the same oversized answer or partial JSON.
          for (const [name, source] of Object.entries(remaining))
            Object.assign(accepted, await part({ [name]: source }, path + '.' + name, { ...dependencies, ...accepted }, correction));
          checkpoint.set(key, structuredClone(accepted)); return accepted;
        }
        if (['MODEL_OUTPUT_LIMIT', 'PC_MODEL_OUTPUT_LIMIT'].includes(error.code)) {
          error.recoverable = false; // A capped scalar cannot be partitioned further; do not replay the same unit.
          throw error;
        }
        if (unit.used >= unit.limit || !Policy.recoverable(error, result.response ? 'validation' : 'transport')) throw error;
        if (error.rejectedAnswer && typeof error.rejectedAnswer === 'object') {
          const schema = require('./modelTransport').strictSchema(Schema.toJSON(remaining));
          for (const [name, source] of Object.entries(schema.properties))
            if (!error.invalidFields?.includes(name) && Object.hasOwn(error.rejectedAnswer, name) && require('./modelTransport').matches(error.rejectedAnswer[name], source)) {
              accepted[name] = error.rejectedAnswer[name];
              remaining = Object.fromEntries(Object.entries(remaining).filter(([key]) => key !== name));
            }
          if (!repairing) for (const [name, source] of Object.entries(remaining)) {
            const type = shape(source);
            if (!error.invalidFields?.includes(name) && (type.object || type.array) && Object.hasOwn(error.rejectedAnswer, name)) {
              accepted[name] = await repairValue(source, error.rejectedAnswer[name], path + '.' + name,
                { ...dependencies, ...accepted }, error.message);
              remaining = Object.fromEntries(Object.entries(remaining).filter(([key]) => key !== name));
            }
          }
          if (!Object.keys(remaining).length) {
            validatePart(accepted); checkpoint.set(key, structuredClone(accepted)); return accepted;
          }
        }
        correction = error.message; continue;
      }
      Object.assign(accepted, result.value);
      // Bound retained authoring work; no partial plan is ever returned as a final result.
      if (checkpoint.size >= 512) checkpoint.delete(checkpoint.keys().next().value);
      checkpoint.set(key, structuredClone(accepted));
      console.info('[HolodekWork]', JSON.stringify({ component, path, phase: 'accepted' }));
      return accepted;
    }
  }
  async function repairValue(source, value, path, dependencies, correction) {
    const schema = require('./modelTransport').strictSchema(Schema.toJSON({ value: source })).properties.value;
    if (require('./modelTransport').matches(value, schema)) return structuredClone(value);
    const type = shape(source);
    if (type.object && value && typeof value === 'object' && !Array.isArray(value)) {
      const repaired = {};
      for (const [name, child] of Object.entries(type.object))
        repaired[name] = await repairValue(child, value[name], path + '.' + name, { ...dependencies, acceptedFields: value }, correction);
      return repaired;
    }
    if (type.array && Array.isArray(value) && value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems ?? Infinity)) {
      const repaired = [];
      for (let i = 0; i < value.length; i++) repaired.push(await repairValue(type.array[0], value[i], path + '[' + i + ']', dependencies, correction));
      return repaired;
    }
    recovery.repairedLeaves++;
    return (await part({ value: source }, path + '.repair', dependencies, correction, true)).value;
  }
  async function object(fields, path, prior, correction = '') {
    const value = {}, entries = Object.entries(fields), leading = path === '$' ? localWork.leading || [] : [];
    entries.sort(([a], [b]) => (leading.includes(a) ? leading.indexOf(a) : leading.length) - (leading.includes(b) ? leading.indexOf(b) : leading.length));
    let group = {};
    const deps = () => ({ ...prior, ...value });
    async function flush() {
      if (!Object.keys(group).length) return;
      Object.assign(value, await part(group, path + '.{' + Object.keys(group).join(',') + '}', deps(), correction)); group = {};
    }
    for (const [key, original] of entries) {
      let source = original;
      const child = shape(source), childPath = path + '.' + key;
      if (child.array && !shape(child.array[0]).object) {
        // Cardinality is part of the wire schema, including rhythm-dependent contours.
        await flush();
        const rule = ruleFor(childPath), bounds = Schema.toJSON({ rows: source }).properties.rows;
        const count = typeof rule.count === 'function' ? rule.count(root, deps()) : rule.count;
        if (count !== undefined && (!Number.isInteger(count) || count < Math.max(bounds.minItems ?? 0, rule.min ?? 0) ||
            count > Math.min(bounds.maxItems ?? Infinity, rule.max ?? Infinity)))
          throw Error(childPath + ': authoring count conflicts with the original array bounds: ' + count);
        source = { ...(Array.isArray(source) ? { type: source } : source),
          minItems: count ?? Math.max(bounds.minItems ?? 0, rule.min ?? 0),
          maxItems: count ?? Math.min(bounds.maxItems ?? rule.max ?? 9, rule.max ?? bounds.maxItems ?? 9) };
        if (rule.sequence) {
          value[key] = await sequence(source, childPath, deps(), rule, correction); continue;
        }
      }
      if (localWork.field) source = localWork.field(childPath, source, deps());
      if (source?.enum?.length > 12 && estimate({ [key]: source }, prompt(briefFor(childPath, deps()), childPath, deps(), correction)).input > Budget.CEILING - 80) {
        await flush();
        value[key] = await enumChoice(key, source, childPath, deps(), correction); continue;
      }
      if (child.object || child.array && shape(child.array[0]).object) {
        await flush();
        value[key] = child.object ? await object(child.object, childPath, deps(), correction) : await array(source, childPath, deps(), correction);
        continue;
      }
      const isolate = localWork.isolate?.includes(key);
      if (isolate) await flush();
      const candidate = { ...group, [key]: source }, size = estimate(candidate, prompt(briefFor(path, deps()), path, deps(), correction));
      if (Object.keys(group).length && (size.input > Budget.CEILING - 80 || size.output > MAX_ANSWER)) await flush();
      group[key] = source;
      if (isolate) await flush();
    }
    await flush(); return value;
  }
  async function sequence(source, path, prior, rule, correction) {
    const schema = Schema.toJSON({ rows: source }).properties.rows;
    const minimum = schema.minItems, maximum = schema.maxItems;
    const count = minimum === maximum ? minimum : (await part({ count: { type: Number,
      enum: Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i) } }, path + '.count', prior, correction)).count;
    const values = [], entry = shape(source).array[0];
    for (let i = 0; i < count; i++) {
      const choices = rule.sequence({ prior, values: values.slice(), count, path, root });
      const original = schema.items;
      if (!Array.isArray(choices) || !choices.length || choices.some(value => !require('./modelTransport').matches(value, original)))
        throw Error(path + ': dependent choices must be a nonempty subset of the original schema.');
      const typed = typeof entry === 'function' ? { type: entry } : entry;
      const result = await part({ value: { ...typed, enum: choices } }, path + '[' + i + ']',
        { ...prior, acceptedNotes: values.slice(), nextIndex: i, totalRows: count }, correction);
      values.push(result.value);
    }
    return values;
  }
  async function enumChoice(key, source, path, prior, correction) {
    const groups = new Map();
    for (const value of source.enum) {
      const family = typeof value === 'string' && value.includes('/') ? value.split('/')[0] : '';
      if (!groups.has(family)) groups.set(family, []); groups.get(family).push(value);
    }
    if (!groups.has('') && groups.size > 1 && groups.size <= 12) {
      const selected = await part({ family: { type: String, enum: [...groups.keys()] } }, path + '.family', prior, correction);
      const narrowed = { ...source, enum: groups.get(selected.family) };
      const result = await part({ [key]: narrowed }, path, prior, correction); return result[key];
    }
    // Every candidate remains available; compare bounded shortlists, then their winners.
    const winners = [];
    for (let offset = 0; offset < source.enum.length; offset += 12) {
      const selected = await part({ [key]: { ...source, enum: source.enum.slice(offset, offset + 12) } }, path + '.shortlist-' + offset, prior, correction);
      winners.push(selected[key]);
    }
    if (winners.length === 1) return winners[0];
    return (await part({ [key]: { ...source, enum: winners } }, path + '.final-choice', prior, correction))[key];
  }
  async function array(source, path, prior, correction) {
    const rule = ruleFor(path), bounds = Schema.toJSON({ rows: source }).properties.rows, entry = shape(source).array[0];
    let count = typeof rule.count === 'function' ? rule.count(root, prior) : rule.count;
    const minimum = Math.max(bounds.minItems || 0, rule.min || 0), maximum = Math.min(bounds.maxItems ?? rule.max ?? 4, rule.max ?? bounds.maxItems ?? 4);
    if (minimum > maximum) throw Error(path + ': conflicting authoring array bounds ' + minimum + '..' + maximum);
    if (count === undefined) {
      const chosen = await part({ count: { type: Number, enum: Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i) } }, path + '.count', prior, correction);
      count = chosen.count;
    }
    if (!Number.isInteger(count) || count < minimum || count > maximum) throw Error(path + ': invalid authoring count ' + count);
    const values = [];
    for (let offset = 0; offset < count;) {
      const batch = Math.min(rule.batch || Math.max(1, Math.floor(MAX_ANSWER / outputTokens(bounds.items))), count - offset);
      const fields = { rows: { type: [entry], minItems: batch, maxItems: batch } };
      const dependencies = { ...prior, acceptedRows: values, nextIndex: offset, totalRows: count };
      const size = estimate(fields, prompt(briefFor(path, dependencies), path, dependencies, correction));
      if (rule.split || size.input > Budget.CEILING - 80 || size.output > MAX_ANSWER) {
        values.push(await object(shape(entry).object, path + '[' + offset + ']', dependencies, correction)); offset++;
      } else {
        const result = await part(fields, path + '[' + offset + '..' + (offset + batch - 1) + ']', dependencies, correction);
        if (result.rows.length !== batch) throw Error(path + ': partial batch rejected');
        values.push(...result.rows); offset += batch;
      }
    }
    return values;
  }
  try {
    const attempts = Policy.ATTEMPTS; let correction = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt === 1) root = await object(parameters, '$', {}, correction);
      else {
        const keys = localWork.repairFields?.(correction, root) || Object.keys(parameters);
        // Final semantic rejection invalidates the selected part checkpoints as well.
        checkpoint.clear();
        const prior = Object.fromEntries(Object.entries(root).filter(([key]) => !keys.includes(key)));
        const repaired = await object(Object.fromEntries(keys.map(key => [key, parameters[key]])), '$', prior, correction);
        root = { ...root, ...repaired };
      }
      response = JSON.stringify(C.compact(root));
      try {
        const value = validate(C.compact(root));
        if (value == null) throw Error('Validation returned no accepted result.');
        require('./generationDiagnostics').report(component, { ...context, phase: 'local-work-chain',
          status: attempt > 1 || Object.values(recovery).some(n => n > 0) ? 'recovered' : 'generated', attempt, parts: calls, ...recovery });
        return { value, response, attempt, parts: calls, recovery };
      }
      catch (error) { correction = error.message; if (attempt === attempts) throw error; }
    }
  } catch (error) {
    require('./generationDiagnostics').report(component, { ...context, status: 'rejected', phase: 'local-work-chain', reason: error });
    return { value: null, response, error, parts: calls, recovery };
  }
}
module.exports = { request, estimate, outputTokens, dependencyView };
