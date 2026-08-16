'use strict';

function normalizeClipboardReadPermission(permission) {
  if (permission === 'clipboard-read' || permission === 'deprecated-sync-clipboard-read') {
    return 'clipboardRead';
  }
  return permission;
}

function wrapPermissionRequestHandler(handler) {
  return (contents, permission, callback, details) => {
    if (permission === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }
    handler(contents, normalizeClipboardReadPermission(permission), callback, details);
  };
}

function wrapPermissionCheckHandler(handler) {
  return (contents, permission, requestingOrigin, details) => {
    if (permission === 'clipboard-sanitized-write') {
      return true;
    }
    return handler(
      contents,
      normalizeClipboardReadPermission(permission),
      requestingOrigin,
      details
    );
  };
}

module.exports = {
  wrapPermissionRequestHandler,
  wrapPermissionCheckHandler
};
