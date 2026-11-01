'use strict';
const vm = require('node:vm');
module.exports = { ...vm, runInNewContext(code, context, options) {
  // Extracted Retort blocks need the same prompt router imported by the real module.
  context.StoryPrompts ||= require('../retort/graveMasterStoryPrompts');
  return vm.runInNewContext(code, context, options);
} };
