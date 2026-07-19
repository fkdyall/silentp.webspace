const TRACKING = new Set([
  'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'vero_id', 'ref_src', 'ref_url', 'campaign_id',
  'ad_id', 'adgroup'
]);

const BLOCKED_HOST_PARTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'analytics.google.com',
  'facebook.net',
  'scorecardresearch.com',
  'hotjar.com',
  'clarity.ms',
  'segment.io'
];

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
  try {
    const host = new URL(input).hostname.toLowerCase();
    return BLOCKED_HOST_PARTS.some((part) => host === part || host.endsWith(`.${part}`));
  } catch {
    return false;
  }
}

module.exports = { stripTracking, shouldBlock };
