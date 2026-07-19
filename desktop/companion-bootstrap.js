'use strict';

// Silent P. PWSA map-companion policy:
// Keep the currently active website renderer alive when the window is minimized.
// The user may still explicitly choose Release CPU or Exit for maximum CPU.
const electron = require('electron');

const originalOn = electron.BrowserWindow.prototype.on;
electron.BrowserWindow.prototype.on = function patchedOn(eventName, listener) {
  if (eventName === 'minimize') {
    return this;
  }
  return originalOn.call(this, eventName, listener);
};

require('./main.js');
