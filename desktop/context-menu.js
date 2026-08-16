'use strict';

function contextActionIds(params = {}, navigation = {}) {
  const actions = [];
  const editable = Boolean(params.isEditable);
  const flags = params.editFlags || {};

  if (params.linkURL) {
    actions.push('openLink', 'copyLink');
  } else if (editable) {
    if (flags.canCut !== false) actions.push('cut');
    if (flags.canCopy !== false || params.selectionText) actions.push('copy');
    if (flags.canPaste !== false) actions.push('paste');
  } else if (params.selectionText) {
    actions.push('copy');
  } else {
    if (navigation.canGoBack) actions.push('back');
    if (navigation.canGoForward) actions.push('forward');
    actions.push('reload');
  }

  if (flags.canSelectAll !== false) actions.push('selectAll');
  return actions;
}

module.exports = { contextActionIds };
