/* ClipForge Studio v1 — app.js : state, footage sources (keyless), timeline, voiceover UI */
'use strict';

/* ---------- tiny helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtT = s => { s = Math.max(0, s|0); const m = (s/60)|0, h = (s/3600)|0; return (h? h+':':'') + String((m%60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); };
const parseT = str => { const p = String(str).trim().split(':').map(Number); if (p.some(isNaN)) return null; let s = 0; for (const n of p) s = s*60 + n; return s; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- IndexedDB for blobs (voice recordings, uploads) ---------- */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (this.db) return res(this.db);
      const r = indexedDB.open('clipforge', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(key, blob) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('blobs','readwrite').objectStore('blobs').put(blob, key); t.onsuccess = res; t.onerror = () => rej(t.error); }); },
  async get(key) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('blobs').objectStore('blobs').get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => rej(t.error); }); },
  async del(key) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('blobs','readwrite').objectStore('blobs').delete(key); t.onsuccess = res; t.onerror = () => rej(t.error); }); },
};

/* ---------- state ---------- */
let S = {
  format: 'short', title: '', clips: [], captions: [],
  musicId: null, musicVol: 12,
  ovTitle: '', ovHandle: '', ovTitleOn: true,
  capsBurn: true, capsSrt: true,
  metaTitle: '', metaDesc: '', metaTags: 'quantumphysics, science, space',
  ytKey: '',
};
// clip: {id,name,kind:'remote'|'upload',fileUrl,thumb,license,credit,pageUrl,in,out,script,voiceId,voiceName,refOnly}

function save() { try { const slim = {...S, clips: S.clips.map(c => ({...c}))}; localStorage.setItem('clipforge1', JSON.stringify(slim)); } catch(e){} }
const saveSoon = debounce(save, 600);
function load() {
  try { const raw = localStorage.getItem('clipforge1'); if (raw) S = {...S, ...JSON.parse(raw)}; } catch(e){}
  S.ytKey = localStorage.getItem('cf_ytkey') || '';
}

/* ---------- tabs ---------- */
$$('#tabs .tab').forEach(b => b.addEventListener('click', () => {
  $$('#tabs .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('main .panel').forEach(p => p.classList.add('hidden'));
  $('#tab-' + b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'timeline') renderTimeline();
  if (b.dataset.tab === 'voice') renderVoice();
  if (b.dataset.tab === 'render') renderChecklist();
}));

/* ================================================================
   FOOTAGE SOURCES — all keyless except optional YouTube tab
   ================================================================ */
let curSrc = 'nasa';
const SRC_NOTES = {
  nasa: 'NASA Image & Video Library — public domain US government works. Free, no key.',
  archive: 'Archive.org — public-domain films (Prelinger, NASA, science). Free, no key.',
  commons: 'Wikimedia Commons — freely licensed media (check per-file license). Free, no key.',
  youtube: 'YouTube search needs a Data API key (optional). Results are added as references for your Edit Plan — obtain the file per the creator\u2019s terms; the app never rips videos.',
};
$$('#src-tabs .src-tab').forEach(b => b.addEventListener('click', () => {
  $$('#src-tabs .src-tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); curSrc = b.dataset.src;
  $('#yt-key-row').classList.toggle('hidden', curSrc !== 'youtube');
  $('#src-note').textContent = SRC_NOTES[curSrc];
  $('#results').innerHTML = '';
}));
$('#src-note').textContent = SRC_NOTES.nasa;

$('#yt-save').addEventListener('click', () => {
  S.ytKey = $('#yt-key').value.trim();
  localStorage.setItem('cf_ytkey', S.ytKey);
  alert(S.ytKey ? 'Key saved locally.' : 'Key cleared.');
});

async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

async function nasaFileUrl(nasaId) {
  // Resolve best small mp4 from the asset manifest
  const man = await jget('https://images-api.nasa.gov/asset/' + nasaId);
  const hrefs = (man.collection?.items || []).map(i => i.href).filter(h => /\.mp4(\?|$)/i.test(h));
  if (!hrefs.length) return null;
  const pref = hrefs.find(h => /small|mobile|720|preview/i.test(h)) || hrefs[0];
  return pref.replace(/^http:/, 'https:');
}

async function searchNASA(q) {
  const d = await jget('https://images-api.nasa.gov/search?q=' + encodeURIComponent(q) + '&media_type=video&page_size=12');
  const items = d.collection?.items || [];
  const out = [];
  for (const it of items.slice(0, 12)) {
    const meta = it.data?.[0]; if (!meta) continue;
    try {
      const file = await nasaFileUrl(meta.nasa_id);
      if (!file) continue;
      out.push({ name: meta.title, fileUrl: file, thumb: it.links?.[0]?.href || '',
        license: 'Public Domain (NASA)', credit: 'NASA', pageUrl: 'https://images.nasa.gov/details-' + meta.nasa_id });
    } catch(e){}
  }
  return out;
}

async function searchArchive(q) {
  const d = await jget('https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
    '+AND+mediatype:movies&fl[]=identifier&fl[]=title&rows=12&output=json');
  const docs = d.response?.docs || [];
  const out = [];
  for (const doc of docs) {
    try {
      const m = await jget('https://archive.org/metadata/' + doc.identifier);
      const files = (m.files || []).filter(f => /\.mp4$/i.test(f.name));
      if (!files.length) continue;
      files.sort((a,b) => (a.size||9e12) - (b.size||9e12));
      const pick = files.find(f => /512kb/i.test(f.name)) || files[0];
      out.push({ name: doc.title || doc.identifier, fileUrl: 'https://archive.org/download/' + doc.identifier + '/' + encodeURIComponent(pick.name),
        thumb: 'https://archive.org/services/img/' + doc.identifier,
        license: 'Public Domain (verify item page)', credit: 'Archive.org', pageUrl: 'https://archive.org/details/' + doc.identifier });
    } catch(e){}
  }
  return out;
}

async function searchCommons(q) {
  const d = await jget('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    '&generator=search&gsrsearch=' + encodeURIComponent('filetype:video ' + q) + '&gsrnamespace=6&gsrlimit=12' +
    '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=320');
  const pages = Object.values(d.query?.pages || {});
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0]; if (!ii || !/^video\//.test(ii.mime || '')) continue;
    let file = ii.url, label = 'original';
    try {
      const v = await jget('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
        '&titles=' + encodeURIComponent(p.title) + '&prop=videoinfo&viprop=derivatives');
      const pg = Object.values(v.query?.pages || {})[0];
      const ders = (pg?.videoinfo?.[0]?.derivatives || []).filter(x => x.src && /\.(mp4|webm)/i.test(x.src));
      ders.sort((a,b) => (a.width||9999) - (b.width||9999));
      const d720 = ders.find(x => (x.width||0) >= 640) || ders[0];
      if (d720) { file = d720.src.replace(/^http:/,'https:'); label = d720.width + 'p'; }
    } catch(e){}
    const lic = ii.extmetadata?.LicenseShortName?.value?.replace(/<[^>]+>/g,'') || 'see Commons page';
    out.push({ name: p.title.replace(/^File:/,''), fileUrl: file, thumb: ii.thumburl || '',
      license: lic + ' (' + label + ')', credit: 'Wikimedia Commons', pageUrl: ii.descriptionurl || '' });
  }
  return out;
}

async function searchYouTube(q) {
  if (!S.ytKey) { alert('Paste a YouTube Data API key first (optional).'); return []; }
  const d = await jget('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoLicense=creativeCommon&maxResults=12&q=' +
    encodeURIComponent(q) + '&key=' + S.ytKey);
  return (d.items || []).map(it => ({
    name: it.snippet.title, fileUrl: null, refOnly: true,
    thumb: it.snippet.thumbnails?.medium?.url || '',
    license: 'CC (verify on YouTube)', credit: it.snippet.channelTitle,
    pageUrl: 'https://www.youtube.com/watch?v=' + it.id.videoId, ytId: it.id.videoId,
  }));
}

function renderResults(list) {
  const box = $('#results');
  if (!list.length) { box.innerHTML = '<div class="empty">No results. Try a different search.</div>'; return; }
  box.innerHTML = '';
  list.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'result';
    el.innerHTML = (r.fileUrl
        ? '<video src="' + esc(r.fileUrl) + '" preload="metadata" muted playsinline></video>'
        : '<img src="' + esc(r.thumb) + '" alt="">') +
      '<div class="body"><div class="t">' + esc(r.name) + '</div>' +
      '<div class="s">' + esc(r.license) + ' · ' + esc(r.credit) + '</div>' +
      '<button data-i="' + i + '">' + (r.refOnly ? '＋ Add reference to plan' : '＋ Add to timeline') + '</button></div>';
    el.querySelector('video')?.addEventListener('mouseenter', e => e.target.play().catch(()=>{}));
    el.querySelector('video')?.addEventListener('mouseleave', e => { e.target.pause(); e.target.currentTime = 0; });
    el.querySelector('button').addEventListener('click', () => addClip(r));
    box.appendChild(el);
  });
}

async function doSearch(q) {
  const box = $('#results');
  box.innerHTML = '<div class="empty">Searching…</div>';
  try {
    const fn = { nasa: searchNASA, archive: searchArchive, commons: searchCommons, youtube: searchYouTube }[curSrc];
    renderResults(await fn(q || 'apollo 11'));
  } catch(e) { box.innerHTML = '<div class="empty">Search failed: ' + esc(e.message) + '</div>'; }
}
$('#search-btn').addEventListener('click', () => doSearch($('#search-q').value.trim()));
$('#search-q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(e.target.value.trim()); });
$$('.sample').forEach(b => b.addEventListener('click', () => { $('#search-q').value = b.dataset.q; doSearch(b.dataset.q); }));

function addClip(r) {
  const c = { id: uid(), name: r.name, kind: r.fileUrl ? 'remote' : (r.refOnly ? 'ref' : 'upload'),
    fileUrl: r.fileUrl || null, thumb: r.thumb || '', license: r.license, credit: r.credit, pageUrl: r.pageUrl,
    in: 0, out: 20, script: '', voiceId: null, voiceName: '', refOnly: !!r.refOnly };
  S.clips.push(c); saveSoon();
  $$('#tabs .tab').forEach(x => x.classList.toggle('done', false));
  document.querySelector('[data-tab="timeline"]').click();
}

$('#upload-video').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const id = uid();
  await idb.put('file:' + id, f);
  S.clips.push({ id, name: f.name.replace(/\.[^.]+$/,''), kind: 'upload', fileUrl: null, thumb: '',
    license: 'Your own file', credit: 'You', pageUrl: '', in: 0, out: 20, script: '', voiceId: null, voiceName: '', refOnly: false });
  saveSoon(); e.target.value = '';
  document.querySelector('[data-tab="timeline"]').click();
});

/* ---------- TIMELINE ---------- */
async function clipSrcUrl(c) {
  if (c.kind === 'upload') {
    const b = await idb.get('file:' + c.id);
    return b ? URL.createObjectURL(b) : null;
  }
  return c.fileUrl;
}

function totalDur() { return S.clips.filter(c => !c.refOnly).reduce((a, c) => a + Math.max(0.5, (c.out ?? 20) - (c.in ?? 0)), 0); }

function renderTimeline() {
  const box = $('#timeline'); box.innerHTML = '';
  const clips = S.clips;
  $('#tl-empty').style.display = clips.length ? 'none' : 'block';
  $('#tl-total').textContent = clips.length ? '· total ≈ ' + fmtT(totalDur()) + (S.format === 'short' ? ' (Shorts: keep ≤ 60s)' : '') : '';
  clips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'clip';
    el.innerHTML =
      '<div class="head"><span class="n">' + (i+1) + '</span><span class="t">' + esc(c.name) + '</span>' +
      '<span class="hint">' + esc(c.license || '') + '</span>' +
      '<button class="icon-btn" data-a="up" ' + (i===0?'disabled':'') + '>↑</button>' +
      '<button class="icon-btn" data-a="dn" ' + (i===clips.length-1?'disabled':'') + '>↓</button>' +
      '<button class="icon-btn" data-a="del">✕</button></div>' +
      (c.refOnly
        ? '<p class="note">Reference only (YouTube CC search). The file must be obtained per the creator\u2019s terms — it will appear in your Edit Plan + attribution, not in the render. <a href="' + esc(c.pageUrl) + '" target="_blank" rel="noopener">Open video ↗</a></p>'
        : '<video controls playsinline preload="metadata"></video>' +
          '<div class="trim"><label>IN <input type="number" data-f="in" value="' + c.in + '" min="0" step="0.5"></label>' +
          '<label>OUT <input type="number" data-f="out" value="' + c.out + '" min="0.5" step="0.5"></label>' +
          '<button class="icon-btn" data-a="setin">Set IN ⏺</button>' +
          '<button class="icon-btn" data-a="setout">Set OUT ⏺</button>' +
          '<span class="hint dur"></span></div>') +
      '<label class="small">Narration script for this clip</label>' +
      '<textarea rows="2" data-f="script" placeholder="Write what you will say over this clip…">' + esc(c.script) + '</textarea>';
    const vid = el.querySelector('video');
    if (vid) {
      clipSrcUrl(c).then(u => { if (u) vid.src = u; });
      const upd = () => { const d = Math.max(0.5, c.out - c.in); el.querySelector('.dur').textContent = '≈ ' + d.toFixed(1) + 's'; };
      upd();
      el.querySelector('[data-a="setin"]').addEventListener('click', () => { c.in = +vid.currentTime.toFixed(1); el.querySelector('[data-f="in"]').value = c.in; upd(); saveSoon(); });
      el.querySelector('[data-a="setout"]').addEventListener('click', () => { c.out = +vid.currentTime.toFixed(1); el.querySelector('[data-f="out"]').value = c.out; upd(); saveSoon(); });
      el.querySelectorAll('[data-f="in"],[data-f="out"]').forEach(inp => inp.addEventListener('change', () => {
        c[inp.dataset.f] = Math.max(0, +inp.value || 0);
        if (c.out <= c.in) c.out = c.in + 1;
        el.querySelector('[data-f="in"]').value = c.in; el.querySelector('[data-f="out"]').value = c.out;
        upd(); saveSoon(); renderTimeline._t = $('#tl-total').textContent = '· total ≈ ' + fmtT(totalDur());
      }));
    }
    el.querySelector('[data-f="script"]').addEventListener('input', e => { c.script = e.target.value; saveSoon(); });
    el.querySelector('[data-a="up"]').addEventListener('click', () => { [S.clips[i-1], S.clips[i]] = [S.clips[i], S.clips[i-1]]; saveSoon(); renderTimeline(); });
    el.querySelector('[data-a="dn"]').addEventListener('click', () => { [S.clips[i+1], S.clips[i]] = [S.clips[i], S.clips[i+1]]; saveSoon(); renderTimeline(); });
    el.querySelector('[data-a="del"]').addEventListener('click', async () => {
      if (c.voiceId) await idb.del('voice:' + c.voiceId).catch(()=>{});
      if (c.kind === 'upload') await idb.del('file:' + c.id).catch(()=>{});
      S.clips.splice(i, 1); saveSoon(); renderTimeline();
    });
    box.appendChild(el);
  });
}

/* ---------- VOICEOVER ---------- */
let rec = null; // {mr, chunks, clipId, t0, timer}

function renderVoice() {
  const box = $('#voice-list'); box.innerHTML = '';
  const clips = S.clips.filter(c => !c.refOnly);
  $('#voice-empty').style.display = clips.length ? 'none' : 'block';
  clips.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'clip';
    el.innerHTML =
      '<div class="head"><span class="t">' + esc(c.name) + '</span><span class="hint">' + Math.max(0.5, c.out - c.in).toFixed(1) + 's clip</span></div>' +
      '<div class="tele">' + (esc(c.script) || '<span class="hint">No script written — add one in the Timeline tab.</span>') + '</div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap">' +
        '<button class="rec-btn"><span class="rec"></span>Record</button>' +
        '<button class="icon-btn up-btn">⤒ Upload audio</button>' +
        '<input type="file" accept="audio/*" hidden>' +
        '<span class="vstat">' + (c.voiceName ? '🎙 ' + esc(c.voiceName) : 'no voiceover yet') + '</span>' +
        (c.voiceId ? '<button class="icon-btn play-btn">▶ Play</button><button class="icon-btn delv-btn">✕</button>' : '') +
      '</div>';
    const recBtn = el.querySelector('.rec-btn');
    const dot = recBtn.querySelector('.rec');
    recBtn.addEventListener('click', async () => {
      if (rec) { stopRec(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        const chunks = [];
        mr.ondataavailable = e => chunks.push(e.data);
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          const vid = uid();
          await idb.put('voice:' + vid, blob);
          if (c.voiceId) await idb.del('voice:' + c.voiceId).catch(()=>{});
          c.voiceId = vid; c.voiceName = 'recorded ' + new Date().toLocaleTimeString();
          saveSoon(); renderVoice();
        };
        rec = { mr, clipId: c.id };
        mr.start(); dot.classList.add('on'); recBtn.innerHTML = '<span class="rec on"></span>Stop ⏹';
        recBtn.onclick = () => stopRec();
      } catch(e) { alert('Microphone blocked: ' + e.message); }
    });
    const fileInp = el.querySelector('input[type=file]');
    el.querySelector('.up-btn').addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', async () => {
      const f = fileInp.files[0]; if (!f) return;
      const vid = uid(); await idb.put('voice:' + vid, f);
      if (c.voiceId) await idb.del('voice:' + c.voiceId).catch(()=>{});
      c.voiceId = vid; c.voiceName = f.name; saveSoon(); renderVoice();
    });
    const pb = el.querySelector('.play-btn');
    if (pb) pb.addEventListener('click', async () => {
      const b = await idb.get('voice:' + c.voiceId);
      if (b) new Audio(URL.createObjectURL(b)).play();
    });
    const db = el.querySelector('.delv-btn');
    if (db) db.addEventListener('click', async () => { await idb.del('voice:' + c.voiceId).catch(()=>{}); c.voiceId = null; c.voiceName = ''; saveSoon(); renderVoice(); });
    box.appendChild(el);
  });
}
function stopRec() { if (rec) { try { rec.mr.stop(); } catch(e){} rec = null; } }

/* ---------- STYLE TAB wiring ---------- */
$$('input[name=format]').forEach(r => r.addEventListener('change', () => { S.format = r.value; saveSoon(); }));
$('#music-vol').addEventListener('input', e => { S.musicVol = +e.target.value; $('#music-vol-v').textContent = e.target.value + '%'; saveSoon(); });
$('#upload-music').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const id = uid(); await idb.put('music:' + id, f);
  if (S.musicId) await idb.del('music:' + S.musicId).catch(()=>{});
  S.musicId = id; $('#music-name').textContent = '🎵 ' + f.name; saveSoon(); e.target.value = '';
});
['ov-title','ov-handle','meta-title','meta-desc','meta-tags'].forEach(id => {
  $('#' + id).addEventListener('input', e => {
    S[{ 'ov-title':'ovTitle','ov-handle':'ovHandle','meta-title':'metaTitle','meta-desc':'metaDesc','meta-tags':'metaTags' }[id]] = e.target.value;
    saveSoon();
  });
});
$('#ov-title-on').addEventListener('change', e => { S.ovTitleOn = e.target.checked; saveSoon(); });
$('#caps-burn').addEventListener('change', e => { S.capsBurn = e.target.checked; saveSoon(); });
$('#caps-srt').addEventListener('change', e => { S.capsSrt = e.target.checked; saveSoon(); });

function restoreUI() {
  const rf = document.querySelector('input[name=format][value="' + S.format + '"]'); if (rf) rf.checked = true;
  $('#music-vol').value = S.musicVol; $('#music-vol-v').textContent = S.musicVol + '%';
  $('#ov-title').value = S.ovTitle; $('#ov-handle').value = S.ovHandle; $('#ov-title-on').checked = S.ovTitleOn;
  $('#caps-burn').checked = S.capsBurn; $('#caps-srt').checked = S.capsSrt;
  $('#meta-title').value = S.metaTitle; $('#meta-desc').value = S.metaDesc; $('#meta-tags').value = S.metaTags;
  $('#yt-key').value = S.ytKey;
  if (S.musicId) idb.get('music:' + S.musicId).then(b => { if (b) $('#music-name').textContent = '🎵 saved track (' + (b.size/1048576).toFixed(1) + ' MB)'; });
}
