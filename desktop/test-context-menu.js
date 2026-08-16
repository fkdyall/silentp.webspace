'use strict';

const assert = require('assert');
const { contextActionIds } = require('./context-menu');

assert.deepEqual(
  contextActionIds({ selectionText: 'selected', isEditable: false }, {}),
  ['copy', 'selectAll']
);
assert.deepEqual(
  contextActionIds({ selectionText: 'word', isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }, {}),
  ['cut', 'copy', 'paste', 'selectAll']
);
assert.deepEqual(
  contextActionIds({ linkURL: 'https://example.com/', isEditable: false }, {}),
  ['openLink', 'copyLink', 'selectAll']
);
assert.deepEqual(
  contextActionIds({}, { canGoBack: true, canGoForward: true }),
  ['back', 'forward', 'reload', 'selectAll']
);
assert.deepEqual(
  contextActionIds({}, { canGoBack: false, canGoForward: false }),
  ['reload', 'selectAll']
);

console.log('context-menu tests passed');
