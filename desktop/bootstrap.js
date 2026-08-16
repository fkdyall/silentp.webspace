'use strict';

const { session } = require('electron');
const {
  wrapPermissionRequestHandler,
  wrapPermissionCheckHandler
} = require('./clipboard-permissions');

const originalFromPartition = session.fromPartition.bind(session);
const patchedSessions = new WeakSet();

session.fromPartition = (...args) => {
  const profileSession = originalFromPartition(...args);
  if (patchedSessions.has(profileSession)) return profileSession;
  patchedSessions.add(profileSession);

  const setRequestHandler = profileSession.setPermissionRequestHandler.bind(profileSession);
  const setCheckHandler = profileSession.setPermissionCheckHandler.bind(profileSession);

  profileSession.setPermissionRequestHandler = (handler) => {
    setRequestHandler(wrapPermissionRequestHandler(handler));
  };

  profileSession.setPermissionCheckHandler = (handler) => {
    setCheckHandler(wrapPermissionCheckHandler(handler));
  };

  return profileSession;
};

require('./main');
