'use strict';

const assert = require('node:assert/strict');

let clipboardPermissions;
assert.doesNotThrow(() => {
  clipboardPermissions = require('./clipboard-permissions');
}, 'clipboard permission adapter must exist');

const {
  wrapPermissionRequestHandler,
  wrapPermissionCheckHandler
} = clipboardPermissions;

{
  const delegated = [];
  let allowed = null;
  const wrapped = wrapPermissionRequestHandler((_contents, permission, callback) => {
    delegated.push(permission);
    callback(permission === 'clipboardRead');
  });

  wrapped(null, 'clipboard-sanitized-write', (value) => { allowed = value; }, {});
  assert.equal(allowed, true, 'website copy writes should be allowed');
  assert.deepEqual(delegated, [], 'clipboard writes should not depend on clipboard-read permission');

  wrapped(null, 'clipboard-read', (value) => { allowed = value; }, {});
  assert.equal(allowed, true, 'clipboard reads should still use the existing clipboard permission gate');
  assert.equal(delegated.at(-1), 'clipboardRead');

  wrapped(null, 'deprecated-sync-clipboard-read', (value) => { allowed = value; }, {});
  assert.equal(allowed, true, 'legacy clipboard reads should use the same existing permission gate');
  assert.equal(delegated.at(-1), 'clipboardRead');

  wrapped(null, 'geolocation', (value) => { allowed = value; }, {});
  assert.equal(allowed, false);
  assert.equal(delegated.at(-1), 'geolocation', 'unrelated permissions must pass through unchanged');
}

{
  const delegated = [];
  const wrapped = wrapPermissionCheckHandler((_contents, permission) => {
    delegated.push(permission);
    return permission === 'clipboardRead';
  });

  assert.equal(wrapped(null, 'clipboard-sanitized-write', '', {}), true);
  assert.deepEqual(delegated, [], 'clipboard write checks should be allowed without clipboard-read access');

  assert.equal(wrapped(null, 'clipboard-read', '', {}), true);
  assert.equal(delegated.at(-1), 'clipboardRead');

  assert.equal(wrapped(null, 'deprecated-sync-clipboard-read', '', {}), true);
  assert.equal(delegated.at(-1), 'clipboardRead');

  assert.equal(wrapped(null, 'notifications', '', {}), false);
  assert.equal(delegated.at(-1), 'notifications', 'unrelated checks must pass through unchanged');
}

console.log('clipboard permission regression tests passed');
