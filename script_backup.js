// script.js вЂ“ Essay Generator with Gemini API
// IndexedDB for profiles, mammoth.js for DOCX reading, Gemini API for text generation.

const DB_NAME = 'essayGenDB';
const DB_VERSION = 2;
const PROFILE_STORE = 'profiles';
const API_KEY_STORAGE = 'gemini_api_key';
const VOL_KEY_STORAGE = 'notification_volume';

let db;
let currentProfile = null;
let currentLang = localStorage.getItem('lang') || 'uk';
let notificationVolume = parseFloat(localStorage.getItem(VOL_KEY_STORAGE) || '0.5');

// в”Ђв”Ђв”Ђ IndexedDB в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(PROFILE_STORE)) {
        database.createObjectStore(PROFILE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(); };
    request.onerror = (e) => reject(e);
  });
}

function getAllProfiles() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readonly');
    const req = tx.objectStore(PROFILE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function addProfileToDB(name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    const req = tx.objectStore(PROFILE_STORE).add({ name, requirements: [] });
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function deleteProfileFromDB(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    const req = tx.objectStore(PROFILE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e);
  });
}

function updateProfileInDB(profile) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    const req = tx.objectStore(PROFILE_STORE).put(profile);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e);
  });
}

// в”Ђв”Ђв”Ђ Init в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

document.addEventListener('DOMContentLoaded', async () => {

  await openDB();

  // Profile controls
  document.getElementById('add-profile').addEventListener('click', onAddProfile);
  document.getElementById('rename-profile').addEventListener('click', onRenameProfile);
  document.getElementById('delete-profile').addEventListener('click', onDeleteProfile);
  document.getElementById('profile-select').addEventListener('change', onProfileChange);

  // File upload
  document.getElementById('file-input').addEventListener('change', onFilesSelected);
  document.getElementById('example-input').addEventListener('change', onExampleSelected);
  document.getElementById('file-upload-box').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('example-upload-box').addEventListener('click', () => document.getElementById('example-input').click());

  // Language
  document.getElementById('lang-toggle').addEventListener('click', toggleLanguage);

  // Load and save toggle states (settings)
  const toggles = ['chernetsky-toggle', 'lite-model-toggle', 'hyphenation-toggle', 'protection-toggle'];
  toggles.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const saved = localStorage.getItem(id);
      if (saved !== null) {
        el.checked = saved === 'true';
      }
      el.addEventListener('change', () => {
        localStorage.setItem(id, el.checked);
      });
    }
  });

  // Generation & export
  document.getElementById('generate-btn').addEventListener('click', generateEssay);
  document.getElementById('export-docx').addEventListener('click', exportDocx);
  document.getElementById('print-pdf').addEventListener('click', () => window.print());

  // Settings modal
  document.getElementById('settings-toggle').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
    const savedKey = localStorage.getItem(API_KEY_STORAGE) || '';
    document.getElementById('api-key-input').value = savedKey;
    document.getElementById('volume-slider').value = notificationVolume;
    updateApiStatus();
  });
  document.getElementById('close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('modal-backdrop')?.addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('save-api-key').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      localStorage.setItem(API_KEY_STORAGE, key);
      document.getElementById('api-status').textContent = i18n.apiKeySaved[currentLang];
      document.getElementById('api-status').className = 'status-badge mt-2 status-ok';
    }
  });

  // Volume slider
  document.getElementById('volume-slider').addEventListener('input', (e) => {
    notificationVolume = parseFloat(e.target.value);
    localStorage.setItem(VOL_KEY_STORAGE, notificationVolume);
  });
  
  // Test sound button
  document.getElementById('test-sound-btn').addEventListener('click', () => {
    playNotificationSound(notificationVolume);
  });

  // Backdrop click to close modal
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      el.parentElement.classList.add('hidden');
    });
  });

  applyI18n();
  updateApiStatus();

  // Restore topic
  const savedTopic = localStorage.getItem('essay_topic') || '';
  document.getElementById('topic-input').value = savedTopic;

  // Save topic on input
  document.getElementById('topic-input').addEventListener('input', (e) => {
    localStorage.setItem('essay_topic', e.target.value);
  });

  await refreshProfileList();
});

// в”Ђв”Ђв”Ђ Profile Management в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function refreshProfileList() {
  const select = document.getElementById('profile-select');
  const profiles = await getAllProfiles();
  select.innerHTML = '';

  if (profiles.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = currentLang === 'uk' ? 'вЂ” РќРµРјР°С” РїСЂРѕС„С–Р»С–РІ вЂ”' : 'вЂ” РќРµС‚ РїСЂРѕС„РёР»РµР№ вЂ”';
    select.appendChild(opt);
    currentProfile = null;
    renderFileList();
    return;
  }

  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  // If we had a profile selected, try to keep it
  if (currentProfile) {
    const exists = profiles.find(p => p.id === currentProfile.id);
    if (exists) {
      select.value = exists.id;
      currentProfile = exists;
    } else {
      select.value = profiles[0].id;
      currentProfile = profiles[0];
    }
  } else {
    select.value = profiles[0].id;
    currentProfile = profiles[0];
  }

  renderFileList();
}

async function onAddProfile() {
  const profiles = await getAllProfiles();
  if (profiles.length >= 20) {
    alert(currentLang === 'uk' ? 'РњР°РєСЃРёРјСѓРј 20 РїСЂРѕС„С–Р»С–РІ' : 'РњР°РєСЃРёРјСѓРј 20 РїСЂРѕС„РёР»РµР№');
    return;
  }
  const name = prompt(i18n.addProfilePrompt[currentLang]);
  if (!name || !name.trim()) return;
  await addProfileToDB(name.trim());
  await refreshProfileList();
}

async function onRenameProfile() {
  if (!currentProfile) return;
  const newName = prompt(i18n.renamePrompt[currentLang], currentProfile.name);
  if (!newName || !newName.trim()) return;
  currentProfile.name = newName.trim();
  await updateProfileInDB(currentProfile);
  await refreshProfileList();
}

async function onDeleteProfile() {
  if (!currentProfile) return;
  if (!confirm(i18n.deleteConfirm[currentLang])) return;
  await deleteProfileFromDB(currentProfile.id);
  currentProfile = null;
  await refreshProfileList();
}

async function onProfileChange(e) {
  const id = Number(e.target.value);
  if (!id) { currentProfile = null; renderFileList(); return; }
  const profiles = await getAllProfiles();
  currentProfile = profiles.find(p => p.id === id) || null;
  renderFileList();
  renderExampleFile();
}

// в”Ђв”Ђв”Ђ File Upload & Display в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function renderFileList() {
  const container = document.getElementById('file-list');
  container.innerHTML = '';

  if (!currentProfile || !currentProfile.requirements || currentProfile.requirements.length === 0) {
    container.innerHTML = `<p class="no-files">${i18n.noFiles[currentLang]}</p>`;
    return;
  }

  currentProfile.requirements.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const icon = file.name.endsWith('.docx') ? 'рџ“„' : file.name.endsWith('.pdf') ? 'рџ“•' : 'рџ“ќ';
    const sizeBytes = file.content ? file.content.length : 0;
    const sizeKB = sizeBytes >= 1024 ? Math.round(sizeBytes / 1024) + ' РљР‘' : (sizeBytes > 0 ? '< 1 РљР‘' : '0 РљР‘');

    item.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-size">${sizeKB} С‚РµРєСЃС‚Сѓ</span>
      <button class="btn-remove" data-idx="${idx}" title="${i18n.removeFile[currentLang]}">вњ•</button>
    `;
    container.appendChild(item);
  });

  // Attach remove handlers
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = Number(e.target.dataset.idx);
      currentProfile.requirements.splice(idx, 1);
      await updateProfileInDB(currentProfile);
      renderFileList();
    });
  });
}

// в”Ђв”Ђв”Ђ Example Referat в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function renderExampleFile() {
  const container = document.getElementById('example-file-display');
  if (!container) return;
  container.innerHTML = '';

  if (!currentProfile || !currentProfile.examples || currentProfile.examples.length === 0) {
    return;
  }

  currentProfile.examples.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const sizeBytes = file.content ? file.content.length : 0;
    const sizeKB = sizeBytes >= 1024 ? Math.round(sizeBytes / 1024) + ' РљР‘' : (sizeBytes > 0 ? '< 1 РљР‘' : '0 РљР‘');
    item.innerHTML = `
      <span class="file-icon">рџ“‹</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-size">${sizeKB} С‚РµРєСЃС‚Сѓ</span>
      <button class="btn-remove" data-ex-idx="${idx}" title="${i18n.removeFile[currentLang]}">вњ•</button>
    `;
    container.appendChild(item);
  });

  // Attach remove handlers
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = Number(e.target.dataset.exIdx);
      currentProfile.examples.splice(idx, 1);
      await updateProfileInDB(currentProfile);
      renderExampleFile();
    });
  });
}

async function onExampleSelected(e) {
  try {
    const files = Array.from(e.target.files);
    if (!currentProfile) return alert(i18n.selectProfileFirst[currentLang]);
    if (files.length === 0) return;

    if (!currentProfile.examples) currentProfile.examples = [];

    for (const f of files) {
      if (currentProfile.examples.length >= 3) {
        alert(i18n.maxExamplesAlert[currentLang] || 'Maximum 3 examples allowed');
        break;
      }
      const result = await readSingleFile(f);
      if (result && result.buffer) {
        currentProfile.examples.push(result);
      }
    }

    await updateProfileInDB(currentProfile);
    renderExampleFile();
    document.getElementById('example-input').value = '';
  } catch (err) {
    alert("РџРѕРјРёР»РєР° РїС–Рґ С‡Р°СЃ Р·Р°РІР°РЅС‚Р°Р¶РµРЅРЅСЏ Р·СЂР°Р·РєС–РІ: " + (err.message || err));
    console.error(err);
  }
}
function readSingleFile(f) {
  return new Promise((resolve) => {
    const ext = f.name.split('.').pop().toLowerCase();

    if (ext === 'doc') {
      const reader = new FileReader();
      reader.onload = function (event) {
        try {
          const buffer = event.target.result;
          const bytes = new Uint8Array(buffer);
          let unicodeText = '';
          let asciiText = '';
          let currentRun = '';
          for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if ((b >= 0x20 && b <= 0x7E) || b === 0x0A || b === 0x0D || b === 0x09 || (b >= 0xC0 && b <= 0xFF) || b === 0xA8 || b === 0xB8) {
              currentRun += String.fromCharCode(b);
            } else {
              if (currentRun.length >= 4) { asciiText += currentRun + '\n'; }
              currentRun = '';
            }
          }
          if (currentRun.length >= 4) asciiText += currentRun;
          let utf16Text = '';
          let utf16Run = '';
          for (let i = 0; i < bytes.length - 1; i += 2) {
            const code = bytes[i] | (bytes[i + 1] << 8);
            if ((code >= 0x20 && code <= 0x7E) || (code >= 0x0400 && code <= 0x04FF) ||
              code === 0x0A || code === 0x0D || code === 0x09 ||
              (code >= 0xAB && code <= 0xBB) || code === 0x2014 || code === 0x2013 ||
              code === 0x2018 || code === 0x2019 || code === 0x201C || code === 0x201D) {
              utf16Run += String.fromCharCode(code);
            } else {
              if (utf16Run.length >= 4) { utf16Text += utf16Run + '\n'; }
              utf16Run = '';
            }
          }
          if (utf16Run.length >= 4) utf16Text += utf16Run;

          const cyrillicCountAscii = (asciiText.match(/[\u0400-\u04FF]/g) || []).length;
          const cyrillicCountUtf16 = (utf16Text.match(/[\u0400-\u04FF]/g) || []).length;
          let text = cyrillicCountUtf16 > cyrillicCountAscii ? utf16Text : asciiText;

          if ((text.match(/[\u0400-\u04FF]/g) || []).length < 10) {
            const win1251 = new TextDecoder('windows-1251');
            const decoded = win1251.decode(buffer);
            let decodedRuns = '';
            let dRun = '';
            for (const ch of decoded) {
              const code = ch.charCodeAt(0);
              if ((code >= 0x20 && code <= 0x7E) || (code >= 0x0400 && code <= 0x04FF) ||
                code === 0x0A || code === 0x0D || code === 0x09 ||
                ch === 'В«' || ch === 'В»' || ch === 'вЂ”' || ch === 'вЂ“' || ch === '\u0456' || ch === '\u0457' || ch === '\u0454' || ch === '\u0491') {
                dRun += ch;
              } else {
                if (dRun.length >= 4) decodedRuns += dRun + '\n';
                dRun = '';
              }
            }
            if (dRun.length >= 4) decodedRuns += dRun;
            if ((decodedRuns.match(/[\u0400-\u04FF]/g) || []).length > (text.match(/[\u0400-\u04FF]/g) || []).length) {
              text = decodedRuns;
            }
          }
          text = text.replace(/\n{3,}/g, '\n\n').trim();
          resolve({ name: f.name, content: text, buffer: buffer });
        } catch (err) {
          console.error('DOC read error:', err);
          resolve({ name: f.name, content: '', buffer: null });
        }
      };
      reader.readAsArrayBuffer(f);
    } else if (ext === 'docx') {
      const reader = new FileReader();
      reader.onload = async function (event) {
        try {
          const arrayBuffer = event.target.result;
          let text = '';
          try {
            const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer.slice(0) });
            text = result.value || '';
            // Strip out excessively heavy HTML tags to save tokens, but keep structure (h1, h2, p, li)
            text = text.replace(/<(?!h[1-6]|p|ul|ol|li|strong|b|i|em|\/)[^>]+>/gi, '');
          } catch (e) {
            console.error('Mammoth error:', e);
          }
          if (!text || text.trim().length < 30) {
            try {
              const zip = await JSZip.loadAsync(arrayBuffer.slice(0));
              let fullText = '';
              const docFile = zip.file("word/document.xml");
              if (docFile) {
                const xml = await docFile.async("string");
                const parser = new DOMParser();
                const doc = parser.parseFromString(xml, 'text/xml');
                const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
                const paragraphs = doc.getElementsByTagNameNS(ns, 'p');
                const lines = [];
                for (const para of paragraphs) {
                  const runs = para.getElementsByTagNameNS(ns, 't');
                  const lineText = Array.from(runs).map(r => r.textContent).join('');
                  if (lineText.trim()) lines.push(lineText.trim());
                }
                fullText = lines.join('\n');
              }
              text = fullText || text;
            } catch (zipErr) {
              console.error('JSZip fallback error:', zipErr);
            }
          }
          resolve({ name: f.name, content: text, buffer: arrayBuffer });
        } catch (err) {
          console.error('DOCX read error:', err);
          resolve({ name: f.name, content: '', buffer: null });
        }
      };
      reader.readAsArrayBuffer(f);
    } else if (ext === 'pdf') {
      const reader = new FileReader();
      reader.onload = async function (event) {
        try {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          const pdf = await pdfjsLib.getDocument({ data: event.target.result.slice(0) }).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n';
          }
          resolve({ name: f.name, content: text, buffer: event.target.result });
        } catch (err) {
          console.error('PDF read error:', err);
          resolve({ name: f.name, content: '', buffer: null });
        }
      };
      reader.readAsArrayBuffer(f);
    } else {
      f.text().then(content => {
        f.arrayBuffer().then(buffer => {
          resolve({ name: f.name, content, buffer });
        });
      });
    }
  });
}

async function onFilesSelected(e) {
  try {
    const files = Array.from(e.target.files);
    if (!currentProfile) return alert(i18n.selectProfileFirst[currentLang]);

    const currentCount = currentProfile.requirements ? currentProfile.requirements.length : 0;
    if (currentCount + files.length > 5) {
      alert(i18n.maxFilesAlert[currentLang]);
      return;
    }

    const readPromises = files.map(f => readSingleFile(f));

    const results = await Promise.all(readPromises);
    const validResults = results.filter(r => r.buffer);

    if (!currentProfile.requirements) currentProfile.requirements = [];

    for (const r of validResults) {
      currentProfile.requirements.push(r);
    }

    await updateProfileInDB(currentProfile);

    // Reset file input
    document.getElementById('file-input').value = '';
    renderFileList();
  } catch (err) {
    alert("РџРѕРјРёР»РєР° РїС–Рґ С‡Р°СЃ Р·Р°РІР°РЅС‚Р°Р¶РµРЅРЅСЏ РІРёРјРѕРі: " + (err.message || err));
    console.error(err);
  }
}

// в”Ђв”Ђв”Ђ Language в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function toggleLanguage() {
  currentLang = currentLang === 'uk' ? 'ru' : 'uk';
  localStorage.setItem('lang', currentLang);
  applyI18n();
  renderFileList();
  updateApiStatus();
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[key] && i18n[key][currentLang]) {
      el.textContent = i18n[key][currentLang];
    }
  });
  document.getElementById('lang-toggle').textContent = i18n.langLabel[currentLang];
}

function updateApiStatus() {
  const status = document.getElementById('api-status');
  if (!status) return;
  const key = localStorage.getItem(API_KEY_STORAGE);
  if (key) {
    status.textContent = i18n.apiKeySet[currentLang];
    status.className = 'status-badge mt-2 status-ok';
  } else {
    status.textContent = i18n.apiKeyMissing[currentLang];
    status.className = 'status-badge mt-2 status-err';
  }
}

// в”Ђв”Ђв”Ђ Helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// в”Ђв”Ђв”Ђ Notifications в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function playNotificationSound(volumeLevel) {
  if (volumeLevel <= 0) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volumeLevel, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch(e) {
    console.error("Audio error:", e);
  }
}

function sendNotification(title, body, isError = false) {
  playNotificationSound(notificationVolume);

  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-body">${escapeHtml(body)}</div>
  `;
  
  container.appendChild(toast);
  
  // Remove after 5 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 5000);
}

// в”Ђв”Ђв”Ђ Gemini API вЂ“ Essay Generation в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function generateEssay() {
  if (!currentProfile) return alert(i18n.selectProfileFirst[currentLang]);

  const topic = document.getElementById('topic-input').value.trim();
  if (!topic) return alert(i18n.enterTopic[currentLang]);

  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) return alert(i18n.noApiKey[currentLang]);

  // Build the requirements context from uploaded files
  let requirementsText = '';
  if (currentProfile.requirements && currentProfile.requirements.length > 0) {
    requirementsText = currentProfile.requirements.map(f => {
      return `--- Р¤РђР™Р› Р’РРњРћР“: ${f.name} ---\n${f.content}\n--- РљР†РќР•Р¦Р¬ Р¤РђР™Р›РЈ Р’РРњРћР“ ---`;
    }).join('\n\n');
  } else {
    if (!confirm(i18n.noRequirements[currentLang] + '\n\nРџСЂРѕРґРѕРІР¶РёС‚Рё?')) return;
  }

  // Build the examples context
  let exampleText = '';
  if (currentProfile.examples && currentProfile.examples.length > 0) {
    exampleText = currentProfile.examples.map(f => {
      return `--- Р—Р РђР—РћРљ Р Р•Р¤Р•Р РђРўРЈ: ${f.name} ---\n${f.content}\n--- РљР†РќР•Р¦Р¬ Р—Р РђР—РљРђ ---`;
    }).join('\n\n');
  }

  // Determine essay language
  const essayLang = currentLang === 'uk' ? 'СѓРєСЂР°С—РЅСЃСЊРєРѕСЋ РјРѕРІРѕСЋ' : 'СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ';

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // NEW APPROACH: Ask AI for PLAIN TEXT only in JSON format.
  // All HTML structure is built programmatically below.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  const prompt = `РўРё вЂ” РїСЂРѕС„РµСЃС–Р№РЅРёР№ Р°РєР°РґРµРјС–С‡РЅРёР№ РїРѕРјС–С‡РЅРёРє. РќР°РїРёС€Рё РїРѕРІРЅРёР№ СЂРµС„РµСЂР°С‚ ${essayLang} РЅР° С‚РµРјСѓ: "${topic}".

${requirementsText ? `
Р’РРњРћР“Р Р’РРљР›РђР”РђР§Рђ (РґРѕС‚СЂРёРјСѓР№СЃСЏ С—С… С‰РѕРґРѕ СЃС‚СЂСѓРєС‚СѓСЂРё, РѕР±СЃСЏРіСѓ, СЃС‚РёР»СЋ):
${requirementsText}
` : ''}

${exampleText ? `
Р—Р РђР—РљР Р Р•Р¤Р•Р РђРўР†Р’ (РћР Р†Р„РќРўРЈР™РЎРЇ РќРђ Р‡РҐ РЎРўРР›Р¬, РЎРўР РЈРљРўРЈР РЈ РўРђ РЎРџРћРЎР†Р‘ РџРћР”РђРќРќРЇ Р†РќР¤РћР РњРђР¦Р†Р‡):
${exampleText}
` : ''}

- РќР• РїРёС€Рё РЅР°Р·РІСѓ РїС–РґСЂРѕР·РґС–Р»Сѓ РІСЃРµСЂРµРґРёРЅС– РїРѕР»СЏ "text". РџРѕР»Рµ "title" Р’Р–Р• РјС–СЃС‚РёС‚СЊ РЅР°Р·РІСѓ, С‚РѕРјСѓ "text" РјР°С” РїРѕС‡РёРЅР°С‚РёСЃСЏ РћР”Р РђР—РЈ Р· РїРµСЂС€РѕРіРѕ Р°Р±Р·Р°С†Сѓ С‚РµРєСЃС‚Сѓ.
Р’РђР–Р›РР’Рћ: Р’С–РґРїРѕРІС–РґР°Р№ РЎРўР РћР“Рћ Сѓ С„РѕСЂРјР°С‚С– JSON (Р±РµР· markdown, Р±РµР· \`\`\`json, Р±РµР· РЅС–С‡РѕРіРѕ Р·Р°Р№РІРѕРіРѕ).
Р¤РѕСЂРјР°С‚ РІС–РґРїРѕРІС–РґС– вЂ” JSON-РѕР±'С”РєС‚:
{
  "discipline": "РЅР°Р·РІР° РґРёСЃС†РёРїР»С–РЅРё (СЏРєС‰Рѕ С” Сѓ РІРёРјРѕРіР°С…, С–РЅР°РєС€Рµ 'РџСЃРёС…РѕР»РѕРіС–СЏ РѕСЃРѕР±РёСЃС‚РѕСЃС‚С–')",
  "intro": "РџРѕРІРЅРёР№ С‚РµРєСЃС‚ РІСЃС‚СѓРїСѓ (3-5 Р°Р±Р·Р°С†С–РІ, СЂРѕР·РґС–Р»СЏР№ Р°Р±Р·Р°С†Рё СЃРёРјРІРѕР»РѕРј \\n\\n)",
  "sections": [
    {
      "title": "РќРђР—Р’Рђ Р РћР—Р”Р†Р›РЈ 1 (Р’Р•Р›РРљРРњР Р›Р†РўР•Р РђРњР)",
      "subsections": [
        {
          "title": "1.1 РќР°Р·РІР° РїС–РґСЂРѕР·РґС–Р»Сѓ.",
          "text": "РџРѕРІРЅРёР№ С‚РµРєСЃС‚ РїС–РґСЂРѕР·РґС–Р»Сѓ (Р°Р±Р·Р°С†Рё СЂРѕР·РґС–Р»СЏР№ \\n\\n)"
        },
        {
          "title": "1.2 РќР°Р·РІР° РїС–РґСЂРѕР·РґС–Р»Сѓ.",
          "text": "РџРѕРІРЅРёР№ С‚РµРєСЃС‚..."
        }
      ]
    },
    {
      "title": "РќРђР—Р’Рђ Р РћР—Р”Р†Р›РЈ 2",
      "subsections": [
        {
          "title": "2.1 РќР°Р·РІР° РїС–РґСЂРѕР·РґС–Р»Сѓ.",
          "text": "..."
        }
      ]
    }
  ],
  "conclusion": "РџРѕРІРЅРёР№ С‚РµРєСЃС‚ РІРёСЃРЅРѕРІРєС–РІ (3-5 Р°Р±Р·Р°С†С–РІ, \\n\\n РјС–Р¶ РЅРёРјРё)",
  "sources": [
    "РђРІС‚РѕСЂ. РќР°Р·РІР°. Р’РёРґР°РІРЅРёС†С‚РІРѕ, СЂС–Рє. РЎ. РҐРҐ.",
    "РђРІС‚РѕСЂ. РќР°Р·РІР°. Р’РёРґР°РІРЅРёС†С‚РІРѕ, СЂС–Рє. РЎ. РҐРҐ."
  ]
}

РџР РђР’РР›Рђ РўРђ РћР‘РЎРЇР“:
- Р—Р°РіР°Р»СЊРЅРёР№ РѕР±СЃСЏРі СЂРµС„РµСЂР°С‚Сѓ вЂ“ 17-25 СЃС‚РѕСЂС–РЅРѕРє. Р¦Рµ РїСЂРёР±Р»РёР·РЅРѕ 7000 СЃР»С–РІ. РўРё Р·РѕР±РѕРІ'СЏР·Р°РЅРёР№ Р·РіРµРЅРµСЂСѓРІР°С‚Рё РґСѓР¶Рµ Р±Р°РіР°С‚Рѕ С‚РµРєСЃС‚Сѓ!
- Р’РЎРўРЈРџ вЂ“ 8 РІРµР»РёРєРёС… Р°Р±Р·Р°С†С–РІ.
- Р РћР—Р”Р†Р› 1 вЂ“ 3 РїС–РґСЂРѕР·РґС–Р»Рё. РљРћР–Р•Рќ РїС–РґСЂРѕР·РґС–Р» РјР°С” РјС–СЃС‚РёС‚Рё СЂС–РІРЅРѕ 5-6 РІРµР»РёРєРёС… Р°Р±Р·Р°С†С–РІ.
- Р РћР—Р”Р†Р› 2 вЂ“ 4 РїС–РґСЂРѕР·РґС–Р»Рё. РљРћР–Р•Рќ РїС–РґСЂРѕР·РґС–Р» РјР°С” РјС–СЃС‚РёС‚Рё СЂС–РІРЅРѕ 7-8 РІРµР»РёРєРёС… Р°Р±Р·Р°С†С–РІ.
- Р РћР—Р”Р†Р› 3 вЂ“ 4 РїС–РґСЂРѕР·РґС–Р»Рё. РљРћР–Р•Рќ РїС–РґСЂРѕР·РґС–Р» РјР°С” РјС–СЃС‚РёС‚Рё СЂС–РІРЅРѕ 6-7 РІРµР»РёРєРёС… Р°Р±Р·Р°С†С–РІ.
- Р’РРЎРќРћР’РљР вЂ“ 8 РІРµР»РёРєРёС… Р°Р±Р·Р°С†С–РІ.
- РЎРџРРЎРћРљ Р”Р–Р•Р Р•Р› вЂ“ РІРёРєРѕСЂРёСЃС‚РѕРІСѓР№ СЃС‚С–Р»СЊРєРё РґР¶РµСЂРµР», СЃРєС–Р»СЊРєРё РґС–Р№СЃРЅРѕ РїРѕС‚СЂС–Р±РЅРѕ РґР»СЏ СЏРєС–СЃРЅРѕРіРѕ СЂРѕР·РєСЂРёС‚С‚СЏ С‚РµРјРё. Р“РѕР»РѕРІРЅРµ вЂ” С†Рµ РЇРљР†РЎРўР¬ РўРђ Р”РћРЎРўРћР’Р†Р РќР†РЎРўР¬, Р° РЅРµ РєС–Р»СЊРєС–СЃС‚СЊ! РќРµ Р¶РµРЅРёСЃСЏ Р·Р° РєС–Р»СЊРєС–СЃС‚СЋ. Р’РёРєРѕСЂРёСЃС‚РѕРІСѓР№ РўР†Р›Р¬РљР Р Р•РђР›Р¬РќР†, С–СЃРЅСѓСЋС‡С– РЅР°СѓРєРѕРІС– РїС–РґСЂСѓС‡РЅРёРєРё, РјРѕРЅРѕРіСЂР°С„С–С—, СЃС‚Р°С‚С‚С– С‚Р° РѕС„С–С†С–Р№РЅС– РґРѕРєСѓРјРµРЅС‚Рё, С‰Рѕ РЎРЈР’РћР Рћ РІС–РґРїРѕРІС–РґР°СЋС‚СЊ С‚РµРјС– С‚Р° РґРёСЃС†РёРїР»С–РЅС– СЂРµС„РµСЂР°С‚Сѓ. РљРђРўР•Р“РћР РР§РќРћ Р—РђР‘РћР РћРќР•РќРћ РІРёРіР°РґСѓРІР°С‚Рё РЅРµС–СЃРЅСѓСЋС‡РёС… Р°РІС‚РѕСЂС–РІ Р°Р±Рѕ РґРѕРґР°РІР°С‚Рё СЂРµР°Р»СЊРЅС– РєРЅРёРіРё Р· С–РЅС€РёС… РґРёСЃС†РёРїР»С–РЅ (РЅР°РїСЂРёРєР»Р°Рґ, РЅРµ РґРѕРґР°РІР°Р№ РєРЅРёРіРё Р· РµРєРѕРЅРѕРјС–РєРё С‡Рё РїРѕР»С–С‚РёРєРё Сѓ СЂРµС„РµСЂР°С‚ Р· РїСЃРёС…РѕР»РѕРіС–С—)!
- РЈР’РђР“Рђ! РџСЂРё РЅР°РїРёСЃР°РЅРЅС– С–РЅС–С†С–Р°Р»С–РІ С‚Р° РїСЂС–Р·РІРёС‰ Р°РІС‚РѕСЂС–РІ (РѕСЃРѕР±Р»РёРІРѕ Сѓ СЃРїРёСЃРєСѓ РґР¶РµСЂРµР») РІРёРєРѕСЂРёСЃС‚РѕРІСѓР№ РўР†Р›Р¬РљР РєРёСЂРёР»РёС‡РЅС– Р»С–С‚РµСЂРё. РљРђРўР•Р“РћР РР§РќРћ Р—РђР‘РћР РћРќР•РќРћ РІРёРєРѕСЂРёСЃС‚РѕРІСѓРІР°С‚Рё Р»Р°С‚РёРЅСЃСЊРєС– Р»С–С‚РµСЂРё (S, N, V, I, A, O, C, B, H, P, M, T, X) Р·Р°РјС–СЃС‚СЊ РєРёСЂРёР»РёС‡РЅРёС… РІ С–РјРµРЅР°С… С‚Р° С–РЅС–С†С–Р°Р»Р°С…!
- РќР• РІРёРєРѕСЂРёСЃС‚РѕРІСѓР№ РјР°СЂРєС–СЂРѕРІР°РЅС– СЃРїРёСЃРєРё (РєСЂР°РїРєРё, РґРµС„С–СЃРё) Сѓ С‚РµРєСЃС‚С–. РџРёС€Рё СЃСѓС†С–Р»СЊРЅРёРјРё Р°Р±Р·Р°С†Р°РјРё.
- РЇРєС‰Рѕ РїРѕС‚СЂС–Р±РµРЅ РїРµСЂРµР»С–Рє, РѕС„РѕСЂРјР»СЋР№ Р№РѕРіРѕ РЅСѓРјРµСЂРѕРІР°РЅРёРј С‚РµРєСЃС‚РѕРј РІСЃРµСЂРµРґРёРЅС– Р°Р±Р·Р°С†Сѓ.
- РќР†РЇРљРРҐ РІРЅСѓС‚СЂС–С€РЅСЊРѕС‚РµРєСЃС‚РѕРІРёС… РїРѕСЃРёР»Р°РЅСЊ (РЅР°РїСЂРёРєР»Р°Рґ, [4, СЃ. 180] Р°Р±Рѕ [3]). Р—Р°Р±РѕСЂРѕРЅСЋСЋ РІРёРєРѕСЂРёСЃС‚РѕРІСѓРІР°С‚Рё РєРІР°РґСЂР°С‚РЅС– РґСѓР¶РєРё Р· РїРѕСЃРёР»Р°РЅРЅСЏРјРё Сѓ С‚РµРєСЃС‚С–!
- РќСѓРјРµСЂР°С†С–СЏ РїС–РґСЂРѕР·РґС–Р»С–РІ РјР°С” Р±СѓС‚Рё Сѓ С„РѕСЂРјР°С‚С– "1.1 РќР°Р·РІР° РїС–РґСЂРѕР·РґС–Р»Сѓ." Р‘Р•Р— РєСЂР°РїРєРё РїС–СЃР»СЏ РЅРѕРјРµСЂСѓ, Р°Р»Рµ Р— РљР РђРџРљРћР® Р’ РљР†РќР¦Р† РќРђР—Р’Р. РўРѕР±С‚Рѕ РќР• "1.1." Р° "1.1", Р° РІ РєС–РЅС†С– РЅР°Р·РІРё РћР‘РћР’'РЇР—РљРћР’Рћ РєСЂР°РїРєР°: "1.1 РџРѕРЅСЏС‚С‚СЏ С‚Р° СЃСѓС‚РЅС–СЃС‚СЊ."
- Р’С–РґРїРѕРІС–РґР°Р№ РўР†Р›Р¬РљР JSON. Р–РѕРґРЅРѕРіРѕ С‚РµРєСЃС‚Сѓ РїРµСЂРµРґ Р°Р±Рѕ РїС–СЃР»СЏ JSON.`;

  // Show loading
  const loading = document.getElementById('loading-indicator');
  const generateBtn = document.getElementById('generate-btn');
  loading.classList.remove('hidden');
  generateBtn.disabled = true;
  document.getElementById('output-area').innerHTML = '';

  try {
    let text = '';

    if (apiKey.startsWith('sk-')) {
      // в”Ђв”Ђв”Ђ OpenAI ChatGPT API в”Ђв”Ђв”Ђ
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'РўРё вЂ” РїСЂРѕС„РµСЃС–Р№РЅРёР№ Р°РєР°РґРµРјС–С‡РЅРёР№ РїРѕРјС–С‡РЅРёРє. Р’С–РґРїРѕРІС–РґР°Р№ РўР†Р›Р¬РљР РІР°Р»С–РґРЅРёРј JSON Р±РµР· markdown РѕР±РіРѕСЂС‚РѕРє.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 16000
        })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || response.statusText);
      }
      const data = await response.json();
      text = data?.choices?.[0]?.message?.content || '';

    } else {
      // в”Ђв”Ђв”Ђ Google Gemini API (FREE) в”Ђв”Ђв”Ђ
      const useLiteModel = document.getElementById('lite-model-toggle').checked;
      const model = useLiteModel ? 'gemini-3.5-flash-lite' : 'gemini-3.6-flash';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 65536,
              responseMimeType: 'application/json',
            }
          })
        }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || response.statusText);
      }
      const data = await response.json();
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (!text) throw new Error('Empty response from API');

    // Clean up markdown code fences if present
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Parse JSON
    let essayData;
    try {
      essayData = JSON.parse(text);
    } catch (parseErr) {
      console.error('JSON parse error, raw text:', text);
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        essayData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI РЅРµ РїРѕРІРµСЂРЅСѓРІ РІР°Р»С–РґРЅРёР№ JSON. РЎРїСЂРѕР±СѓР№С‚Рµ С‰Рµ СЂР°Р·.');
      }
    }
    
    // Sanitize sources to fix common Latin-for-Cyrillic OCR-like mistakes from LLMs
    if (essayData.sources && Array.isArray(essayData.sources)) {
      const latinToCyrillic = {
        'S': 'РЎ', 'N': 'Рќ', 'V': 'Р’', 'I': 'Р†', 'A': 'Рђ', 'O': 'Рћ', 
        'C': 'РЎ', 'B': 'Р’', 'H': 'Рќ', 'P': 'Р ', 'M': 'Рњ', 'T': 'Рў', 'X': 'РҐ'
      };
      essayData.sources = essayData.sources.map(source => {
        // Replace isolated capital Latin letters that look like/sound like Cyrillic initials
        return source.replace(/\b([SNVIAOCBHPMTX])\./g, (match, p1) => {
          return latinToCyrillic[p1] + '.';
        }).replace(/Р’Рђ N\./g, 'РІР° Рќ.'); // Specific fix for the weird casing bug "Р§РµРїС”Р»С”Р’Рђ N. Р’."
      });
    }

    // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
    // BUILD HTML PROGRAMMATICALLY вЂ” AI has zero control over formatting
    // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
    const html = buildEssayHTML(essayData, topic);
    document.getElementById('output-area').innerHTML = html;
    
    sendNotification('Р“РѕС‚РѕРІРѕ!', 'Р“РµРЅРµСЂР°С†С–СЏ СЂРµС„РµСЂР°С‚Сѓ СѓСЃРїС–С€РЅРѕ Р·Р°РІРµСЂС€РµРЅР°.');

  } catch (err) {
    console.error('Generation error:', err);
    sendNotification('РџРѕРјРёР»РєР°', 'РЎС‚Р°Р»Р°СЃСЏ РїРѕРјРёР»РєР° РїСЂРё РіРµРЅРµСЂР°С†С–С—: ' + err.message, true);
    alert(i18n.errorGenerate[currentLang] + '\n\n' + err.message);
  } finally {
    loading.classList.add('hidden');
    generateBtn.disabled = false;
  }
}

// в”Ђв”Ђв”Ђ Build Essay HTML from structured data в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function textToParas(text) {
  // Split text by double newlines into paragraphs
  if (!text) return '';
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p class="para">${escapeHtml(p)}</p>`)
    .join('\n');
}

function buildEssayHTML(data, topic) {
  const discipline = data.discipline || 'РџСЃРёС…РѕР»РѕРіС–СЏ РѕСЃРѕР±РёСЃС‚РѕСЃС‚С–';

  // в•ђв•ђв•ђ 1. TITLE PAGE (SECTION 1) в•ђв•ђв•ђ
  const titlePage = `
<div class="Section1">
  <div class="title-top">
    РќРђР¦Р†РћРќРђР›Р¬РќРР™ РЈРќР†Р’Р•Р РЎРРўР•Рў<br>
    В«РћР”Р•РЎР¬РљРђ Р®Р РР”РР§РќРђ РђРљРђР”Р•РњР†РЇВ»<br>
    РљР РР’РћР Р†Р—Р¬РљРР™ Р®Р РР”РР§РќРР™ Р¤РђРҐРћР’РР™ РљРћР›Р•Р”Р–
  </div>
  <br><br><br><br>
  <div class="title-middle">
    <div class="essay-word">Р Р•Р¤Р•Р РђРў</div>
    <div class="discipline-line">Р· РЅР°РІС‡Р°Р»СЊРЅРѕС— РґРёСЃС†РёРїР»С–РЅРё ${escapeHtml(discipline)}</div>
    <div class="topic-line">РЅР° С‚РµРјСѓ: В«${escapeHtml(topic.toUpperCase())}В»</div>
  </div>
  <br><br><br><br>
  <table width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr>
      <td width="50%"></td>
      <td width="50%" style="text-align: left; font-size: 14pt; line-height: 150%; font-family: 'Times New Roman', Times, serif;">
        Р’РёРєРѕРЅР°Р»Р° (-РІ):<br>
        РЎС‚СѓРґРµРЅС‚ (-С‚РєР°) 1 РєСѓСЂСЃСѓ РіСЂСѓРїРё 25 РљР”<br>
        РџСЂС–Р·РІРёС‰Рµ, С–РјКјСЏ, РїРѕ-Р±Р°С‚СЊРєРѕРІС–<br>
        <br>
        Р’РёРєР»Р°РґР°С‡ РЅР°РІС‡Р°Р»СЊРЅРѕС— РґРёСЃС†РёРїР»С–РЅРё:<br>
        Р§РµСЂРЅРµС†СЊРєРёР№ РђРЅРґСЂС–Р№ РћР»РµРіРѕРІРёС‡
      </td>
    </tr>
  </table>
  <br><br><br><br>
  <div class="title-bottom">
    РљСЂРёРІРёР№ Р С–Рі<br>
    2026
  </div>
</div>
<br clear="all" style="page-break-before:always; mso-break-type:section-break" />
<div class="Section2">`;

  // в•ђв•ђв•ђ 2. TABLE OF CONTENTS в•ђв•ђв•ђ
  const tocPage = `
<div class="toc-container">
  <h1 style="margin-top:0; text-align:center; font-size:14pt; font-family:'Times New Roman', Times, serif; font-weight:bold;">Р—РњР†РЎРў</h1>
  <p class="MsoNormal" style="margin:0; text-align:left; text-indent:0; font-size:14pt; font-family:'Times New Roman', Times, serif; line-height: 150%;">
    <!--[if supportFields]>
    <span style='mso-element:field-begin'></span>
    <span style='mso-spacerun:yes'> </span>TOC \\o "1-3" \\h \\z \\u 
    <span style='mso-element:field-separator'></span>
    <![endif]-->
    <span style='mso-no-proof:yes; font-family:"Times New Roman", Times, serif; font-size:14pt;'>
      <i>РўСѓС‚ Р±СѓРґРµ Р·РЅР°С…РѕРґРёС‚РёСЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РЅРёР№ Р·РјС–СЃС‚. РЈ Word РЅР°С‚РёСЃРЅС–С‚СЊ Р±СѓРґСЊ-РґРµ РЅР° С†СЊРѕРјСѓ С‚РµРєСЃС‚С– РїСЂР°РІРѕСЋ РєРЅРѕРїРєРѕСЋ РјРёС€С– С‚Р° РѕР±РµСЂС–С‚СЊ "РћРЅРѕРІРёС‚Рё РїРѕР»Рµ" (Update Field).</i>
    </span>
    <!--[if supportFields]>
    <span style='mso-element:field-end'></span>
    <![endif]-->
  </p>
</div>
<br clear="all" style="page-break-before:always; mso-break-type:page-break" />`;

  // в•ђв•ђв•ђ 3. INTRODUCTION в•ђв•ђв•ђ
  const introSection = `
<h2 style="margin-top:0;">Р’РЎРўРЈРџ</h2>
${textToParas(data.intro)}
<br clear="all" style="page-break-before:always; mso-break-type:page-break" />`;

  // в•ђв•ђв•ђ 4. MAIN SECTIONS в•ђв•ђв•ђ
  let mainSections = '';
  if (data.sections && data.sections.length > 0) {
    data.sections.forEach((section, i) => {
      const sectionNum = i + 1;
      let cleanTitle = section.title.replace(/^(?:СЂРѕР·РґС–Р»|РіР»Р°РІР°)\s*\d+\.?\s*/i, '');
      cleanTitle = cleanTitle.replace(/[\r\n]+/g, ' ').trim();
      mainSections += `<h2 style="margin-top:0;">Р РћР—Р”Р†Р› ${sectionNum}. ${escapeHtml(cleanTitle)}</h2>\n`;
      if (section.subsections) {
        section.subsections.forEach(sub => {
          let subTitle = sub.title || '';
          
          // AI sometimes puts the title inside sub.text instead of sub.title, or duplicates it.
          // Check if sub.text starts with a title pattern.
          let textParts = sub.text.split(/\n\n+/);
          let firstPara = textParts[0] ? textParts[0].trim() : '';
          
          if (firstPara && /^[\s\*]*(\d+\.\d+)\.?\s+/.test(firstPara)) {
            // It might contain just the title, OR the title and text separated by a single newline.
            let lines = firstPara.split('\n');
            let firstLine = lines[0].trim();
            if (/^[\s\*]*(\d+\.\d+)\.?\s+/.test(firstLine)) {
              if (!subTitle) {
                subTitle = firstLine;
              }
              // Remove the title line from text
              lines.shift();
              if (lines.length > 0) {
                textParts[0] = lines.join('\n'); // keep the rest of the paragraph
              } else {
                textParts.shift(); // remove completely if it was just the title
              }
            }
          }
          
          sub.text = textParts.join('\n\n');

          // Clean up the subTitle
          if (subTitle) {
            // Strip HTML and Markdown bold just in case
            subTitle = subTitle.replace(/<[^>]*>/g, '').replace(/\*\*/g, '').trim();
            // Fix "1.1." в†’ "1.1" (remove dot right after subsection number)
            subTitle = subTitle.replace(/^(\d+\.\d+)\.\s*/, '$1 ');
            // Remove trailing dot if any, then add exactly one
            subTitle = subTitle.replace(/\s*\.\s*$/, '').trim();
            subTitle = subTitle.replace(/[\r\n]+/g, ' '); // Fix Word splitting headings
            if (subTitle.length > 0 && !subTitle.endsWith('.')) {
              subTitle += '.';
            }
            mainSections += `<h3>${escapeHtml(subTitle)}</h3>\n`;
          }
          
          mainSections += textToParas(sub.text) + '\n';
        });
      }
      mainSections += `<br clear="all" style="page-break-before:always; mso-break-type:page-break" />\n`;
    });
  }

  // в•ђв•ђв•ђ 5. CONCLUSION в•ђв•ђв•ђ
  const conclusionSection = `
<h2 style="margin-top:0;">Р’РРЎРќРћР’РљР</h2>
${textToParas(data.conclusion)}
<br clear="all" style="page-break-before:always; mso-break-type:page-break" />`;

  // в•ђв•ђв•ђ 6. REFERENCES в•ђв•ђв•ђ
  let sourcesHTML = '';
  if (data.sources && data.sources.length > 0) {
    sourcesHTML = data.sources.map((s, i) => {
      const cleanSource = s.replace(/^\d+\.\s*/, '');
      return `<p class="para" style="text-indent:0;padding-left:1.25cm;text-indent:-1.25cm;">${i + 1}. ${escapeHtml(cleanSource)}</p>`;
    }).join('\n');
  }
  const referencesSection = `
<h2 style="margin-top:0;">РЎРџРРЎРћРљ Р’РРљРћР РРЎРўРђРќРРҐ Р”Р–Р•Р Р•Р›</h2>
${sourcesHTML}`;

  // в•ђв•ђв•ђ COMBINE ALL в•ђв•ђв•ђ
  return titlePage + tocPage + introSection + mainSections + conclusionSection + referencesSection + `\n</div>`;
}

// в”Ђв”Ђв”Ђ Export в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function exportDocx() {
  const content = document.getElementById('output-area').innerHTML;
  if (!content || content.includes('placeholder-text')) return;

  const styles = `
    <style>
      /* в•ђв•ђ РЎС‚РѕСЂС–РЅРєР° в•ђв•ђ */
      @page {
        size: A4;
        margin: 20mm 10mm 20mm 20mm;
      }
      @page Section1 {
        margin: 20mm 10mm 20mm 20mm;
      }
      div.Section1 { page: Section1; }
      
      @page Section2 {
        margin: 20mm 10mm 20mm 20mm;
        mso-footer: f1;
        mso-footer-margin: 1.5cm;
      }
      div.Section2 { page: Section2; }
      
      body {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        color: #000000;
        margin: 0;
        padding: 0;
        background: #fff;
      }

      /* в•ђв•ђ РўРёС‚СѓР»СЊРЅР° СЃС‚РѕСЂС–РЅРєР° в•ђв•ђ */
      .Section1 {
        text-align: center;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
      }
      .title-top {
        text-align: center;
        font-size: 14pt;
        font-weight: bold;
        line-height: 150%;
      }
      .title-middle {
        text-align: center;
      }
      .title-middle .essay-word {
        font-size: 14pt;
        font-weight: bold;
      }
      .title-middle .discipline-line {
        font-size: 14pt;
        font-style: italic;
      }
      .title-middle .topic-line {
        font-size: 14pt;
      }
      .title-bottom {
        text-align: center;
        font-size: 14pt;
      }

      /* в•ђв•ђ TOC в•ђв•ђ */
      .toc-container {
      }
      .toc-item {
        text-indent: 0;
        margin: 0;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
      }
      /* MSO TOC styles вЂ” Word uses these when it regenerates the TOC field */
      p.MsoToc1, p.MsoToc2, p.MsoToc3 {
        mso-style-noshow: no;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        margin: 0;
        text-indent: 0;
      }
      p.MsoToc2 {
        margin-left: 1.25cm;
      }
      p.MsoToc3 {
        margin-left: 2.5cm;
      }

      /* в•ђв•ђ Р—Р°РіРѕР»РѕРІРєРё в•ђв•ђ */
      h1 {
        mso-outline-level: 1;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        font-weight: bold;
        text-align: center;
        text-transform: uppercase;
        margin-top: 0.5cm;
        margin-bottom: 0.3cm;
      }
      h2 {
        mso-outline-level: 2;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        font-weight: bold;
        text-align: center;
        text-transform: uppercase;
        margin-top: 0.8cm;
        margin-bottom: 0.3cm;
      }
      h3 {
        mso-outline-level: 3;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        font-weight: bold;
        text-align: center;
        margin-top: 0.5cm;
        margin-bottom: 0.2cm;
        page-break-after: avoid;
      }

      /* в•ђв•ђ РђР±Р·Р°С†Рё РѕСЃРЅРѕРІРЅРѕРіРѕ С‚РµРєСЃС‚Сѓ в•ђв•ђ */
      p, .para {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        text-align: justify;
        text-indent: 1.25cm;
        margin: 0;
        padding: 0;
        orphans: 15;
        widows: 15;
      }
      p.toc-item {
        text-indent: 0;
      }
    </style>
  `;

  // в”Ђв”Ђ Post-process HTML for Word compatibility в”Ђв”Ђ
  let processed = content;

  // 0. Ensure all h3 subsection titles are formatted correctly ("1.1 Title.")
  processed = processed.replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/gi, function(match, attrs, inner) {
    // Decode common entities just for checking
    let pureText = inner.replace(/<[^>]*>/g, '')
                        .replace(/&nbsp;/gi, ' ')
                        .replace(/&amp;/gi, '&')
                        .trim();
    
    // Check if it ends with a dot
    let needsDot = pureText.length > 0 && !pureText.endsWith('.');

    // Also, we need to remove the dot right after the subsection number (e.g. "1.1. " -> "1.1 ")
    // Since inner might have HTML tags like <b>1.1.</b>, we should do a careful replace on the inner HTML.
    // This regex looks for a digit.digit followed by a dot, optionally wrapped in tags.
    // A simpler way is to just do a text replace on the inner string:
    let newInner = inner.replace(/^(\s*(?:<[^>]*>\s*)*\d+\.\d+)\.\s*/, '$1 ');

    if (needsDot) {
      // Remove trailing whitespace/nbsp from HTML string before adding dot
      newInner = newInner.replace(/(?:\s|&nbsp;)+$/, '') + '.';
    }

    return '<h3' + attrs + '>' + newInner + '</h3>';
  });

  // 1. Remove display:flex / flexbox (Word doesn't support it)
  processed = processed.replace(/display\s*:\s*flex\s*;?/gi, '');
  processed = processed.replace(/flex-direction\s*:[^;";]+;?/gi, '');
  processed = processed.replace(/justify-content\s*:[^;";]+;?/gi, '');
  processed = processed.replace(/align-items\s*:[^;";]+;?/gi, '');

  // 2. Fix right-block: Word ignores margin-left %, replace with table
  processed = processed.replace(
    /<div([^>]*class="[^"]*right-block[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi,
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="55%"></td>' +
    '<td width="45%" style="font-family:\'Times New Roman\',serif;font-size:14pt;line-height: 150%;vertical-align:top;">$2</td>' +
    '</tr></table>'
  );

  // Build full MSO HTML document вЂ” Word opens this format natively
  const header =
    "\ufeff" + // UTF-8 BOM for correct encoding detection
    "<!DOCTYPE html>\n" +
    "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
    "xmlns:w='urn:schemas-microsoft-com:office:word' " +
    "xmlns='http://www.w3.org/TR/REC-html40'>\n" +
    "<head>\n" +
    "<meta http-equiv='Content-Type' content='text/html; charset=utf-8'>\n" +
    "<title>Р РµС„РµСЂР°С‚</title>\n" +
    "<!--[if gte mso 9]><xml><w:WordDocument>" +
    "<w:View>Print</w:View>" +
    "<w:Zoom>100</w:Zoom>" +
    "<w:UpdateFields>true</w:UpdateFields>" +
    "<w:DoNotOptimizeForBrowser/>" +
    "</w:WordDocument></xml>" +
    "<xml><w:LatentStyles DefLockedState='false' DefUnhideWhenUsed='false' DefSemiHidden='false' DefQFormat='false' DefPriority='99'>" +
    "</w:LatentStyles></xml>" +
    "<style><!--" +
    " /* Style Definitions */" +
    " @page WordSection1 {size:595.3pt 841.9pt; margin:20.0mm 10.0mm 20.0mm 20.0mm;}" +
    " p.MsoToc1, li.MsoToc1, div.MsoToc1 {mso-style-name:'TOC 1'; font-family:'Times New Roman',serif; font-size:14.0pt; line-height:150%; margin:0cm;}" +
    " p.MsoToc2, li.MsoToc2, div.MsoToc2 {mso-style-name:'TOC 2'; font-family:'Times New Roman',serif; font-size:14.0pt; line-height:150%; margin:0cm; margin-left:1.25cm;}" +
    " p.MsoToc3, li.MsoToc3, div.MsoToc3 {mso-style-name:'TOC 3'; font-family:'Times New Roman',serif; font-size:14.0pt; line-height:150%; margin:0cm; margin-left:2.5cm;}" +
    " p.MsoHeading1, h1 {mso-style-name:'Heading 1'; mso-outline-level:1; font-family:'Times New Roman',serif; font-size:14.0pt; font-weight:bold; text-align:center; text-transform:uppercase;}" +
    " p.MsoHeading2, h2 {mso-style-name:'Heading 2'; mso-outline-level:2; font-family:'Times New Roman',serif; font-size:14.0pt; font-weight:bold; text-align:center; text-transform:uppercase;}" +
    " p.MsoHeading3, h3 {mso-style-name:'Heading 3'; mso-outline-level:3; font-family:'Times New Roman',serif; font-size:14.0pt; font-weight:bold; text-align:center;}" +
    " --></style>" +
    "<![endif]-->\n" +
    styles +
    "\n</head>\n<body lang=\"UK\">\n";
  const footerDef = "\n<div style='mso-element:footer' id='f1'><p class='MsoFooter' style='margin:0; text-align:right; font-family:\"Times New Roman\", serif; font-size:14pt;'><span style='mso-field-code:\" PAGE \"'></span></p></div>\n";
  const footer = footerDef + "</body>\n</html>";
  const sourceHTML = header + processed + footer;

  // Create blob with proper MIME type for Word
  const blob = new Blob([sourceHTML], {
    type: 'application/msword;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'referat.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
