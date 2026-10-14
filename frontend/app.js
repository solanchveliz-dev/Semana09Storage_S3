const API = ''; // mismo origen: el backend sirve este frontend
const LIMITS = {
  'image/jpeg': 5, 'image/png': 5, 'image/webp': 5,
  'video/mp4': 50, 'video/webm': 50, 'video/quicktime': 50
};
const $ = id => document.getElementById(id);
let selected = null;
let items = [];
let filter = 'all';

function toast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = 'toast'), 3200);
}

const fmtSize = b => b < 1024 * 1024 ? (b / 1024).toFixed(1) + ' KB' : (b / 1024 / 1024).toFixed(2) + ' MB';

function makeMedia(type, url, opts = {}) {
  const el = document.createElement(type === 'video' ? 'video' : 'img');
  el.src = url;
  if (type === 'video') {
    el.muted = !opts.controls;
    el.playsInline = true;
    el.preload = 'metadata';
    if (opts.controls) { el.controls = true; el.autoplay = true; }
    if (opts.loop) { el.loop = true; el.autoplay = true; }
  } else {
    el.loading = 'lazy';
    el.alt = '';
  }
  return el;
}

// ---------- Selección y validación (frontend) ----------
function selectFile(file) {
  if (!file) return;
  const max = LIMITS[file.type];
  if (!max) return toast('Tipo no permitido: solo fotos (JPG, PNG, WEBP) o videos (MP4, WEBM, MOV)', 'error');
  if (file.size > max * 1024 * 1024) return toast(`Archivo demasiado grande (máx ${max} MB)`, 'error');
  selected = file;
  const type = file.type.startsWith('video') ? 'video' : 'image';
  const box = $('previewMedia');
  box.innerHTML = '';
  box.appendChild(makeMedia(type, URL.createObjectURL(file), { loop: true }));
  $('fileName').textContent = file.name;
  $('fileMeta').textContent = `${type === 'video' ? '🎬 Video' : '📷 Foto'} · ${file.type} · ${fmtSize(file.size)}`;
  $('preview').classList.remove('hidden');
}

function resetForm() {
  selected = null;
  $('file').value = '';
  $('previewMedia').innerHTML = '';
  $('preview').classList.add('hidden');
  $('progress').classList.add('hidden');
  $('bar').style.width = '0';
}

$('file').addEventListener('change', e => selectFile(e.target.files[0]));
$('cancelBtn').addEventListener('click', resetForm);
const dz = $('dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));

// ---------- Subida: pedir URL al backend y PUT directo a S3 ----------
function putToS3(url, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    $('progress').classList.remove('hidden');
    xhr.upload.onprogress = e => { if (e.lengthComputable) $('bar').style.width = (e.loaded / e.total * 100) + '%'; };
    xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error('S3 rechazó la subida (' + xhr.status + ')')));
    xhr.onerror = () => reject(new Error('Error de red o CORS al subir a S3'));
    xhr.send(file);
  });
}

$('uploadBtn').addEventListener('click', async () => {
  if (!selected) return;
  const btn = $('uploadBtn');
  btn.disabled = true;
  btn.textContent = 'Subiendo...';
  try {
    const res = await fetch(`${API}/api/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: selected.name, contentType: selected.type, sizeBytes: selected.size })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    await putToS3(data.uploadUrl, selected);
    toast('✔ Subido a S3 correctamente', 'success');
    resetForm();
    loadGallery();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Subir a S3';
  }
});

// ---------- Galería ----------
function updateStats() {
  const photos = items.filter(i => i.type === 'image').length;
  const videos = items.filter(i => i.type === 'video').length;
  const total = items.reduce((s, i) => s + i.size, 0);
  $('statTotal').textContent = items.length;
  $('statPhotos').textContent = photos;
  $('statVideos').textContent = videos;
  $('statSize').textContent = fmtSize(total);
}

function render() {
  const list = items.filter(i => filter === 'all' || i.type === filter);
  const g = $('gallery');
  g.innerHTML = '';
  $('empty').classList.toggle('hidden', list.length > 0);

  list.forEach(i => {
    const card = document.createElement('div');
    card.className = 'card';

    const media = document.createElement('div');
    media.className = 'media';
    media.appendChild(makeMedia(i.type, i.url));
    const badge = document.createElement('span');
    badge.className = `type-badge ${i.type}`;
    badge.textContent = i.type === 'video' ? '🎬 VIDEO' : '📷 FOTO';
    media.appendChild(badge);
    if (i.type === 'video') {
      const play = document.createElement('div');
      play.className = 'play';
      play.textContent = '▶';
      media.appendChild(play);
    }
    media.onclick = () => openModal(i);

    const info = document.createElement('div');
    info.className = 'card-info';
    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = i.name;
    const meta = document.createElement('small');
    meta.textContent = `${fmtSize(i.size)} · ${new Date(i.lastModified).toLocaleString('es-PE')}`;
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn ghost small';
    copyBtn.textContent = '🔗 Copiar URL';
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(i.url);
        toast('URL prefirmada copiada (expira en 15 min)', 'success');
      } catch {
        prompt('Copia la URL prefirmada:', i.url);
      }
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger small';
    delBtn.textContent = '🗑 Eliminar';
    delBtn.onclick = () => del(i.key);
    actions.append(copyBtn, delBtn);

    card.append(media, info, actions);
    g.appendChild(card);
  });
}

async function loadGallery() {
  try {
    const res = await fetch(`${API}/api/images`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al listar');
    items = data;
    updateStats();
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function del(key) {
  if (!confirm('¿Eliminar este archivo?')) return;
  try {
    const res = await fetch(`${API}/api/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    toast('Archivo eliminado', 'success');
    loadGallery();
  } catch {
    toast('No se pudo eliminar', 'error');
  }
}

// ---------- Pestañas ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filter = tab.dataset.filter;
    render();
  });
});

// ---------- Modal ----------
function openModal(i) {
  const c = $('modalContent');
  c.innerHTML = '';
  c.appendChild(makeMedia(i.type, i.url, { controls: true }));
  $('modal').classList.remove('hidden');
}
function closeModal() {
  $('modalContent').innerHTML = '';
  $('modal').classList.add('hidden');
}
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

$('refreshBtn').addEventListener('click', loadGallery);
loadGallery();