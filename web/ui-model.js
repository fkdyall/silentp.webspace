(function exposeUiModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.fypmUiModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  'use strict';

  function title(value) {
    const text = String(value || 'None');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function privacyViewModel(state = {}) {
    return {
      profileName: String(state.profile?.name || 'No profile'),
      compartmentName: String(state.compartment?.name || 'No site'),
      protectionLabel: title(state.protectionLevel || 'hardened'),
      blockedRequestCount: Number(state.blockedRequestCount) || 0,
      authorizedFamily: title(state.authorizedFamily || 'none'),
      compatibilityLevel: Math.max(0, Math.min(3, Number(state.compatibilityLevel) || 0)),
      temporaryAllowances: Array.isArray(state.temporaryAllowances) ? state.temporaryAllowances : [],
      pinnedAllowances: Array.isArray(state.pinnedAllowances) ? state.pinnedAllowances : []
    };
  }

  function profileManagerViewModel({ profile, compartments = [], allowances = [] } = {}) {
    const profileId = String(profile?.id || '');
    return {
      profile: profile || null,
      families: Array.isArray(profile?.authorizedFamilies) ? profile.authorizedFamilies : [],
      compartments: compartments.filter((site) => site.profileId === profileId && site.persistent !== false && !site.temporary),
      allowances: allowances.filter((allowance) => allowance.profileId === profileId)
    };
  }

  function scopedAllowanceAction(action, profileId, compartmentId, allowanceId) {
    if (!profileId || !compartmentId || !allowanceId || !['pin', 'remove'].includes(action)) return null;
    return { action, profileId, compartmentId, allowanceId };
  }

  return { privacyViewModel, profileManagerViewModel, scopedAllowanceAction };
}));
