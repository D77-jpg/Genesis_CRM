'use strict';

// A fixed bound applies even to supplied ASTs and cannot be disabled by options.
const MAX_DEPTH = 64;
exports.MAX_DEPTH = MAX_DEPTH;
exports.checkDepth = depth => {
  if (depth > MAX_DEPTH) {
    throw new SyntaxError(`Brace pattern exceeds maximum nesting depth (${MAX_DEPTH})`);
  }
};
