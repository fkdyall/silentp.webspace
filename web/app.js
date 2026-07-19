(() => {
  'use strict';

  const APP = {
    name: 'Silent P. Progressive Webspace App',
    displayName: 'Silent P. PWSA',
    shortName: 'Silent P. PWA',
    repo: 'silentp.webspace',
    packageId: 'com.fypm.silentpwebspace',
    version: 3
  };

  const COLORS = ['#68e1c5','#7aa7ff','#c58cff','#ff8cb5','#f4bd72','#8dde72','#58cde1','#ff8178'];
  const PERMISSIONS = ['camera','microphone','location','notifications','clipboard','downloads','uploads','popups'];
  const TRACKING = new Set(['gclid','dclid','fbclid','msclkid','yclid','twclid','igshid','mc_cid','mc_eid','vero_id','ref_src','ref_url','campaign_id','ad_id','adgroup']);
  const native = Boolean(window.silentP?.isNative);
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`.replaceAll('-','').slice(0,24);

  let tabState = { tabs: [], activeTabId: null, windowId: null };
  let editingId = null;
  let toastTimer = null;

  function defaultProfileSettings() {
    return {
      engine: 'automatic',
      renderMode: 'desktop',
      uaPreset: 'desktop',
      language: 'en-US',
      externalLinkBehavior: 'internal',
      privacyPreset: 'hardened',
      parkWhenInactive: false,
      privacy: {
        clearUrls: true,
        blocking: true,
        gpc: true,
        webrtc: true,
        thirdPartyCookies: false
      },
      permissions: Object.fromEntries(PERMISSIONS.map((key) => [key, ['downloads','uploads'].includes(key)]))
    };
  }

  function defaults() {
    return {
      theme: 'dark',
      sort: 'recent',
      profile: defaultProfileSettings()
    };
  }

  function freshState() {
    const space = { id: uid('w'), name: 'Default', color: COLORS[0] };
    return { version: APP.version, spaces: [space], profiles: [], settings: defaults() };
  }

  function loadState() {
    try {
      const value = JSON.parse(localStorage.getItem('silentp-state-v3') || localStorage.getItem('silentp-state-v2'));
      if (value?.spaces?.length && Array.isArray(value.profiles)) {
        value.version = APP.version;
        value.settings ||= defaults();
        value.settings.profile ||= defaultProfileSettings();
        for (const profile of value.profiles) migrateProfile(profile);
        return value;
      }
    } catch {}
    return freshState();
  }

  function migrateProfile(profile) {
    const d = defaultProfileSettings();
    profile.engine ||= d.engine;
    profile.renderMode ||= d.renderMode;
    profile.uaPreset ||= d.uaPreset;
    profile.language ||= d.language;
    profile.externalLinkBehavior ||= d.externalLinkBehavior;
    profile.privacyPreset ||= 'hardened';
    profile.parkWhenInactive = Boolean(profile.parkWhenInactive);
    profile.privacy = { ...d.privacy, ...(profile.privacy || {}) };
    profile.permissions = { ...d.permissions, ...(profile.permissions || {}) };
    return profile;
  }

  let state = loadState();
  let activeSpace = state.spaces[0].id;

  function saveState() {
    localStorage.setItem('silentp-state-v3', JSON.stringify(state));
    render();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[character]);
  }

  function capitalize(value) {
    return String(value || '').replace(/^./, (character) => character.toUpperCase());
  }

  function normalizeUrl(value) {
    let input = String(value || '').trim();
    if (!input) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;
    try {
      const url = new URL(input);
      return ['http:','https:'].includes(url.protocol) && url.hostname ? url : null;
    } catch {
      return null;
    }
  }

  function registrableDomain(hostname) {
    const parts = hostname.split('.').filter(Boolean);
    const knownSecondLevel = new Set(['co.uk','org.uk','ac.uk','com.au','co.jp','co.nz','com.br','co.za']);
    if (parts.length < 3) return hostname;
    const lastTwo = parts.slice(-2).join('.');
    return knownSecondLevel.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
  }

  function cleanUrl(value) {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) {
        if (/^utm_/i.test(key) || TRACKING.has(key.toLowerCase())) url.searchParams.delete(key);
      }
      return url.href;
    } catch {
      return value;
    }
  }

  function applyPreset(profile, preset) {
    migrateProfile(profile);
    profile.privacyPreset = preset;
    if (preset === 'hardened') {
      Object.assign(profile.privacy, { clearUrls:true, blocking:true, gpc:true, webrtc:true, thirdPartyCookies:false });
      Object.assign(profile.permissions, { popups:false, notifications:false, camera:false, microphone:false, location:false, clipboard:false });
    } else if (preset === 'balanced') {
      Object.assign(profile.privacy, { clearUrls:true, blocking:true, gpc:true, webrtc:true, thirdPartyCookies:false });
      profile.permissions.popups = true;
    } else if (preset === 'compatibility') {
      Object.assign(profile.privacy, { clearUrls:true, blocking:false, gpc:true, webrtc:false, thirdPartyCookies:true });
      profile.permissions.popups = true;
    }
    return profile;
  }

  function createProfile(url = '', temporary = false) {
    const parsed = normalizeUrl(url);
    const settings = state.settings.profile;
    const host = parsed ? registrableDomain(parsed.hostname) : '';
    const count = state.profiles.filter((profile) => profile.domain === host).length;
    const profile = {
      id: uid('p'),
      spaceId: activeSpace,
      name: host ? `${host}${count ? ` ${count + 1}` : ''}` : '',
      url: parsed?.href || '',
      domain: host,
      color: COLORS[state.profiles.length % COLORS.length],
      temporary,
      engine: settings.engine,
      renderMode: settings.renderMode,
      uaPreset: settings.uaPreset,
      language: settings.language,
      externalLinkBehavior: settings.externalLinkBehavior,
      privacyPreset: settings.privacyPreset,
      parkWhenInactive: settings.parkWhenInactive,
      privacy: { ...settings.privacy },
      permissions: { ...settings.permissions },
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return applyPreset(profile, profile.privacyPreset);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function relativeTime(timestamp) {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  function selectedProfiles() {
    let profiles = state.profiles.filter((profile) => profile.spaceId === activeSpace && !profile.temporary);
    const query = $('#filterInput').value.trim().toLowerCase();
    if (query) profiles = profiles.filter((profile) => `${profile.name} ${profile.domain} ${profile.notes}`.toLowerCase().includes(query));
    const sort = $('#sortSelect').value || state.settings.sort;
    profiles.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'domain') return a.domain.localeCompare(b.domain);
      return b.updatedAt - a.updatedAt;
    });
    return profiles;
  }

  function renderSpaces() {
    $('#spaceList').innerHTML = state.spaces.map((space) => {
      const count = state.profiles.filter((profile) => profile.spaceId === space.id && !profile.temporary).length;
      return `<button class="space-item ${space.id === activeSpace ? 'active' : ''}" data-space="${space.id}">
        <span class="space-dot" style="background:${space.color}"></span>
        <span>${escapeHtml(space.name)}</span><span class="space-count">${count}</span>
      </button>`;
    }).join('');
    $('#fieldSpace').innerHTML = state.spaces.map((space) => `<option value="${space.id}">${escapeHtml(space.name)}</option>`).join('');
  }

  function renderCards() {
    const profiles = selectedProfiles();
    $('#profileGrid').innerHTML = profiles.map((profile) => `
      <article class="profile-card" data-profile="${profile.id}" style="--card-accent:${profile.color}">
        <div class="card-head">
          <div class="card-avatar">${escapeHtml((profile.name || profile.domain || 'P')[0].toUpperCase())}</div>
          <div class="card-title"><strong>${escapeHtml(profile.name || 'Untitled')}</strong><small>${escapeHtml(profile.domain || profile.url)}</small></div>
          <button class="icon-button card-menu" data-edit="${profile.id}" title="Edit profile">•••</button>
        </div>
        <div class="card-tags">
          <span class="tag">${capitalize(profile.privacyPreset)}</span>
          <span class="tag">${capitalize(profile.renderMode)}</span>
          <span class="tag">${profile.parkWhenInactive ? 'Parks inactive' : 'Stays loaded'}</span>
        </div>
        <div class="card-footer"><span>${relativeTime(profile.updatedAt)}</span><span class="launch-label">OPEN ISOLATED TAB →</span></div>
      </article>
    `).join('');
    $('#emptyState').hidden = profiles.length > 0;
  }

  function render() {
    renderSpaces();
    renderCards();
    $('#profileCount').textContent = state.profiles.filter((profile) => !profile.temporary).length;
    $('#spaceCount').textContent = state.spaces.length;
    $('#nativeStatus').textContent = native ? 'Native' : 'Web';
    $('#sortSelect').value = state.settings.sort;
    document.documentElement.dataset.theme = state.settings.theme;
  }

  function openEditor(profileId = null, seedUrl = '') {
    editingId = profileId;
    const profile = profileId ? state.profiles.find((item) => item.id === profileId) : createProfile(seedUrl);
    if (!profile) return;

    $('#editorHeading').textContent = profileId ? (profile.name || 'Edit profile') : 'New profile';
    $('#fieldName').value = profile.name;
    $('#fieldUrl').value = profile.url;
    $('#fieldSpace').value = profile.spaceId;
    $('#fieldColor').value = profile.color;
    $('#fieldPreset').value = profile.privacyPreset;
    $('#fieldInactive').value = profile.parkWhenInactive ? 'park' : 'live';
    const radio = $(`input[name=engine][value="${profile.engine}"]`);
    if (radio) radio.checked = true;
    $('#fieldRender').value = profile.renderMode;
    $('#fieldUa').value = profile.uaPreset;
    $('#fieldExternal').value = profile.externalLinkBehavior;
    $('#fieldLanguage').value = profile.language;
    $('#privacyClearUrls').checked = profile.privacy.clearUrls;
    $('#privacyBlocking').checked = profile.privacy.blocking;
    $('#privacyGpc').checked = profile.privacy.gpc;
    $('#privacyWebrtc').checked = profile.privacy.webrtc;
    $('#fieldNotes').value = profile.notes || '';
    $('#permissionGrid').innerHTML = PERMISSIONS.map((permission) => `
      <label><span>${capitalize(permission)}</span>
      <input type="checkbox" data-permission="${permission}" ${profile.permissions[permission] ? 'checked' : ''}></label>
    `).join('');
    $('#deleteProfileButton').hidden = !profileId;
    $('#editorOverlay').hidden = false;
  }

  function closeEditor() {
    editingId = null;
    $('#editorOverlay').hidden = true;
  }

  function readEditor() {
    const profile = editingId ? state.profiles.find((item) => item.id === editingId) : createProfile();
    const url = normalizeUrl($('#fieldUrl').value);
    if (!profile || !url) {
      showToast('Enter a valid website address');
      return null;
    }

    profile.name = $('#fieldName').value.trim() || registrableDomain(url.hostname);
    profile.url = url.href;
    profile.domain = registrableDomain(url.hostname);
    profile.spaceId = $('#fieldSpace').value;
    profile.color = $('#fieldColor').value;
    profile.engine = $('input[name=engine]:checked')?.value || 'automatic';
    profile.renderMode = $('#fieldRender').value;
    profile.uaPreset = $('#fieldUa').value;
    profile.externalLinkBehavior = $('#fieldExternal').value;
    profile.language = $('#fieldLanguage').value.trim() || 'en-US';
    profile.privacyPreset = $('#fieldPreset').value;
    profile.parkWhenInactive = $('#fieldInactive').value === 'park';
    profile.privacy = {
      ...profile.privacy,
      clearUrls: $('#privacyClearUrls').checked,
      blocking: $('#privacyBlocking').checked,
      gpc: $('#privacyGpc').checked,
      webrtc: $('#privacyWebrtc').checked
    };
    profile.permissions = Object.fromEntries($$('[data-permission]').map((input) => [input.dataset.permission, input.checked]));
    profile.notes = $('#fieldNotes').value;
    profile.updatedAt = Date.now();
    if (profile.privacyPreset !== 'custom') applyPreset(profile, profile.privacyPreset);
    return profile;
  }

  async function launchProfile(profileId) {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    profile.updatedAt = Date.now();
    saveState();
    const target = profile.privacy.clearUrls ? cleanUrl(profile.url) : profile.url;

    if (native) {
      await window.silentP.openTab({ ...profile, url: target });
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify({ ...state, app: APP, exportedAt: new Date().toISOString() }, null, 2)], { type:'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `silent-p-profiles-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importAll(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.spaces) || !Array.isArray(incoming.profiles)) throw new Error('Invalid profile export');
        state = incoming;
        state.settings ||= defaults();
        state.settings.profile ||= defaultProfileSettings();
        state.profiles.forEach(migrateProfile);
        activeSpace = state.spaces[0]?.id;
        saveState();
        showToast('Profiles imported');
      } catch (error) {
        showToast(`Import failed: ${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalOverlay').hidden = false;
  }

  function activeTab() {
    return tabState.tabs.find((tab) => tab.id === tabState.activeTabId) || null;
  }

  function renderNativeTabs() {
    if (!native) return;
    $('#nativeTabStrip').hidden = false;
    const list = $('#nativeTabList');
    list.innerHTML = tabState.tabs.map((tab) => `
      <button class="native-tab ${tab.id === tabState.activeTabId ? 'active' : ''} ${tab.parked ? 'parked' : ''}"
              data-tab-id="${tab.id}" style="--tab-accent:${tab.color}">
        <span class="native-tab-dot"></span>
        <span class="native-tab-title">${escapeHtml(tab.title || 'Tab')}</span>
        ${tab.keepActive ? '<span class="native-tab-badge" title="Keep Active">LIVE</span>' : ''}
        ${tab.parked ? '<span class="native-tab-badge parked-badge" title="Parked">PARKED</span>' : ''}
        <span class="native-tab-close" data-close-tab="${tab.id}" title="Close tab">×</span>
      </button>
    `).join('');

    const live = tabState.tabs.filter((tab) => !tab.parked).length;
    const kept = tabState.tabs.filter((tab) => tab.keepActive).length;
    $('#tabResourceSummary').textContent = `${live} live · ${kept} kept active`;

    const active = activeTab();
    if (active) {
      document.body.classList.add('native-browsing');
      $('#browserBar').hidden = false;
      $('#browserIdentity').textContent = active.title || 'Tab';
      $('#browserIdentityDot').style.background = active.color;
      $('#browserAddress').value = active.url || '';
      $('#activePrivacyPreset').value = active.privacyPreset || 'hardened';
      $('#keepActiveButton').textContent = `Keep Active: ${active.keepActive ? 'On' : 'Off'}`;
      $('#keepActiveButton').classList.toggle('active-toggle', active.keepActive);
    } else {
      document.body.classList.remove('native-browsing');
      $('#browserBar').hidden = true;
    }
  }

  function initializeNativeControls() {
    if (!native) return;
    document.body.classList.add('native-runtime');
    $$('.native-only').forEach((element) => { element.hidden = false; });

    $('#nativeTabList').addEventListener('click', async (event) => {
      const close = event.target.closest('[data-close-tab]');
      if (close) {
        event.stopPropagation();
        await window.silentP.closeTab(close.dataset.closeTab);
        return;
      }
      const tab = event.target.closest('[data-tab-id]');
      if (tab) await window.silentP.activateTab(tab.dataset.tabId);
    });

    $('#tabHomeButton').onclick = async () => window.silentP.showDashboard();
    $('#tabAddButton').onclick = async () => {
      await window.silentP.showDashboard();
      setTimeout(() => $('#urlInput').focus(), 0);
    };
    $('#releaseInactiveButton').onclick = async () => {
      const count = await window.silentP.releaseInactiveTabs();
      showToast(`${count} inactive tab${count === 1 ? '' : 's'} parked. Keep Active tabs were left running.`);
    };
    $('#newWindowButton').onclick = () => window.silentP.newWindow();
    $('#quitReleaseButton').onclick = async () => {
      if (confirm('Save the current window and tab layout, then exit Silent P. PWSA completely?')) {
        await window.silentP.quitAndRelease();
      }
    };

    $('#keepActiveButton').onclick = async () => {
      const tab = activeTab();
      if (tab) await window.silentP.setKeepActive(tab.id, !tab.keepActive);
    };
    $('#parkTabButton').onclick = async () => {
      const tab = activeTab();
      if (tab) await window.silentP.parkTab(tab.id);
    };
    $('#detachTabButton').onclick = async () => {
      const tab = activeTab();
      if (tab) await window.silentP.detachTab(tab.id);
    };
    $('#closeActiveTabButton').onclick = async () => {
      const tab = activeTab();
      if (tab) await window.silentP.closeTab(tab.id);
    };
    $('#activePrivacyPreset').onchange = async (event) => {
      const tab = activeTab();
      if (tab) await window.silentP.setPrivacyPreset(tab.id, event.target.value);
    };

    window.silentP.onTabsChanged((nextState) => {
      tabState = nextState;
      renderNativeTabs();
      if (nextState.releasedCount) showToast(`${nextState.releasedCount} inactive tabs parked`);
      if (nextState.notice?.message) showToast(nextState.notice.message);
    });

    window.silentP.onBrowserNotice((notice) => {
      if (notice?.message) showToast(notice.message);
    });

    window.silentP.listTabs().then((initial) => {
      tabState = initial;
      renderNativeTabs();
    });
  }

  function wire() {
    initializeNativeControls();

    $('#homeButton').onclick = async () => {
      if (native) await window.silentP.showDashboard();
    };

    $('#omnibar').onsubmit = (event) => {
      event.preventDefault();
      const url = normalizeUrl($('#urlInput').value);
      if (!url) return showToast('Enter a valid website address');
      openEditor(null, url.href);
      $('#urlInput').value = '';
    };

    $('#tempButton').onclick = async () => {
      const profile = createProfile($('#urlInput').value, true);
      if (!profile.url) return showToast('Enter a valid website address');
      if (native) await window.silentP.openTab(profile);
      else window.open(cleanUrl(profile.url), '_blank', 'noopener,noreferrer');
    };

    $('#newProfileButton').onclick = $('#emptyCreateButton').onclick = () => openEditor();

    $('#newSpaceButton').onclick = () => {
      const name = prompt('Webspace name');
      if (!name?.trim()) return;
      const space = { id: uid('w'), name: name.trim(), color: COLORS[state.spaces.length % COLORS.length] };
      state.spaces.push(space);
      activeSpace = space.id;
      saveState();
    };

    $('#spaceList').onclick = (event) => {
      const button = event.target.closest('[data-space]');
      if (button) {
        activeSpace = button.dataset.space;
        render();
      }
    };

    $('#profileGrid').onclick = (event) => {
      const edit = event.target.closest('[data-edit]');
      if (edit) {
        event.stopPropagation();
        openEditor(edit.dataset.edit);
        return;
      }
      const card = event.target.closest('[data-profile]');
      if (card) launchProfile(card.dataset.profile);
    };

    $('#filterInput').oninput = renderCards;
    $('#sortSelect').onchange = (event) => {
      state.settings.sort = event.target.value;
      saveState();
    };

    $('#fieldPreset').onchange = (event) => {
      const draft = {
        privacy: {
          clearUrls: $('#privacyClearUrls').checked,
          blocking: $('#privacyBlocking').checked,
          gpc: $('#privacyGpc').checked,
          webrtc: $('#privacyWebrtc').checked
        },
        permissions: Object.fromEntries($$('[data-permission]').map((input) => [input.dataset.permission, input.checked]))
      };
      applyPreset(draft, event.target.value);
      $('#privacyClearUrls').checked = draft.privacy.clearUrls;
      $('#privacyBlocking').checked = draft.privacy.blocking;
      $('#privacyGpc').checked = draft.privacy.gpc;
      $('#privacyWebrtc').checked = draft.privacy.webrtc;
      for (const input of $$('[data-permission]')) input.checked = Boolean(draft.permissions[input.dataset.permission]);
    };

    $('#saveProfileButton').onclick = () => {
      const profile = readEditor();
      if (!profile) return;
      if (!editingId) state.profiles.push(profile);
      activeSpace = profile.spaceId;
      closeEditor();
      saveState();
      showToast('Profile saved');
    };

    $('#deleteProfileButton').onclick = () => {
      if (editingId && confirm('Delete this saved profile? Open tabs are separate and will not be closed.')) {
        state.profiles = state.profiles.filter((profile) => profile.id !== editingId);
        closeEditor();
        saveState();
      }
    };

    $('#editorClose').onclick = $('#cancelProfileButton').onclick = closeEditor;
    $('#editorOverlay').onclick = (event) => {
      if (event.target.id === 'editorOverlay') closeEditor();
    };

    $('#themeButton').onclick = () => {
      state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
      saveState();
    };
    $('#exportButton').onclick = exportAll;
    $('#importButton').onclick = () => $('#importFile').click();
    $('#importFile').onchange = (event) => {
      if (event.target.files[0]) importAll(event.target.files[0]);
      event.target.value = '';
    };

    $('#settingsButton').onclick = () => openModal('Project identity', `
      <p><strong>Official name:</strong> ${APP.name}</p>
      <p><strong>Display name:</strong> ${APP.displayName}</p>
      <p><strong>Repository:</strong> <code>${APP.repo}</code></p>
      <p><strong>Android ID:</strong> <code>${APP.packageId}</code></p>
    `);

    $('#aboutButton').onclick = () => openModal('Desktop behavior', `
      <p><strong>Technical:</strong> Every native tab uses a unique Electron session partition. Authentication popups inherit only their parent tab's partition.</p>
      <p><strong>Plain meaning:</strong> Each tab has its own cookies and login. A GitHub sign-in window can return to the GitHub tab that opened it without sharing that login with unrelated tabs.</p>
      <p><strong>Companion use:</strong> Mark any tabs that must keep working as <em>Keep Active</em>. Release inactive parks the rest. Exit &amp; Free Resources closes the entire application.</p>
    `);

    $('#modalClose').onclick = () => { $('#modalOverlay').hidden = true; };
    $('#modalOverlay').onclick = (event) => {
      if (event.target.id === 'modalOverlay') event.currentTarget.hidden = true;
    };

    $('#browserAddressForm').onsubmit = (event) => {
      event.preventDefault();
      const url = normalizeUrl($('#browserAddress').value);
      if (url) window.silentP.navigate(url.href);
    };

    $$('[data-browser]').forEach((button) => {
      button.onclick = async () => {
        if (button.dataset.browser === 'desktop') await window.silentP.toggleDesktop();
        else window.silentP.command(button.dataset.browser);
      };
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#editorOverlay').hidden) closeEditor();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        (document.body.classList.contains('native-browsing') ? $('#browserAddress') : $('#urlInput')).focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't' && native) {
        event.preventDefault();
        window.silentP.showDashboard().then(() => $('#urlInput').focus());
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && native) {
        const tab = activeTab();
        if (tab) {
          event.preventDefault();
          window.silentP.closeTab(tab.id);
        }
      }
    });
  }

  wire();
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
