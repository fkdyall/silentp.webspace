(() => {
  'use strict';

  const native = window.silentP;
  const PERMISSIONS = ['microphone', 'camera', 'location', 'notifications', 'clipboard', 'uploads', 'downloads', 'popups'];
  const $ = (selector) => document.querySelector(selector);
  let tabState = { tabs: [], activeTabId: null };
  let containers = [];
  let profiles = [];
  let activeContainer = null;
  let activePrivacy = null;
  let pendingRoute = null;
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function label(value) {
    return String(value || '').replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
  }

  function showToast(message) {
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
  }

  function addressFromInput(value) {
    const input = String(value || '').trim();
    if (!input) return null;
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
      ? input
      : (/^[^\s]+\.[^\s]+/.test(input) || /^localhost(?::\d+)?(?:\/|$)/i.test(input))
        ? `https://${input}`
        : `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
    try {
      const url = new URL(candidate);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function activeTab() {
    return tabState.tabs.find((tab) => tab.id === tabState.activeTabId) || null;
  }

  function closePopovers() {
    $('#permissionsPopover').hidden = true;
    $('#mainMenu').hidden = true;
    $('#containerChooser').hidden = true;
    $('#permissionsButton').setAttribute('aria-expanded', 'false');
    $('#mainMenuButton').setAttribute('aria-expanded', 'false');
    native?.setChromeHeight?.(108);
  }

  async function refreshContainers() {
    containers = native ? await native.listContainers() : [];
    profiles = native ? await native.listProfiles() : [];
    renderShortcuts();
  }

  async function importLegacyProfiles() {
    if (!native) return;
    let legacy;
    try {
      legacy = JSON.parse(localStorage.getItem('silentp-state-v3') || localStorage.getItem('silentp-state-v2') || 'null');
    } catch {
      return;
    }
    if (!Array.isArray(legacy?.profiles)) return;
    const knownIds = new Set((await native.listProfiles()).map((profile) => profile.id));
    for (const profile of legacy.profiles) {
      if (!profile?.id || knownIds.has(profile.id) || profile.temporary) continue;
      const created = await native.createProfile({
        id: profile.id,
        name: profile.name,
        color: profile.color,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      });
      const legacyHost = (() => { try { return new URL(profile.url).hostname; } catch { return ''; } })();
      const legacyGoogle = ['accounts.google.com', 'mail.google.com', 'drive.google.com', 'docs.google.com', 'gmail.com'].includes(legacyHost);
      if (created && legacyGoogle) await native.authorizeFamily(created.id, 'google');
      if (created && profile.url && !legacyGoogle) await native.createCompartment(created.id, {
        id: `${profile.id}-primary`,
        name: profile.name,
        primaryUrl: profile.url,
        privacy: profile.privacy,
        permissions: profile.permissions,
        renderMode: profile.renderMode,
        uaPreset: profile.uaPreset,
        language: profile.language,
        externalLinkBehavior: profile.externalLinkBehavior,
        parkWhenInactive: profile.parkWhenInactive,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      });
      knownIds.add(profile.id);
    }
  }

  function renderShortcuts() {
    $('#containerShortcuts').innerHTML = profiles.length ? profiles.map((profile) => `
      <button class="shortcut" data-open-profile="${escapeHtml(profile.id)}">
        <span class="shortcut-icon" style="--container-color:${escapeHtml(profile.color)}">${escapeHtml(profile.name.slice(0, 2).toUpperCase())}</span>
        <span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml((profile.authorizedFamilies || []).map((family) => label(family.providerId)).join(', ') || 'Isolated profile')}</small></span>
      </button>
    `).join('') : '<p class="empty-copy">Your persistent profiles will appear here.</p>';
  }

  async function renderChrome() {
    const selected = activeTab();
    const newTab = selected ? '' : `
      <button class="tab active" role="tab" aria-selected="true">
        <span class="tab-dot" style="--tab-color:#7cf0d2"></span><span class="tab-title">New Tab</span>
      </button>`;
    $('#tabList').innerHTML = newTab + tabState.tabs.map((tab) => `
      <button class="tab ${tab.id === tabState.activeTabId ? 'active' : ''} ${tab.parked ? 'parked' : ''}" data-tab-id="${tab.id}" role="tab" aria-selected="${tab.id === tabState.activeTabId}">
        <span class="tab-dot" style="--tab-color:${escapeHtml(tab.color)}"></span>
        <span class="tab-title">${escapeHtml(tab.title || 'New tab')}</span>
        ${tab.keepActive ? '<span class="tab-state">LIVE</span>' : ''}
        <span class="tab-close" data-close-tab="${tab.id}">×</span>
      </button>
    `).join('');
    const live = tabState.tabs.filter((tab) => !tab.parked).length;
    $('#resourceSummary').textContent = `${live} live`;
    $('#newTabView').hidden = Boolean(selected);
    $('#addressInput').value = selected?.url || '';
    $('#keepActiveMenuItem').textContent = `Keep Active: ${selected?.keepActive ? 'On' : 'Off'}`;
    $('#parkTabMenuItem').disabled = !selected;
    if (selected) {
      activePrivacy = await native.getActivePrivacy();
      activeContainer = activePrivacy?.compartment || await native.getActiveContainer();
      $('#containerName').textContent = `${activePrivacy?.profile?.name || selected.profileName || 'Profile'} · ${activeContainer?.name || selected.compartmentName || 'Site'}`;
      $('#containerDot').style.background = activePrivacy?.profile?.color || selected.color;
    } else {
      activeContainer = null;
      activePrivacy = null;
      $('#containerName').textContent = 'New tab';
      $('#containerDot').style.background = '#7cf0d2';
    }
  }

  async function openWithContainer(containerId, url) {
    closePopovers();
    const selected = activeTab();
    if (selected?.containerId === containerId) await native.navigate(url);
    else await native.openTab({ containerId, url });
  }

  async function createForUrl(url, temporary) {
    const parsed = new URL(url);
    const container = await native.createContainer({
      name: temporary ? `Private · ${parsed.hostname}` : parsed.hostname,
      primaryUrl: url,
      temporary
    });
    await openWithContainer(container.id, url);
    await refreshContainers();
  }

  function showRouteChooser(route) {
    pendingRoute = route;
    const choices = route.action === 'choose' ? route.matches.map((match) => `
      <button data-route-container="${escapeHtml(match.id)}"><strong>${escapeHtml(match.name)}</strong><small>${escapeHtml(match.primaryUrl)}</small></button>
    `).join('') : '';
    $('#containerChooser').innerHTML = `${choices}
      <button data-route-new="persistent"><strong>New isolated container</strong><small>Keep logins and storage until you remove it</small></button>
      <button data-route-new="temporary"><strong>Temporary / private</strong><small>Destroy storage when its last tab closes</small></button>`;
    $('#containerChooser').hidden = false;
  }

  async function routeAddress(value) {
    const url = addressFromInput(value);
    if (!url) return showToast('Enter a valid address or search');
    if (!native) return window.location.assign(url);
    const route = await native.routeProfileUrl(url);
    if (route.action === 'open') return openWithContainer(route.compartmentId, route.url);
    if (route.action === 'choose' || route.action === 'create') return showRouteChooser(route);
    showToast('Only HTTP and HTTPS addresses are supported');
  }

  function renderPermissions() {
    if (!activePrivacy || !activeContainer) return;
    const view = window.fypmUiModel.privacyViewModel(activePrivacy);
    $('#permissionsContainerName').textContent = view.compartmentName;
    $('#permissionsPreset').textContent = `${view.protectionLabel} · Compatibility ${view.compatibilityLevel}`;
    $('#privacyProfile').textContent = view.profileName;
    $('#privacyCompartment').textContent = view.compartmentName;
    $('#privacyBlocked').textContent = String(view.blockedRequestCount);
    $('#privacyProvider').textContent = view.authorizedFamily;
    $('#permissionPreset').value = String(view.compatibilityLevel);
    $('#temporaryAllowances').innerHTML = view.temporaryAllowances.length
      ? view.temporaryAllowances.map((allowance) => `<div>${escapeHtml(allowance.host)}${allowance.reason ? ` · ${escapeHtml(allowance.reason)}` : ''}</div>`).join('')
      : 'None';
    $('#permissionControls').innerHTML = PERMISSIONS.map((permission) => `
      <label><span>${label(permission)}</span><input type="checkbox" data-permission="${permission}" ${activeContainer.permissions?.[permission] ? 'checked' : ''}></label>
    `).join('');
  }

  function domainRulesFromText(value) {
    return String(value || '').split(/\r?\n/).map((entry) => entry.trim().toLowerCase()).filter(Boolean).map((entry) =>
      entry.startsWith('*.') ? { type: 'suffix', value: entry.slice(2) } : { type: 'exact', value: entry }
    );
  }

  function populateContainerForm(container = null) {
    $('#containerId').value = container?.id || '';
    $('#containerFieldName').value = container?.name || '';
    $('#containerFieldUrl').value = container?.primaryUrl || '';
    $('#containerFieldDomains').value = (container?.domainRules || []).map((rule) => `${rule.type === 'suffix' ? '*.' : ''}${rule.value}`).join('\n');
    $('#containerFieldPreset').value = container?.privacyPreset || 'hardened';
    $('#deleteContainerButton').hidden = !container;
    $('#clearContainerButton').hidden = !container;
  }

  function openContainerDialog(container = null, managing = false) {
    $('#containerDialogTitle').textContent = container ? 'Edit container' : 'New isolated container';
    $('#containerPickerRow').hidden = !managing;
    if (managing) {
      const saved = containers.filter((candidate) => !candidate.temporary);
      $('#containerPicker').innerHTML = saved.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`).join('');
      $('#containerPicker').value = container?.id || saved[0]?.id || '';
    }
    populateContainerForm(container);
    $('#containerDialog').showModal();
  }

  async function openProfileDialog(profileId) {
    const profile = profiles.find((candidate) => candidate.id === profileId) || profiles[0];
    if (!profile) return showToast('Create a profile first');
    const sites = await native.listCompartments(profile.id);
    const allowances = await native.listCompatibilityAllowances(profile.id);
    const manager = window.fypmUiModel.profileManagerViewModel({ profile, compartments: sites, allowances });
    $('#profilePicker').innerHTML = profiles.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`).join('');
    $('#profilePicker').value = profile.id;
    $('#profileName').value = profile.name;
    $('#profileGoogleFamily').checked = manager.families.some((family) => family.providerId === 'google');
    $('#profileCompartments').innerHTML = manager.compartments.length ? manager.compartments.map((site) => `
      <div class="manager-row"><span><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.primaryUrl || site.key)}</small></span><button type="button" data-clear-site="${escapeHtml(site.id)}">Clear site data</button></div>
    `).join('') : '<p class="empty-copy">No persistent site compartments.</p>';
    $('#profileAllowances').innerHTML = manager.allowances.length ? manager.allowances.map((allowance) => `
      <div class="manager-row"><span><strong>${escapeHtml(allowance.host)}</strong><small>${allowance.temporary ? 'Temporary' : 'Pinned'} · level ${allowance.level}</small></span>${allowance.temporary ? `<button type="button" data-pin-allowance="${escapeHtml(allowance.id)}" data-site="${escapeHtml(allowance.compartmentId)}">Pin</button>` : ''}<button type="button" data-remove-allowance="${escapeHtml(allowance.id)}" data-site="${escapeHtml(allowance.compartmentId)}">Remove</button></div>
    `).join('') : '<p class="empty-copy">No compatibility allowances.</p>';
    $('#profileDialog').dataset.profileId = profile.id;
    if (!$('#profileDialog').open) $('#profileDialog').showModal();
  }

  async function initialize() {
    if (!native) {
      $('#containerShortcuts').innerHTML = '<p class="empty-copy">Install FYPM Browser for isolated native containers.</p>';
      return;
    }
    await importLegacyProfiles();
    await refreshContainers();
    tabState = await native.listTabs();
    await renderChrome();

    native.onTabsChanged(async (nextState) => {
      tabState = nextState;
      await renderChrome();
      if (nextState.releasedCount) showToast(`${nextState.releasedCount} inactive tab${nextState.releasedCount === 1 ? '' : 's'} released`);
      if (nextState.notice?.message) showToast(nextState.notice.message);
    });
    native.onBrowserNotice((notice) => notice?.message && showToast(notice.message));
    native.onDownloadsChanged((download) => {
      const total = Number(download.totalBytes) || 0;
      const percent = total ? ` ${Math.round((Number(download.receivedBytes) || 0) / total * 100)}%` : '';
      $('#downloadChip').textContent = `${download.filename} · ${download.state}${percent}`;
      $('#downloadChip').hidden = false;
      if (['completed', 'cancelled', 'interrupted'].includes(download.state)) setTimeout(() => { $('#downloadChip').hidden = true; }, 5000);
    });
  }

  $('#addressForm').onsubmit = (event) => { event.preventDefault(); routeAddress($('#addressInput').value); };
  $('#startSearchForm').onsubmit = (event) => { event.preventDefault(); routeAddress($('#startSearchInput').value); };
  $('#newTabButton').onclick = $('#tabAddButton').onclick = async () => { closePopovers(); await native?.showDashboard(); $('#startSearchInput').focus(); };
  $('[data-command="back"]').onclick = () => native?.command('back');
  $('[data-command="forward"]').onclick = () => native?.command('forward');
  $('[data-command="reload"]').onclick = () => native?.command('reload');

  $('#tabList').onclick = async (event) => {
    const close = event.target.closest('[data-close-tab]');
    if (close) { event.stopPropagation(); return native.closeTab(close.dataset.closeTab); }
    const tab = event.target.closest('[data-tab-id]');
    if (tab) await native.activateTab(tab.dataset.tabId);
  };
  $('#containerShortcuts').onclick = (event) => {
    const shortcut = event.target.closest('[data-open-profile]');
    if (!shortcut) return;
    native.newWindow(shortcut.dataset.openProfile);
  };
  $('#containerChooser').onclick = (event) => {
    const existing = event.target.closest('[data-route-container]');
    if (existing) return openWithContainer(existing.dataset.routeContainer, pendingRoute.url);
    const create = event.target.closest('[data-route-new]');
    if (create) createForUrl(pendingRoute.url, create.dataset.routeNew === 'temporary');
  };

  $('#permissionsButton').onclick = async () => {
    if (!activeTab()) return showToast('Open a site to view its permissions');
    activePrivacy = await native.getActivePrivacy();
    activeContainer = activePrivacy?.compartment || null;
    renderPermissions();
    const show = $('#permissionsPopover').hidden;
    closePopovers();
    $('#permissionsPopover').hidden = !show;
    $('#permissionsButton').setAttribute('aria-expanded', String(show));
    if (show) native.setChromeHeight?.(430);
  };
  $('#permissionControls').onchange = async (event) => {
    const input = event.target.closest('[data-permission]');
    if (!input || !activeContainer) return;
    activeContainer = await native.setCompartmentPermission(activePrivacy.profile.id, activeContainer.id, input.dataset.permission, input.checked);
    activePrivacy = await native.getActivePrivacy();
    renderPermissions();
  };
  $('#permissionPreset').onchange = async (event) => {
    if (!activeContainer || !activePrivacy) return;
    activeContainer = await native.setCompatibilityLevel(activePrivacy.profile.id, activeContainer.id, Number(event.target.value));
    activePrivacy = await native.getActivePrivacy();
    renderPermissions();
  };

  $('#mainMenuButton').onclick = () => {
    const show = $('#mainMenu').hidden;
    closePopovers();
    $('#mainMenu').hidden = !show;
    $('#mainMenuButton').setAttribute('aria-expanded', String(show));
    if (show) native?.setChromeHeight?.(380);
  };
  $('#keepActiveMenuItem').onclick = async () => { const tab = activeTab(); if (tab) await native.setKeepActive(tab.id, !tab.keepActive); closePopovers(); };
  $('#parkTabMenuItem').onclick = async () => { const tab = activeTab(); if (tab) await native.parkTab(tab.id); closePopovers(); };
  $('#releaseInactiveMenuItem').onclick = async () => { const count = await native.releaseInactiveTabs(); showToast(`${count} inactive tabs released`); closePopovers(); };
  $('#manageContainersMenuItem').onclick = async () => {
    closePopovers();
    await native.showDashboard();
    await openProfileDialog(activePrivacy?.profile?.id || tabState.profileId || profiles[0]?.id);
  };
  $('#newWindowMenuItem').onclick = () => { native.newWindow(); closePopovers(); };
  $('#quitReleaseMenuItem').onclick = () => native.quitAndRelease();
  $('#createContainerButton').onclick = async () => {
    const profile = await native.createProfile({ name: `Profile ${profiles.length + 1}` });
    await refreshContainers();
    await openProfileDialog(profile.id);
  };
  $('#containerPicker').onchange = (event) => {
    const container = containers.find((candidate) => candidate.id === event.target.value) || null;
    populateContainerForm(container);
  };
  $('#profilePicker').onchange = (event) => openProfileDialog(event.target.value);
  $('#profileForm').onsubmit = async (event) => {
    event.preventDefault();
    const profileId = $('#profileDialog').dataset.profileId;
    await native.updateProfile(profileId, { name: $('#profileName').value.trim() });
    if ($('#profileGoogleFamily').checked) await native.authorizeFamily(profileId, 'google');
    $('#profileDialog').close();
    await refreshContainers();
  };
  $('#profileCompartments').onclick = async (event) => {
    const button = event.target.closest('[data-clear-site]');
    if (!button) return;
    const profileId = $('#profileDialog').dataset.profileId;
    if (!confirm('Clear cookies, logins, cache, and site storage for this compartment?')) return;
    await native.clearCompartment(profileId, button.dataset.clearSite);
    showToast('Site compartment data cleared');
  };
  $('#profileAllowances').onclick = async (event) => {
    const pin = event.target.closest('[data-pin-allowance]');
    const remove = event.target.closest('[data-remove-allowance]');
    const profileId = $('#profileDialog').dataset.profileId;
    if (pin) await native.pinCompatibilityAllowance(profileId, pin.dataset.site, pin.dataset.pinAllowance);
    if (remove) await native.removeCompatibilityAllowance(profileId, remove.dataset.site, remove.dataset.removeAllowance);
    await openProfileDialog(profileId);
  };
  $('#removeProfileButton').onclick = async () => {
    const profileId = $('#profileDialog').dataset.profileId;
    if (!confirm('Remove this profile and only its site data? Other profiles are not affected.')) return;
    await native.removeProfile(profileId);
    $('#profileDialog').close();
    await refreshContainers();
  };
  document.querySelectorAll('[data-close-popover]').forEach((button) => { button.onclick = closePopovers; });

  $('#containerForm').onsubmit = async (event) => {
    event.preventDefault();
    const id = $('#containerId').value;
    const changes = {
      name: $('#containerFieldName').value.trim(),
      primaryUrl: addressFromInput($('#containerFieldUrl').value) || '',
      domainRules: domainRulesFromText($('#containerFieldDomains').value)
    };
    let container;
    if (id) container = await native.updateContainer(id, changes);
    else container = await native.createContainer(changes);
    const preset = $('#containerFieldPreset').value;
    if (container && preset !== 'custom' && preset !== container.privacyPreset) await native.applyContainerPreset(container.id, preset);
    $('#containerDialog').close();
    await refreshContainers();
  };
  $('#deleteContainerButton').onclick = async () => {
    const id = $('#containerId').value;
    if (!id || !confirm('Delete this saved container? Its open tabs must be closed first.')) return;
    const removed = await native.removeContainer(id);
    if (!removed) return showToast('Close every tab using this container before deleting it');
    $('#containerDialog').close();
    await refreshContainers();
  };
  $('#clearContainerButton').onclick = async () => {
    const id = $('#containerId').value;
    if (!id || !confirm('Clear cookies, logins, cache, and site storage for this container?')) return;
    await native.clearContainer(id);
    showToast('Container site data cleared');
  };

  document.addEventListener('keydown', async (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'l') { event.preventDefault(); $('#addressInput').focus(); $('#addressInput').select(); }
    if (modifier && event.key.toLowerCase() === 't') { event.preventDefault(); await native?.showDashboard(); $('#startSearchInput').focus(); }
    if (modifier && event.key.toLowerCase() === 'w') { const tab = activeTab(); if (tab) { event.preventDefault(); native.closeTab(tab.id); } }
    if (modifier && event.key.toLowerCase() === 'r') { event.preventDefault(); native?.command('reload'); }
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); native?.command('back'); }
    if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); native?.command('forward'); }
    if (event.key === 'Escape') closePopovers();
  });

  initialize().catch((error) => showToast(error.message || 'FYPM Browser failed to initialize'));
})();
