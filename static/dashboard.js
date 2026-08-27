document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth(true);
  if (!user) return;

  document.getElementById('navAuth').innerHTML = `
    ${user.is_admin ? '<a href="/static/admin.html" class="gold" style="margin-right: 15px;">Admin</a>' : ''}
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="color:var(--text-muted)">${user.name}</span>
      <img src="${user.avatar_url || 'https://ui-avatars.com/api/?name=' + user.name + '&background=191919&color=fff'}" style="width:35px; height:35px; border-radius:50%;">
      <a href="/auth/logout" class="btn btn-secondary" style="padding: 0.4rem 1rem;">Logout</a>
    </div>
  `;

  document.getElementById('welcomeMsg').textContent = `Your Keys, ${user.name}`;

  loadKeys();
});

async function loadKeys() {
  const keysGrid = document.getElementById('keysGrid');
  const emptyState = document.getElementById('emptyState');
  
  const response = await fetch('/api/my-keys');
  if (!response.ok) {
    const errData = await response.json().catch(()=>({}));
    const errMsg = errData.error || 'Server error loading keys';
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = `<p style="color:var(--error); font-size:1.2rem; font-weight:bold;">${errMsg}</p>`;
    return;
  }
  
  const keys = await response.json();
  
  // FORCE DEBUG TO SCREEN
  document.getElementById('welcomeMsg').innerHTML = `DEBUG: response ok, keys length = ${keys.length}`;
  if (keys.length === 0) {
    emptyState.classList.remove('hidden');
    keysGrid.classList.add('hidden');
    return;
  }

    emptyState.classList.remove('hidden');
    keysGrid.classList.add('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  keysGrid.classList.remove('hidden');
  
  keysGrid.innerHTML = keys.map(k => {
    const svc = k.service || 'netflix';
    const isSpot = svc === 'spotify';
    const svcBadge = isSpot
      ? `<span class="badge-spotify" style="font-size:0.7rem;">🎵 Spotify</span>`
      : `<span class="badge-netflix" style="font-size:0.7rem;">🎬 Netflix</span>`;
    const accentColor   = isSpot ? '#1DB954' : 'rgba(229,9,20,0.3)';
    const btnColorStyle = isSpot
      ? `background:rgba(29,185,84,0.15); border-color:#1DB954; color:#1DB954;`
      : '';

    const buttonRow = isSpot
      ? `<button class="btn btn-primary" style="width:100%; padding:0.6rem; font-size:0.85rem; ${btnColorStyle}" onclick="generateLink(${k.id}, 'spotify', this)">
           🎵 Genera Link Spotify
         </button>`
      : `<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-bottom:1rem; transform: translateZ(50px);">
           <button class="btn btn-primary" style="padding:0.6rem 0.2rem; font-size:0.8rem;" onclick="generateLink(${k.id}, 'pc', this)">
             🖥️ PC / TV
           </button>
           <button class="btn btn-secondary" style="padding:0.6rem 0.2rem; font-size:0.8rem;" onclick="generateLink(${k.id}, 'ios', this)">
             🍏 Apple iOS
           </button>
           <button class="btn btn-secondary" style="padding:0.6rem 0.2rem; font-size:0.8rem;" onclick="generateLink(${k.id}, 'android', this)">
             🤖 Android
           </button>
         </div>`;

    return `
    <div class="ticket-card" id="key-card-${k.id}">
      <div class="ticket-header">
        <div style="display:flex; justify-content:space-between; align-items:center; transform: translateZ(40px);">
          <h3 style="letter-spacing:1.5px; font-weight:700; color:var(--text-color); cursor:pointer;" onclick="toggleKey(${k.id}, '${k.key_code}')" id="key-display-${k.id}">
            ${maskKey(k.key_code)}
          </h3>
          <div style="display:flex; gap:6px; align-items:center;">
            ${svcBadge}
            <div class="badge ${k.cookie_valid ? 'badge-success' : 'badge-error'}">
              <div class="dot ${k.cookie_valid ? 'green' : 'red'}"></div>
              ${k.cookie_valid ? 'Live' : 'Checking'}
            </div>
          </div>
        </div>
      </div>
      
      <div class="ticket-body">
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:1.5rem; text-transform:uppercase; letter-spacing:1px; transform: translateZ(30px);">
          Redeemed: <span style="color:white; font-weight:600;">${new Date(k.redeemed_at).toLocaleDateString()}</span>
        </p>
        
        <div style="margin-bottom:1rem; transform: translateZ(50px);">
          ${buttonRow}
        </div>
        
        <div id="link-container-${k.id}" class="hidden" style="background:rgba(0,0,0,0.6); padding:1rem; border-radius:8px; border:1px solid ${accentColor}; font-size:0.85rem; position:relative; transform: translateZ(40px);">
        </div>
      </div>
    </div>
  `}).join('');

  // Inizializza l'effetto 3D Glass
  if (window.VanillaTilt) {
    VanillaTilt.init(document.querySelectorAll(".ticket-card"), {
      max: 15,
      speed: 400,
      glare: true,
      "max-glare": 0.25,
      perspective: 1000,
    });
  }
}

window.generateLink = async function(id, type, btnElem) {
  const originalHtml = btnElem ? btnElem.innerHTML : '';
  if (btnElem) {
    btnElem.disabled = true;
    btnElem.innerHTML = '⏳ Generando...';
  }
  
  const linkContainer = document.getElementById(`link-container-${id}`);
  linkContainer.classList.add('hidden');
  
  try {
    const res = await api('POST', '/api/generate-link', { key_id: id });
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }

    // ── Spotify ──────────────────────────────────────────────────────────────
    if (res.service === 'spotify') {
      const url = res.url;
      if (!url) { showToast('Errore generazione link', 'error'); return; }
      linkContainer.innerHTML = `
        <div style="font-size:0.75rem; color:#1DB954; margin-bottom:6px; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
          <span>🎵 LINK SPOTIFY (UNIVERSALE)</span>
          <span style="color:var(--text-muted); font-size:0.7rem;">Live Token</span>
        </div>
        <div style="background:rgba(0,0,0,0.5); padding:8px; border-radius:6px; font-family:monospace; font-size:0.8rem; word-break:break-all; margin-bottom:10px; border:1px solid rgba(255,255,255,0.05); color:#fff;">
          ${url}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary" style="flex:1; padding:0.5rem; font-size:0.85rem;" onclick="copyToClipboard('${url}')">📋 Copia Link</button>
          <button class="btn btn-secondary" style="flex:1; padding:0.5rem; font-size:0.85rem;" onclick="window.location.href='${url}'">🎵 Apri Spotify</button>
        </div>
      `;
      linkContainer.classList.remove('hidden');
      showToast('🎵 Link Spotify pronto!', 'success');
      return;
    }

    // ── Netflix (untouched) ───────────────────────────────────────────────────
    let url = res.url;
    let label = '🖥️ PC / SmartTV';
    let isIOS = false;
    
    if (type === 'ios') {
      url = res.ios_url || res.url;
      label = '🍏 Apple iOS (Safari Web)';
      isIOS = true;
    } else if (type === 'android') {
      url = res.android_url || res.url;
      label = '🤖 Android';
    }
    
    if (!url) { showToast('Errore generazione link', 'error'); return; }
    
    linkContainer.innerHTML = `
      <div style="font-size:0.75rem; color:var(--accent-gold); margin-bottom:6px; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
        <span>✨ LINK FRESCO (${label})</span>
        <span style="color:var(--text-muted); font-size:0.7rem;">Live Token</span>
      </div>
      <div style="background:rgba(0,0,0,0.5); padding:8px; border-radius:6px; font-family:monospace; font-size:0.8rem; word-break:break-all; margin-bottom:10px; border:1px solid rgba(255,255,255,0.05); color:#fff;">
        ${url}
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" style="flex:1; min-width:120px; padding:0.5rem; font-size:0.8rem;" onclick="copyToClipboard('${url}')">
          📋 Copia Link
        </button>
        <a href="${url}" target="_blank" class="btn btn-secondary" style="flex:1; min-width:120px; padding:0.5rem; font-size:0.8rem; text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center;">
          🚀 Apri Subito
        </a>
        ${isIOS && res.ios_app_url ? `
          <a href="${res.ios_app_url}" target="_blank" class="btn btn-secondary" style="flex:100%; margin-top:4px; padding:0.45rem; font-size:0.75rem; text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center; border-color:rgba(255,215,0,0.4); color:var(--accent-gold);">
            📱 Apri direttamente nell'App Netflix
          </a>
        ` : ''}
      </div>
    `;
    linkContainer.classList.remove('hidden');
    showToast('Nuovo link generato!', 'success');
  } catch (err) {
    console.error(err);
    showToast('Errore di connessione', 'error');
  } finally {
    if (btnElem) {
      btnElem.disabled = false;
      btnElem.innerHTML = originalHtml;
    }
  }
}


