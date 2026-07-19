(() => {
  'use strict';

  const APP = {
    name: 'Silent P. Progressive Webspace App',
    displayName: 'Silent P. PWSA',
    shortName: 'Silent P. PWA',
    repo: 'silentp.webspace',
    packageId: 'com.fypm.silentpwebspace',
    version: 2
  };
  const COLORS = ['#68e1c5','#7aa7ff','#c58cff','#ff8cb5','#f4bd72','#8dde72','#58cde1','#ff8178'];
  const PERMISSIONS = ['camera','microphone','location','notifications','clipboard','downloads','uploads','popups'];
  const TRACKING = new Set(['gclid','dclid','fbclid','msclkid','yclid','twclid','igshid','mc_cid','mc_eid','vero_id','ref_src','ref_url','campaign_id','ad_id','adgroup']);
  const native = Boolean(window.silentP?.isNative);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const uid = (p) => `${p}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`.replaceAll('-','').slice(0,24);
  const defaults = () => ({theme:'dark',sort:'recent',profile:{engine:'automatic',renderMode:'mobile',uaPreset:'mobile',language:'en-US',externalLinkBehavior:'internal',privacy:{clearUrls:true,blocking:true,gpc:true,webrtc:true},permissions:Object.fromEntries(PERMISSIONS.map(k=>[k,['downloads','uploads'].includes(k)]))}});
  const fresh = () => { const s={id:uid('w'),name:'Default',color:COLORS[0]}; return {version:APP.version,spaces:[s],profiles:[],settings:defaults()}; };

  let state = load();
  let activeSpace = state.spaces[0].id;
  let editingId = null;
  let toastTimer;

  function load(){
    try {
      const value=JSON.parse(localStorage.getItem('silentp-state-v2'));
      if(value?.spaces?.length && Array.isArray(value.profiles)){
        value.settings ||= defaults();
        value.settings.profile ||= defaults().profile;
        return value;
      }
    } catch {}
    return fresh();
  }
  function save(){ localStorage.setItem('silentp-state-v2',JSON.stringify(state)); render(); }
  function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function cap(v){ return String(v||'').replace(/^./,c=>c.toUpperCase()); }
  function normalize(value){
    let input=String(value||'').trim();
    if(!input)return null;
    if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(input))input=`https://${input}`;
    try{const u=new URL(input);return ['http:','https:'].includes(u.protocol)&&u.hostname?u:null;}catch{return null;}
  }
  function domain(host){const a=host.split('.').filter(Boolean);return a.length>2?a.slice(-2).join('.'):host;}
  function clean(value){
    try{const u=new URL(value);for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||TRACKING.has(k.toLowerCase()))u.searchParams.delete(k);return u.href;}catch{return value;}
  }
  function profile(url='',temporary=false){
    const u=normalize(url),d=state.settings.profile,host=u?domain(u.hostname):'',count=state.profiles.filter(p=>p.domain===host).length;
    return {id:uid('p'),spaceId:activeSpace,name:host?`${host}${count?` ${count+1}`:''}`:'',url:u?.href||'',domain:host,color:COLORS[state.profiles.length%COLORS.length],temporary,engine:d.engine,renderMode:d.renderMode,uaPreset:d.uaPreset,language:d.language,externalLinkBehavior:d.externalLinkBehavior,privacy:{...d.privacy},permissions:{...d.permissions},notes:'',createdAt:Date.now(),updatedAt:Date.now()};
  }
  function toast(text){const e=$('#toast');e.textContent=text;e.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.hidden=true,2600);}
  function rel(ts){const m=Math.floor((Date.now()-ts)/60000);return m<1?'just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:new Date(ts).toLocaleDateString();}

  function selected(){
    let list=state.profiles.filter(p=>p.spaceId===activeSpace&&!p.temporary);
    const q=$('#filterInput').value.trim().toLowerCase();
    if(q)list=list.filter(p=>`${p.name} ${p.domain} ${p.notes}`.toLowerCase().includes(q));
    const sort=$('#sortSelect').value||state.settings.sort;
    list.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='domain'?a.domain.localeCompare(b.domain):b.updatedAt-a.updatedAt);
    return list;
  }
  function renderSpaces(){
    $('#spaceList').innerHTML=state.spaces.map(s=>`<button class="space-item ${s.id===activeSpace?'active':''}" data-space="${s.id}"><span class="space-dot" style="background:${s.color}"></span><span>${esc(s.name)}</span><span class="space-count">${state.profiles.filter(p=>p.spaceId===s.id&&!p.temporary).length}</span></button>`).join('');
    $('#fieldSpace').innerHTML=state.spaces.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }
  function renderCards(){
    const list=selected();
    $('#profileGrid').innerHTML=list.map(p=>`<article class="profile-card" data-profile="${p.id}" style="--card-accent:${p.color}"><div class="card-head"><div class="card-avatar">${esc((p.name||p.domain||'P')[0].toUpperCase())}</div><div class="card-title"><strong>${esc(p.name||'Untitled')}</strong><small>${esc(p.domain||p.url)}</small></div><button class="icon-button card-menu" data-edit="${p.id}" title="Edit">•••</button></div><div class="card-tags"><span class="tag">${p.engine==='automatic'?'Auto':cap(p.engine)}</span><span class="tag">${cap(p.renderMode)}</span>${p.privacy.blocking?'<span class="tag">Blocking</span>':''}${p.privacy.gpc?'<span class="tag">GPC</span>':''}</div><div class="card-footer"><span>${rel(p.updatedAt)}</span><span class="launch-label">OPEN PROFILE →</span></div></article>`).join('');
    $('#emptyState').hidden=Boolean(list.length);
  }
  function render(){renderSpaces();renderCards();$('#profileCount').textContent=state.profiles.filter(p=>!p.temporary).length;$('#spaceCount').textContent=state.spaces.length;$('#nativeStatus').textContent=native?'Native':'Web';$('#sortSelect').value=state.settings.sort;document.documentElement.dataset.theme=state.settings.theme;}

  function openEditor(id=null,seed=''){
    editingId=id;const p=id?state.profiles.find(x=>x.id===id):profile(seed);if(!p)return;
    $('#editorHeading').textContent=id?(p.name||'Edit profile'):'New profile';
    $('#fieldName').value=p.name;$('#fieldUrl').value=p.url;$('#fieldSpace').value=p.spaceId;$('#fieldColor').value=p.color;
    const radio=$(`input[name=engine][value="${p.engine}"]`);if(radio)radio.checked=true;
    $('#fieldRender').value=p.renderMode;$('#fieldUa').value=p.uaPreset;$('#fieldExternal').value=p.externalLinkBehavior;$('#fieldLanguage').value=p.language;
    $('#privacyClearUrls').checked=p.privacy.clearUrls;$('#privacyBlocking').checked=p.privacy.blocking;$('#privacyGpc').checked=p.privacy.gpc;$('#privacyWebrtc').checked=p.privacy.webrtc;$('#fieldNotes').value=p.notes||'';
    $('#permissionGrid').innerHTML=PERMISSIONS.map(k=>`<label><span>${cap(k)}</span><input type="checkbox" data-permission="${k}" ${p.permissions[k]?'checked':''}></label>`).join('');
    $('#deleteProfileButton').hidden=!id;$('#editorOverlay').hidden=false;
  }
  function closeEditor(){editingId=null;$('#editorOverlay').hidden=true;}
  function readEditor(){
    const p=editingId?state.profiles.find(x=>x.id===editingId):profile(),u=normalize($('#fieldUrl').value);if(!p||!u){toast('Enter a valid website address');return null;}
    p.name=$('#fieldName').value.trim()||domain(u.hostname);p.url=u.href;p.domain=domain(u.hostname);p.spaceId=$('#fieldSpace').value;p.color=$('#fieldColor').value;p.engine=$('input[name=engine]:checked')?.value||'automatic';p.renderMode=$('#fieldRender').value;p.uaPreset=$('#fieldUa').value;p.externalLinkBehavior=$('#fieldExternal').value;p.language=$('#fieldLanguage').value.trim()||'en-US';p.privacy={clearUrls:$('#privacyClearUrls').checked,blocking:$('#privacyBlocking').checked,gpc:$('#privacyGpc').checked,webrtc:$('#privacyWebrtc').checked};p.permissions=Object.fromEntries($$('[data-permission]').map(e=>[e.dataset.permission,e.checked]));p.notes=$('#fieldNotes').value;p.updatedAt=Date.now();return p;
  }
  async function launch(id){
    const p=state.profiles.find(x=>x.id===id);if(!p)return;p.updatedAt=Date.now();save();const target=p.privacy.clearUrls?clean(p.url):p.url;
    if(native){document.body.classList.add('native-browsing');$('#browserIdentity').textContent=p.name;$('#browserIdentityDot').style.background=p.color;$('#browserAddress').value=target;$('#browserEngine').textContent=p.engine==='gecko'?'Gecko requested':'Chromium';await window.silentP.openProfile({...p,url:target});}
    else window.open(target,'_blank','noopener,noreferrer');
  }
  function exportAll(){const b=new Blob([JSON.stringify({...state,app:APP,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`silent-p-profiles-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
  function importAll(file){const r=new FileReader();r.onload=()=>{try{const v=JSON.parse(r.result);if(!Array.isArray(v.spaces)||!Array.isArray(v.profiles))throw new Error('Invalid export');state=v;state.settings||=defaults();activeSpace=state.spaces[0].id;save();toast('Profiles imported');}catch(e){toast(`Import failed: ${e.message}`);}};r.readAsText(file);}
  function modal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modalOverlay').hidden=false;}

  function nativeControls(){
    if(!native)return;
    const bar=$('#browserBar'),close=bar.querySelector('[data-browser="close"]');
    const release=document.createElement('button');release.className='button subtle small';release.dataset.browser='release';release.textContent='Release CPU';release.title='Destroy the active website renderer but keep saved profile data';bar.insertBefore(release,close);
    const map=document.createElement('button');map.className='button subtle';map.textContent='Map mode';map.title='Exit Silent P. PWSA completely so map software gets the CPU';map.onclick=async()=>{if(confirm('Exit Silent P. PWSA completely and release all browser CPU for map work?'))await window.silentP.quitForMaps();};document.querySelector('.header-actions').prepend(map);
  }

  function wire(){
    nativeControls();
    $('#omnibar').onsubmit=e=>{e.preventDefault();const u=normalize($('#urlInput').value);if(!u)return toast('Enter a valid website address');openEditor(null,u.href);$('#urlInput').value='';};
    $('#tempButton').onclick=()=>{const p=profile($('#urlInput').value,true);if(!p.url)return toast('Enter a valid website address');if(native){state.profiles.push(p);save();launch(p.id);}else window.open(clean(p.url),'_blank','noopener,noreferrer');};
    $('#newProfileButton').onclick=$('#emptyCreateButton').onclick=()=>openEditor();
    $('#newSpaceButton').onclick=()=>{const name=prompt('Webspace name');if(!name?.trim())return;const s={id:uid('w'),name:name.trim(),color:COLORS[state.spaces.length%COLORS.length]};state.spaces.push(s);activeSpace=s.id;save();};
    $('#spaceList').onclick=e=>{const b=e.target.closest('[data-space]');if(b){activeSpace=b.dataset.space;render();}};
    $('#profileGrid').onclick=e=>{const edit=e.target.closest('[data-edit]');if(edit){e.stopPropagation();openEditor(edit.dataset.edit);return;}const card=e.target.closest('[data-profile]');if(card)launch(card.dataset.profile);};
    $('#filterInput').oninput=renderCards;$('#sortSelect').onchange=e=>{state.settings.sort=e.target.value;save();};
    $('#saveProfileButton').onclick=()=>{const p=readEditor();if(!p)return;if(!editingId)state.profiles.push(p);activeSpace=p.spaceId;closeEditor();save();toast('Profile saved');};
    $('#deleteProfileButton').onclick=()=>{if(editingId&&confirm('Delete this profile?')){state.profiles=state.profiles.filter(p=>p.id!==editingId);closeEditor();save();}};
    $('#editorClose').onclick=$('#cancelProfileButton').onclick=closeEditor;$('#editorOverlay').onclick=e=>{if(e.target.id==='editorOverlay')closeEditor();};
    $('#themeButton').onclick=()=>{state.settings.theme=state.settings.theme==='dark'?'light':'dark';save();};$('#exportButton').onclick=exportAll;$('#importButton').onclick=()=>$('#importFile').click();$('#importFile').onchange=e=>{if(e.target.files[0])importAll(e.target.files[0]);e.target.value='';};
    $('#settingsButton').onclick=()=>modal('Project identity',`<p><strong>Official name:</strong> ${APP.name}</p><p><strong>Display name:</strong> ${APP.displayName}</p><p><strong>Short name:</strong> ${APP.shortName}</p><p><strong>Repository:</strong> <code>${APP.repo}</code></p><p><strong>Android ID:</strong> <code>${APP.packageId}</code></p>`);
    $('#aboutButton').onclick=()=>modal('About & boundaries','<p><strong>Silent P. PWSA</strong> uses separate native sessions in the desktop build. Web-only mode cannot enforce cross-site cookie isolation.</p><p><strong>CPU policy:</strong> one active website renderer, automatic renderer destruction on minimize, Release CPU control, and full Map mode exit.</p>');
    $('#modalClose').onclick=()=>$('#modalOverlay').hidden=true;$('#modalOverlay').onclick=e=>{if(e.target.id==='modalOverlay')e.currentTarget.hidden=true;};
    $('#browserAddressForm').onsubmit=e=>{e.preventDefault();const u=normalize($('#browserAddress').value);if(u)window.silentP.navigate(u.href);};
    $$('[data-browser]').forEach(b=>b.onclick=async()=>{const a=b.dataset.browser;if(a==='close'){await window.silentP.closeProfile();document.body.classList.remove('native-browsing');}else if(a==='release'){await window.silentP.releaseResources();document.body.classList.remove('native-browsing');}else if(a==='desktop')await window.silentP.toggleDesktop();else window.silentP.command(a);});
    window.silentP?.onBrowserState?.(s=>{if(s.url)$('#browserAddress').value=s.url;if(s.title)document.title=`${s.title} — Silent P. PWSA`;if(s.closed||s.released){document.body.classList.remove('native-browsing');document.title='Silent P. PWSA';if(s.released)toast('Website renderer closed. CPU released; profile data remains saved.');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#editorOverlay').hidden)closeEditor();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='l'){e.preventDefault();(document.body.classList.contains('native-browsing')?$('#browserAddress'):$('#urlInput')).focus();}});
  }

  wire();render();
  if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
