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
  if (!response.ok) return;
  const keys = await response.json();
  
  if (keys.length === 0) {
    emptyState.classList.remove('hidden');
    keysGrid.classList.add('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  keysGrid.classList.remove('hidden');
  
  keysGrid.innerHTML = keys.map(k => `
    <div class="ticket-card" id="key-card-${k.id}">
      <div class="ticket-header">
        <div style="display:flex; justify-content:space-between; align-items:center; transform: translateZ(40px);">
          <h3 style="letter-spacing:1.5px; font-weight:700; color:var(--text-color); cursor:pointer;" onclick="toggleKey(${k.id}, '${k.key_code}')" id="key-display-${k.id}">
            ${maskKey(k.key_code)}
          </h3>
          <div class="badge ${k.cookie_valid ? 'badge-success' : 'badge-error'}">
            <div class="dot ${k.cookie_valid ? 'green' : 'red'}"></div>
            ${k.cookie_valid ? 'Live' : 'Checking'}
          </div>
        </div>
      </div>
      
      <div class="ticket-body">
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:1.5rem; text-transform:uppercase; letter-spacing:1px; transform: translateZ(30px);">
          Redeemed: <span style="color:white; font-weight:600;">${new Date(k.redeemed_at).toLocaleDateString()}</span>
        </p>
        
        <div style="margin-bottom:1rem; transform: translateZ(50px);">
          <button class="btn btn-primary" style="width:100%; padding:0.75rem; font-size:0.9rem; font-weight:700; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow: 0 4px 15px rgba(229,9,20,0.4);" onclick="generateLink(${k.id}, this)">
            ⚡ GENERA LINK NETFLIX
          </button>
        </div>
        
        <div id="link-container-${k.id}" class="hidden" style="background:rgba(0,0,0,0.6); padding:1rem; border-radius:8px; border:1px solid rgba(229,9,20,0.3); font-size:0.85rem; position:relative; transform: translateZ(40px);">
        </div>
      </div>
    </div>
  `).join('');
  
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

function maskKey(key) {
  if(!key || key.length < 15) return 'KAIRO-****-****-****';
  const parts = key.split('-');
  return `${parts[0]}-****-****-${parts[3]}`;
}

window.toggleKey = function(id, fullKey) {
  const display = document.getElementById(`key-display-${id}`);
  if (display.innerText.includes('****')) {
    display.innerText = fullKey;
  } else {
    display.innerText = maskKey(fullKey);
  }
}

window.generateLink = async function(id, btnElem) {
  const originalHtml = btnElem ? btnElem.innerHTML : '';
  if (btnElem) {
    btnElem.disabled = true;
    btnElem.innerHTML = '⏳ Generando Link...';
  }
  
  const linkContainer = document.getElementById(`link-container-${id}`);
  linkContainer.classList.add('hidden');
  
  try {
    const res = await api('POST', '/api/generate-link', { key_id: id });
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    
    const url = res.url;
    if (!url) {
      showToast('Errore generazione link', 'error');
      return;
    }
    
    linkContainer.innerHTML = `
      <div style="font-size:0.75rem; color:var(--accent-gold); margin-bottom:6px; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
        <span>✨ LINK NETFLIX (UNIVERSALE)</span>
        <span style="color:var(--text-muted); font-size:0.7rem;">Live Token</span>
      </div>
      <div style="background:rgba(0,0,0,0.5); padding:8px; border-radius:6px; font-family:monospace; font-size:0.8rem; word-break:break-all; margin-bottom:10px; border:1px solid rgba(255,255,255,0.05); color:#fff;">
        ${url}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary" style="flex:1; padding:0.5rem; font-size:0.85rem;" onclick="copyToClipboard('${url}')">
          📋 Copia Link
        </button>
        <button class="btn btn-secondary" style="flex:1; padding:0.5rem; font-size:0.85rem;" onclick="openNetflixLink('${url}')">
          🚀 Apri Subito
        </button>
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

window.openNetflixLink = function(url) {
  // Triggers native iOS/Android App Universal Link without opening blank web tab
  window.location.href = url;
};


