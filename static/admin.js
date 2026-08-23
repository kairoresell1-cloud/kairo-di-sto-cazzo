document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAdmin();
  if (!user) return;

  loadStats();
  loadKeysTable();
  
  if (user.is_owner) {
    document.getElementById('nav-tab-admins').classList.remove('hidden');
    loadUsersTable();
  }

  // Tabs setup
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.target}`).classList.add('active');
    });
  });

  // Search setup
  document.getElementById('searchKeys').addEventListener('input', (e) => {
    loadKeysTable(e.target.value);
  });

  // Drag and Drop (document level)
  const dropZone = document.getElementById('dropZone');
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  document.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleDroppedFiles(e.dataTransfer.files);
    }
  });
});

// ── Service toggle state ──────────────────────────────────────────────────────
let _genService    = 'netflix';
let _cookieService = 'netflix';

window.setGenService = function(svc, btn) {
  _genService = svc;
  btn.closest('.service-toggle').querySelectorAll('.svc-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
};
window.setCookieService = function(svc, btn) {
  _cookieService = svc;
  btn.closest('.service-toggle').querySelectorAll('.svc-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const ta = document.getElementById('cookieInput');
  if (ta) ta.placeholder = svc === 'spotify'
    ? 'Incolla qui i cookie Spotify (sp_dc=...) o JSON...'
    : 'Paste cookie content here...';
};

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const stats = await res.json();
    
    document.getElementById('stat-total-keys').textContent = stats.total_keys;
    document.getElementById('stat-available-keys').innerHTML =
      `${stats.available_keys} <span style="font-size:.8rem;color:var(--text-muted)">(<span style="color:#E50914">${stats.netflix_keys_available||0} NF</span> / <span style="color:#1DB954">${stats.spotify_keys_available||0} SP</span>)</span>`;
    document.getElementById('stat-redeemed-keys').textContent = stats.redeemed_keys;
    document.getElementById('stat-valid-cookies').innerHTML =
      `${stats.valid_cookies} <span style="font-size:.85rem;color:var(--text-muted)">` +
      `(<span style="color:#E50914">NF: ${stats.netflix_cookies_valid||0}</span> · ` +
      `<span style="color:#1DB954">SP: ${stats.spotify_cookies_valid||0}</span> · ` +
      `<span style="color:var(--success)">${stats.free_valid_cookies} liberi</span>)</span>`;
  } catch (e) {
    console.error('Failed to load stats', e);
  }
}

async function loadKeysTable(search = '') {
  try {
    const res = await fetch('/api/admin/keys');
    if (!res.ok) return;
    const data = await res.json();
    let keys = data.keys || [];
    
    if (search) {
      const s = search.toLowerCase();
      keys = keys.filter(k => k.key_code.toLowerCase().includes(s) || (k.user_email && k.user_email.toLowerCase().includes(s)));
    }
    
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = keys.map(k => {
      let statusBadge = `<span class="badge badge-success">Available</span>`;
      if (k.is_revoked) statusBadge = `<span class="badge badge-error">Revoked</span>`;
      else if (k.redeemed_at) statusBadge = `<span class="badge badge-blue">Redeemed</span>`;

      const svc = k.service || 'netflix';
      const svcBadge = svc === 'spotify'
        ? `<span class="badge badge-spotify">🎵 Spotify</span>`
        : `<span class="badge badge-netflix">🎬 Netflix</span>`;
      
      let cookieBadge = '-';
      if (k.redeemed_at) {
        cookieBadge = `<div class="badge ${k.cookie_valid ? 'badge-success' : 'badge-error'}">
          <div class="dot ${k.cookie_valid ? 'green' : 'red'}"></div>
          ${k.cookie_valid ? 'Valid' : 'Invalid'}
        </div>`;
      }

      return `
        <tr>
          <td style="font-family:monospace;">${k.key_code}</td>
          <td>${svcBadge}</td>
          <td>${statusBadge}</td>
          <td>${k.user_email || '-'}</td>
          <td>${cookieBadge}</td>
          <td>
            ${!k.is_revoked ? `<button class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="revokeKey(${k.id})">Revoke</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('Failed to load keys', e);
  }
}

window.generateNewKeys = async function() {
  const count = document.getElementById('genCount').value;
  const res = await api('POST', '/api/admin/generate-keys', { count: parseInt(count), service: _genService });
  
  if (res.keys) {
    const svcLabel = _genService === 'spotify' ? '🎵 Spotify' : '🎬 Netflix';
    showToast(`Generated ${res.keys.length} ${svcLabel} keys`, 'success');
    const resultDiv = document.getElementById('genResult');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = res.keys.join('<br>') + `<br><br><button class="btn btn-secondary" onclick="copyToClipboard('${res.keys.join('\\n')}')">Copy All</button>`;
    loadStats();
    loadKeysTable();
  } else {
    showToast('Failed to generate keys', 'error');
  }
}

window.revokeKey = async function(id) {
  if(!confirm('Are you sure you want to delete this key?')) return;
  
  const res = await api('POST', '/api/admin/revoke-key', { key_id: id });
  if (res.success) {
    showToast('Key deleted', 'success');
    loadStats();
    loadKeysTable();
  } else {
    showToast('Failed to delete key', 'error');
  }
}

async function handleDroppedFiles(files) {
  const fileArray = Array.from(files).filter(f => f.name.endsWith('.txt') || f.type.includes('text') || !f.type);
  if (fileArray.length === 0) {
    showToast('No text files found', 'error');
    return;
  }
  
  showToast(`Reading ${fileArray.length} files...`, 'success');
  
  let combinedContent = document.getElementById('cookieInput').value || '';
  if (combinedContent) combinedContent += '\n\n';
  
  const promises = fileArray.map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => resolve('');
      reader.readAsText(file);
    });
  });
  
  const contents = await Promise.all(promises);
  combinedContent += contents.filter(c => c.trim()).join('\n\n');
  
  document.getElementById('cookieInput').value = combinedContent;
  showToast(`Loaded ${fileArray.length} files, ready to upload`, 'success');
}

window.uploadCookies = async function() {
  const content = document.getElementById('cookieInput').value.trim();
  if (!content) {
    showToast('Please provide cookie data', 'error');
    return;
  }
  
  const resultDiv = document.getElementById('cookieResult');
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = '<span style="color:var(--text-dim)">Parsing cookies...</span>';
  
  // 1. Estrae i cookie dal testo raw (servizio selezionato)
  const parseRes = await api('POST', '/api/admin/parse-cookies', { cookie: content, service: _cookieService });
  if (parseRes.error) {
    showToast(parseRes.error, 'error');
    resultDiv.innerHTML = `<span style="color:var(--error)">${parseRes.error}</span>`;
    return;
  }
  
  const sets = parseRes.cookie_sets || [];
  if (sets.length === 0) {
    resultDiv.innerHTML = '<span style="color:var(--error)">Nessun cookie valido trovato nel testo.</span>';
    return;
  }
  
  // 2. Valida i cookie uno alla volta per mostrare il progresso live
  let added = 0, skipped = 0, invalid = 0;
  const svcLabel = _cookieService === 'spotify' ? '🎵 Spotify' : '🎬 Netflix';
  
  for (let i = 0; i < sets.length; i++) {
    resultDiv.innerHTML = `
      <div style="margin-bottom: 15px; font-size: 1.1rem; color: var(--gold);">
        ⏳ Scansione ${svcLabel}: <b>${i + 1} / ${sets.length}</b>
      </div>
      <div style="display:flex; gap:20px; font-weight:600; font-size: 1.1rem; background: rgba(0,0,0,0.4); padding: 10px; border-radius: 8px;">
        <span style="color:var(--success)">✅ ${added} Aggiunti</span>
        <span style="color:var(--blue)">⏭️ ${skipped} Duplicati</span>
        <span style="color:var(--error)">❌ ${invalid} Morti</span>
      </div>
    `;
    
    // Pass service along with each cookie set
    const payload = { ...sets[i], service: _cookieService };
    const valRes = await api('POST', '/api/admin/validate-cookie', payload);
    if (valRes.status === 'added') added++;
    else if (valRes.status === 'skipped') skipped++;
    else invalid++;
  }
  
  // 3. Finito
  resultDiv.innerHTML = `
    <div style="margin-bottom: 15px; font-size: 1.2rem; color: var(--success); font-weight: bold;">
      ✨ Scansione ${svcLabel} Completata
    </div>
    <div style="display:flex; gap:20px; font-weight:600; font-size: 1.1rem; background: rgba(0,0,0,0.4); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
      <span style="color:var(--success)">✅ ${added} Aggiunti</span>
      <span style="color:var(--blue)">⏭️ ${skipped} Duplicati</span>
      <span style="color:var(--error)">❌ ${invalid} Morti</span>
    </div>
  `;
  document.getElementById('cookieInput').value = '';
  loadStats();
}


async function loadUsersTable() {
  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) return;
    const data = await res.json();
    
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = data.users.map(u => {
      let roleBadge = u.is_owner 
        ? `<span class="badge" style="background:var(--accent-gold); color:black;">Owner</span>`
        : u.is_admin 
          ? `<span class="badge badge-success">Admin</span>`
          : `<span class="badge" style="background:rgba(255,255,255,0.1);">User</span>`;
          
      let actions = '';
      if (!u.is_owner) {
        if (u.is_admin) {
          actions = `<button class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="toggleAdmin(${u.id}, false)">Revoke Admin</button>`;
        } else {
          actions = `<button class="btn btn-primary" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="toggleAdmin(${u.id}, true)">Make Admin</button>`;
        }
      }
      
      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="${u.avatar_url || 'https://ui-avatars.com/api/?name=' + u.name + '&background=191919&color=fff'}" style="width:30px; height:30px; border-radius:50%;">
              <span>${u.name}</span>
            </div>
          </td>
          <td>${u.email}</td>
          <td>${roleBadge}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('Failed to load users', e);
  }
}

window.toggleAdmin = async function(userId, makeAdmin) {
  const action = makeAdmin ? 'grant admin rights to' : 'revoke admin rights from';
  if(!confirm(`Are you sure you want to ${action} this user?`)) return;
  
  const res = await api('POST', '/api/admin/set-admin', { user_id: userId, is_admin: makeAdmin });
  if (res.success) {
    showToast('Admin permissions updated', 'success');
    loadUsersTable();
  } else {
    showToast(res.error || 'Failed to update permissions', 'error');
  }
}

window.cleanCookies = async function() {
  const btn = document.getElementById('btnCleanCookies');
  if(btn) {
    btn.textContent = "Verifica in background avviata...";
    btn.disabled = true;
  }
  
  const res = await api('POST', '/api/admin/clean-cookies', {});
  if(res.success) {
    showToast(res.message, 'success');
  } else {
    showToast(res.error || 'Errore', 'error');
  }
  
  setTimeout(() => {
    if(btn) {
      btn.textContent = "Pulisci Cookie Scaduti";
      btn.disabled = false;
    }
  }, 3000);
}
