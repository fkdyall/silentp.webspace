const TRACKING = new Set([
  'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'vero_id', 'ref_src', 'ref_url', 'campaign_id',
  'ad_id', 'adgroup'
]);

const { isKnownTracker } = require('./privacy-policy');

function stripTracking(input) {
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || TRACKING.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return input;
  }
}

function shouldBlock(input) {
  return isKnownTracker(input);
}

module.exports = { stripTracking, shouldBlock };
