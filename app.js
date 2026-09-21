/* ClipForge Studio v2 — app logic. Keyless sources, projects, one-click drafts, brand. */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const uid = () => 'c' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36);

function defaultState() {
  return {
    format: 'short', title: '',
    clips: [], captions: [], words: [],
    musicId: null, musicVol: 12,
    ovTitle: '', ovHandle: '', ovTitleOn: true,
    capsBurn: true, capsSrt: true, captionStyle: 'karaoke',
    metaTitle: '', metaDesc: '', metaTags: '',
    brand: { name: '', handle: '', color: '#00e5a0', intro: '', outro: '' },
  };
}
let S = defaultState();

/* ---------- toast ---------- */
let toastT = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg;
  t.classList.remove('hidden'); t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.add('hidden'); t.classList.remove('show'); }, 2600);
}

/* ---------- projects ---------- */
const PROJ_STORE = 'clipforge_projects_v1';
let projects = null;
function persistProjects() { try { localStorage.setItem(PROJ_STORE, JSON.stringify(projects)); } catch(e){} }
function projKey() { return 'clipforge_project_' + projects.active; }
function loadProjects() {
  try { projects = JSON.parse(localStorage.getItem(PROJ_STORE)) || null; } catch(e) { projects = null; }
  if (!projects || !projects.list || !Object.keys(projects.list).length) {
    const id = 'p' + Date.now().toString(36);
    projects = { active: id, list: {} };
    projects.list[id] = { name: 'My first project', updated: Date.now() };
    const legacy = localStorage.getItem('clipforge_project_v1');
    if (legacy) { localStorage.setItem('clipforge_project_' + id, legacy); localStorage.removeItem('clipforge_project_v1'); }
    persistProjects();
  }
  if (!projects.list[projects.active]) projects.active = Object.keys(projects.list)[0];
}
function save(silent) {
  try {
    localStorage.setItem(projKey(), JSON.stringify(S));
    projects.list[projects.active].updated = Date.now();
    persistProjects();
  } catch(e) {}
  if (!silent) toast('Project saved ✓');
  renderProjBar();
}
function loadState() {
  try { const raw = localStorage.getItem(projKey()); S = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState(); }
  catch(e) { S = defaultState(); }
}
function renderProjBar() {
  const sel = $('#project-sel'); if (!sel) return;
  sel.innerHTML = '';
  Object.entries(projects.list).sort((a,b) => b[1].updated - a[1].updated).forEach(([id, p]) => {
    const o = document.createElement('option'); o.value = id; o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = projects.active;
}

/* ---------- tabs ---------- */
function switchTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + name));
}
$$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ---------- search (keyless) ---------- */
let currentSrc = 'nasa';
$$('.src-tab').forEach(b => b.addEventListener('click', () => {
  currentSrc = b.dataset.src;
  $$('.src-tab').forEach(x => x.classList.toggle('active', x === b));
  $('#yt-key-row').classList.toggle('hidden', currentSrc !== 'youtube');
  const notes = {
    nasa: 'NASA Image & Video Library — public domain.',
    archive: 'Archive.org — filter to public-domain / Creative Commons items.',
    commons: 'Wikimedia Commons — check the file page license before publishing.',
    youtube: 'YouTube search is metadata only (needs your free API key). We never rip YouTube videos — use it to discover CC videos, then confirm license on YouTube.',
  };
  $('#src-note').textContent = notes[currentSrc];
}));
$('#src-note').textContent = 'NASA Image & Video Library — public domain.';
$('#search-btn').addEventListener('click', () => doSearch($('#search-q').value.trim()));
$('#search-q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch($('#search-q').value.trim()); });
$$('.sample').forEach(b => b.addEventListener('click', () => { $('#search-q').value = b.dataset.q; doSearch(b.dataset.q); }));
$('#yt-save').addEventListener('click', () => {
  const k = $('#yt-key').value.trim();
  if (k) { localStorage.setItem('clipforge_ytkey', k); toast('Key saved locally'); }
});

async function doSearch(q) {
  if (!q) return;
  const box = $('#results');
  box.innerHTML = '<p class="note">Searching…</p>';
  try {
    let items = [];
    if (currentSrc === 'nasa') items = await searchNASA(q);
    else if (currentSrc === 'archive') items = await searchArchive(q);
    else if (currentSrc === 'commons') items = await searchCommons(q);
    else items = await searchYouTube(q);
    renderResults(items);
  } catch (e) {
    box.innerHTML = '<p class="note">Search failed (' + esc(e.message) + '). Try again or another source.</p>';
  }
}

function renderResults(items) {
  const box = $('#results');
  if (!items.length) { box.innerHTML = '<p class="note">No results. Try different keywords.</p>'; return; }
  box.innerHTML = '';
  items.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'result';
    const thumb = r.thumb
      ? '<img class="rthumb" loading="lazy" src="' + esc(r.thumb) + '" alt="">'
      : '<div class="rthumb rthumb-none">🎬</div>';
    card.innerHTML =
      thumb +
      '<div class="rbody"><div class="rtitle">' + esc(r.title) + '</div>' +
      '<div class="rmeta">' + esc(r.sourceLabel) + ' · ' + esc(r.license) + (r.duration ? ' · ' + esc(r.duration) : '') + '</div>' +
      '<div class="ractions"><a class="ghost small" target="_blank" rel="noopener" href="' + esc(r.pageUrl) + '">Source ↗</a>' +
      (r.fileUrl
        ? '<button class="primary small" data-i="' + i + '">+ Add to timeline</button>'
        : '<button class="ghost small" data-i="' + i + '">+ Add (link)</button>') +
      '</div></div>';
    card.querySelector('button').addEventListener('click', () => addClip(items[i]));
    box.appendChild(card);
  });
}

/* ---- NASA ---- */
async function searchNASA(q) {
  const d = await (await fetch('https://images-api.nasa.gov/search?q=' + encodeURIComponent(q) + '&media_type=video&page_size=12')).json();
  const out = [];
  for (const it of (d.collection.items || []).slice(0, 12)) {
    const meta = (it.data || [])[0] || {};
    const thumb = (it.links || [])[0] && (it.links || [])[0].href;
    let fileUrl = null;
    if (meta.nasa_id) {
      try {
        const man = await (await fetch('https://images-api.nasa.gov/asset/' + meta.nasa_id)).json();
        const vids = (man.collection.items || []).filter(x => /\.mp4/i.test(x.href));
        const pref = vids.find(x => /small|mobile|720/i.test(x.href)) || vids[0];
        if (pref) fileUrl = pref.href.replace(/^http:/, 'https:');
      } catch(e) {}
    }
    out.push({
      title: meta.title || 'Untitled', source: 'nasa', sourceLabel: 'NASA',
      license: 'Public domain', pageUrl: 'https://images.nasa.gov/details/' + (meta.nasa_id || ''),
      thumb, fileUrl,
    });
  }
  return out;
}

/* ---- Archive.org ---- */
async function searchArchive(q) {
  const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q + ' AND mediatype:movies') +
    '&fl[]=identifier&fl[]=title&rows=12&page=1&output=json';
  const d = await (await fetch(url)).json();
  const out = [];
  for (const doc of (d.response.docs || [])) {
    try {
      const m = await (await fetch('https://archive.org/metadata/' + doc.identifier)).json();
      const files = (m.files || []).filter(f => /\.mp4$/i.test(f.name));
      if (!files.length) continue;
      files.sort((a, b) => (a.size || 9e12) - (b.size || 9e12));
      const pick = files.find(f => /512kb/i.test(f.name)) || files[0];
      const lic = (m.metadata.licenseurl || '').includes('creativecommons') ? 'CC (check)' : 'Public domain?';
      out.push({
        title: doc.title || doc.identifier, source: 'archive', sourceLabel: 'Archive.org',
        license: lic, pageUrl: 'https://archive.org/details/' + doc.identifier,
        thumb: 'https://archive.org/services/img/' + doc.identifier,
        fileUrl: 'https://archive.org/download/' + doc.identifier + '/' + encodeURIComponent(pick.name),
      });
    } catch(e) {}
  }
  return out;
}

/* ---- Wikimedia Commons ---- */
async function searchCommons(q) {
  const api = 'https://commons.wikimedia.org/w/api.php';
  const s = await (await fetch(api + '?action=query&format=json&origin=*' +
    '&generator=search&gsrsearch=' + encodeURIComponent('filetype:video ' + q) +
    '&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|mime|extmetadata')).json();
  const pages = Object.values((s.query || {}).pages || {});
  const out = [];
  for (const p of pages) {
    const ii = (p.imageinfo || [])[0] || {};
    if (!(ii.mime || '').startsWith('video/')) continue;
    const licShort = (((ii.extmetadata || {}).LicenseShortName || {}).value || 'check license').replace(/<[^>]+>/g, '');
    let fileUrl = null;
    const thumb = ii.thumburl || null;
    try {
      const v = await (await fetch(api + '?action=query&format=json&origin=*' +
        '&titles=' + encodeURIComponent(p.title) + '&prop=videoinfo&viprop=derivatives')).json();
      const pg = Object.values((v.query || {}).pages || {})[0] || {};
      const ders = (((pg.videoinfo || [])[0] || {}).derivatives || [])
        .filter(x => x.src && /\.(mp4|webm)$/i.test(x.src))
        .sort((a, b) => (a.width || 9999) - (b.width || 9999));
      const cand = ders.find(x => (x.width || 0) >= 480) || ders[0];
      if (cand) fileUrl = cand.src.replace(/^http:/, 'https:');
    } catch(e) {}
    out.push({
      title: p.title.replace(/^File:/, '').replace(/_/g, ' '), source: 'commons', sourceLabel: 'Wikimedia',
      license: licShort, pageUrl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title),
      thumb, fileUrl,
    });
  }
  return out;
}

/* ---- YouTube CC (metadata only) ---- */
async function searchYouTube(q) {
  const key = localStorage.getItem('clipforge_ytkey') || '';
  if (!key) {
    $('#results').innerHTML = '<p class="note">Paste a free YouTube Data API key above to search YouTube (metadata only).</p>';
    return [];
  }
  const u = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoLicense=creativeCommon&maxResults=12&q='
    + encodeURIComponent(q) + '&key=' + encodeURIComponent(key);
  const d = await (await fetch(u)).json();
  return (d.items || []).map(it => ({
    title: it.snippet.title, source: 'youtube', sourceLabel: 'YouTube CC',
    license: 'CC (verify on YouTube)', pageUrl: 'https://www.youtube.com/watch?v=' + it.id.videoId,
    thumb: ((it.snippet.thumbnails || {}).medium || {}).url, fileUrl: null,
  }));
}

/* ---------- uploads ---------- */
$('#upload-video').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const id = await idbPut('media', f);
  S.clips.push({ id: uid(), title: f.name, source: 'upload', license: 'Your file',
    pageUrl: '', fileUrl: null, mediaId: id, duration: null, in: 0, out: 20, script: '', audioId: null, audioName: null });
  save(true); renderTimeline(); renderVoice(); toast('Video added');
  e.target.value = '';
});
$('#upload-music').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  S.musicId = await idbPut('media', f);
  $('#music-name').textContent = f.name;
  save(true); toast('Music added');
});

/* ---------- timeline ---------- */
function addClip(r) {
  S.clips.push({
    id: uid(), title: r.title, source: r.source, license: r.license,
    pageUrl: r.pageUrl, fileUrl: r.fileUrl, mediaId: r.mediaId || null,
    duration: r.duration || null, in: 0, out: 20, script: '', audioId: null, audioName: null,
  });
  save(true); renderTimeline(); renderVoice();
  toast('Added to timeline');
  switchTab('timeline');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function estSecs(script) { const w = String(script || '').trim().split(/\s+/).filter(Boolean).length; return w ? Math.round(w / 2.5) : 0; }

function renderTimeline() {
  const box = $('#timeline'); box.innerHTML = '';
  $('#tl-empty').style.display = S.clips.length ? 'none' : 'block';
  let total = 0;
  S.clips.forEach((c, i) => {
    total += Math.max(0, c.out - c.in);
    const el = document.createElement('div');
    el.className = 'tclip';
    const est = estSecs(c.script);
    el.innerHTML =
      '<div class="tclip-head"><b>#' + (i+1) + '</b> <span class="ttitle">' + esc(c.title) + '</span>' +
      '<span class="hint">' + esc(c.source) + ' · ' + esc(c.license) + '</span>' +
      '<span class="hint est">~' + est + 's script</span>' +
      '<span class="spacer"></span>' +
      (i > 0 ? '<button class="ghost small mv" data-a="up">↑</button>' : '') +
      (i < S.clips.length - 1 ? '<button class="ghost small mv" data-a="dn">↓</button>' : '') +
      '<button class="ghost small danger rm">✕</button></div>' +
      '<video class="tlprev" controls playsinline preload="metadata" src="' + esc(previewUrl(c)) + '"></video>' +
      '<div class="row wrap"><label class="small">In <input type="number" class="tin" step="0.5" min="0" value="' + c.in + '"></label>' +
      '<label class="small">Out <input type="number" class="tout" step="0.5" min="0.5" value="' + c.out + '"></label>' +
      '<button class="ghost small setin">Set In @ playhead</button>' +
      '<button class="ghost small setout">Set Out @ playhead</button>' +
      '<span class="hint dur"></span></div>' +
      '<div class="row"><label class="small grow">Narration script</label><button class="ghost small insert-tmpl">Insert template</button></div>' +
      '<textarea class="script" rows="3" placeholder="Write what you will say over this clip…">' + esc(c.script) + '</textarea>';
    const vid = el.querySelector('video');
    vid.addEventListener('loadedmetadata', () => {
      if (!c.duration) c.duration = vid.duration;
      el.querySelector('.dur').textContent = 'clip length: ' + fmtT(c.out - c.in) + ' / source ' + fmtT(vid.duration);
    });
    el.querySelector('.tin').addEventListener('change', e => { c.in = Math.max(0, +e.target.value || 0); save(true); renderTimeline(); });
    el.querySelector('.tout').addEventListener('change', e => { c.out = Math.max(c.in + 0.5, +e.target.value || 0); save(true); renderTimeline(); });
    el.querySelector('.setin').addEventListener('click', () => { c.in = +vid.currentTime.toFixed(1); save(true); renderTimeline(); });
    el.querySelector('.setout').addEventListener('click', () => { c.out = +vid.currentTime.toFixed(1); save(true); renderTimeline(); });
    el.querySelector('.script').addEventListener('input', e => {
      c.script = e.target.value;
      const estEl = el.querySelector('.est');
      if (estEl) estEl.textContent = '~' + estSecs(c.script) + 's script';
      save(true); renderChecklist();
    });
    el.querySelector('.insert-tmpl').addEventListener('click', () => {
      const topic = ($('#oc-topic').value.trim() || c.title || '').replace(/\.[^.]+$/, '').slice(0, 60) || 'this breakthrough';
      c.script = buildScript($('#tmpl-sel').value, topic);
      save(true); renderTimeline(); renderVoice(); toast('Template inserted — edit freely');
    });
    el.querySelector('.rm').addEventListener('click', () => { S.clips.splice(i, 1); save(true); renderTimeline(); renderVoice(); renderChecklist(); });
    el.querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => {
      const j = b.dataset.a === 'up' ? i - 1 : i + 1;
      const tmp = S.clips[i]; S.clips[i] = S.clips[j]; S.clips[j] = tmp;
      save(true); renderTimeline(); renderVoice();
    }));
    box.appendChild(el);
  });
  $('#tl-total').textContent = S.clips.length ? '· total ' + fmtT(total) : '';
}
function fmtT(s) { s = Math.max(0, s || 0); const m = Math.floor(s / 60), ss = (s % 60).toFixed(1); return m + ':' + String(ss).padStart(4, '0'); }
function previewUrl(c) {
  if (c._objUrl) return c._objUrl;
  if (c.fileUrl) return c.fileUrl;
  if (c.mediaId) { idbGet('media', c.mediaId).then(b => { if (b) { c._objUrl = URL.createObjectURL(b); renderTimeline(); } }); return ''; }
  return '';
}

/* ---------- script templates ---------- */
function buildScript(tmpl, topic) {
  const T = (topic || 'this breakthrough').trim();
  if (tmpl === 'explain')
    return 'So what is ' + T + ', really? Here is the simple version. At its core, it is a new way of doing something humans have wanted to do forever. It matters because it changes what is possible, not just what is convenient. And here is the wild part. We are still at the beginning. The version our grandchildren inherit will make today look like a rough draft. That is the pattern of progress. Confusing, then obvious, then invisible. ' + T + ' is on that exact path.';
  if (tmpl === 'myth')
    return 'You have probably heard that ' + T + ' is impossible. That is the myth. Here is the truth. The science does not forbid it. It just demands we be cleverer than we were yesterday. Every impossible in history had an expiration date. Heavier than air flight. Splitting the atom. Standing on the Moon. ' + T + ' is next in line. Not magic. Just physics we have not finished learning yet.';
  return 'For most of human history, ' + T + ' sounded like science fiction. The smartest people who ever lived could not imagine it. Then someone asked a better question, and the answer changed everything. Today, ' + T + ' is real. Built in labs, tested, and getting better every year. But remember this. Every breakthrough starts clumsy and becomes ordinary. Our descendants may find it adorable that we once doubted this. The future is not far. We are just early.';
}

/* ---------- one-click short ---------- */
$('#oc-build').addEventListener('click', () => {
  const t = $('#oc-topic').value.trim();
  if (!t) { toast('Type a topic first'); return; }
  oneClick(t);
});
$('#oc-topic').addEventListener('keydown', e => { if (e.key === 'Enter') $('#oc-build').click(); });

async function oneClick(topic) {
  const st = $('#oc-status'), btn = $('#oc-build');
  btn.disabled = true;
  try {
    st.textContent = 'Searching NASA, Archive.org and Wikimedia…';
    const [n, a, c] = await Promise.all([
      searchNASA(topic).catch(() => []),
      searchArchive(topic).catch(() => []),
      searchCommons(topic).catch(() => []),
    ]);
    const pool = [];
    [...n, ...a, ...c].forEach(r => {
      if (r.fileUrl && !pool.some(p => p.fileUrl === r.fileUrl)) pool.push(r);
    });
    if (!pool.length) { st.textContent = 'No usable footage for "' + topic + '". Try another term.'; return; }
    const picks = [];
    for (const src of ['nasa', 'archive', 'commons']) {
      const f = pool.find(p => p.source === src && !picks.includes(p));
      if (f) picks.push(f);
      if (picks.length >= 3) break;
    }
    pool.forEach(p => { if (picks.length < 3 && !picks.includes(p)) picks.push(p); });
    st.textContent = 'Drafting script…';
    const script = buildScript($('#tmpl-sel').value, topic);
    const words = script.split(/\s+/).filter(Boolean);
    const per = Math.ceil(words.length / picks.length);
    picks.forEach((r, i) => {
      const chunk = words.slice(i * per, (i + 1) * per).join(' ');
      S.clips.push({
        id: uid(), title: r.title, source: r.source, license: r.license,
        pageUrl: r.pageUrl, fileUrl: r.fileUrl, mediaId: null,
        duration: null, in: 0, out: 20, script: chunk, audioId: null, audioName: null,
      });
    });
    if (!S.metaTitle) S.metaTitle = topic.charAt(0).toUpperCase() + topic.slice(1) + ' — explained in 30 seconds';
    save(true); renderTimeline(); renderVoice(); renderChecklist(); syncMetaUI();
    st.textContent = 'Draft ready: ' + picks.length + ' clips + script. Review in the Timeline, then record your voice.';
    toast('Draft built ✓');
    switchTab('timeline');
  } finally { btn.disabled = false; }
}

/* ---------- voiceover ---------- */
let recState = null;
function renderVoice() {
  const box = $('#voice-list'); box.innerHTML = '';
  $('#voice-empty').style.display = S.clips.length ? 'none' : 'block';
  S.clips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'tclip';
    const hasAudio = !!c.audioId;
    el.innerHTML =
      '<div class="tclip-head"><b>#' + (i+1) + '</b> <span class="ttitle">' + esc(c.title) + '</span>' +
      '<span class="spacer"></span><span class="hint">' + (hasAudio ? '🎙 ' + esc(c.audioName || 'recorded') : 'no audio yet') + '</span></div>' +
      '<div class="tele">' + esc(c.script || '(no script — write one in the Timeline tab)') + '</div>' +
      '<div class="row wrap">' +
      '<button class="primary small rec">' + (hasAudio ? '↻ Re-record' : '⏺ Record') + '</button>' +
      (hasAudio ? '<button class="ghost small play">▶ Play</button><button class="ghost small danger del-audio">✕</button>' : '') +
      '<label class="ghost small file-btn">⤒ Upload audio<input type="file" accept="audio/*" hidden class="up-audio"></label>' +
      '<span class="hint rec-timer"></span></div>';
    const tele = el.querySelector('.tele');
    el.querySelector('.rec').addEventListener('click', async () => {
      if (recState) { stopRec(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        const chunks = [];
        mr.ondataavailable = e => chunks.push(e.data);
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          c.audioId = await idbPut('media', blob);
          c.audioName = 'recorded ' + new Date().toLocaleTimeString();
          save(true); renderVoice(); toast('Take saved ✓');
        };
        mr.start();
        const t0 = Date.now();
        const timerEl = el.querySelector('.rec-timer');
        const btnEl = el.querySelector('.rec');
        btnEl.textContent = '⏹ Stop'; btnEl.classList.add('danger-btn');
        let scrollInt = null;
        if ($('#tele-autoscroll').checked && tele.scrollHeight > tele.clientHeight) {
          scrollInt = setInterval(() => { tele.scrollTop += 1; }, 60);
        }
        const tick = setInterval(() => {
          timerEl.textContent = '● ' + ((Date.now() - t0) / 1000).toFixed(0) + 's — recording… (click Stop)';
        }, 250);
        recState = { mr, tick, scrollInt };
      } catch(e) { toast('Mic blocked — allow microphone access'); }
    });
    const playBtn = el.querySelector('.play');
    if (playBtn) playBtn.addEventListener('click', async () => {
      const b = await idbGet('media', c.audioId);
      if (b) new Audio(URL.createObjectURL(b)).play();
    });
    const delBtn = el.querySelector('.del-audio');
    if (delBtn) delBtn.addEventListener('click', async () => {
      await idbDel('media', c.audioId); c.audioId = null; c.audioName = null;
      save(true); renderVoice();
    });
    el.querySelector('.up-audio').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      c.audioId = await idbPut('media', f); c.audioName = f.name;
      save(true); renderVoice(); toast('Audio attached ✓');
    });
    box.appendChild(el);
  });
}
function stopRec() {
  if (!recState) return;
  clearInterval(recState.tick);
  if (recState.scrollInt) clearInterval(recState.scrollInt);
  recState.mr.stop();
  recState = null;
  $$('#voice-list .rec').forEach(b => { b.textContent = '⏺ Record'; b.classList.remove('danger-btn'); });
  $$('#voice-list .rec-timer').forEach(t => t.textContent = '');
}

/* ---------- style / captions / brand ---------- */
$$('input[name="format"]').forEach(r => r.addEventListener('change', () => { S.format = r.value; save(true); }));
$$('input[name="capstyle"]').forEach(r => r.addEventListener('change', () => { S.captionStyle = r.value; save(true); toast('Caption style: ' + r.value); }));
$('#caps-burn').addEventListener('change', e => { S.capsBurn = e.target.checked; save(true); });
$('#caps-srt').addEventListener('change', e => { S.capsSrt = e.target.checked; save(true); });
$('#music-vol').addEventListener('input', e => { S.musicVol = +e.target.value; $('#music-vol-v').textContent = S.musicVol + '%'; });
$('#music-vol').addEventListener('change', () => save(true));
$('#ov-title').addEventListener('input', e => { S.ovTitle = e.target.value; save(true); });
$('#ov-handle').addEventListener('input', e => { S.ovHandle = e.target.value; S.brand.handle = e.target.value; syncBrandUI(); save(true); });
$('#ov-title-on').addEventListener('change', e => { S.ovTitleOn = e.target.checked; save(true); });
$('#brand-name').addEventListener('input', e => { S.brand.name = e.target.value; save(true); });
$('#brand-handle').addEventListener('input', e => { S.brand.handle = e.target.value; $('#ov-handle').value = e.target.value; S.ovHandle = e.target.value; save(true); });
$('#brand-color').addEventListener('input', e => { S.brand.color = e.target.value; save(true); });
$('#brand-intro').addEventListener('input', e => { S.brand.intro = e.target.value; save(true); });
$('#brand-outro').addEventListener('input', e => { S.brand.outro = e.target.value; save(true); });
function syncBrandUI() {
  $('#brand-name').value = S.brand.name || '';
  $('#brand-handle').value = S.brand.handle || '';
  $('#brand-color').value = S.brand.color || '#00e5a0';
  $('#brand-intro').value = S.brand.intro || '';
  $('#brand-outro').value = S.brand.outro || '';
}
$('#caps-gen').addEventListener('click', () => {
  genCaptions();
  renderCaps(); renderChecklist(); save(true);
  toast('Captions generated ✓');
});
function genCaptions() {
  S.words = [];
  S.captions = [];
  let t = 0;
  S.clips.forEach(c => {
    const dur = Math.max(1, c.out - c.in);
    const words = String(c.script || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) { t += dur; return; }
    const per = dur / words.length;
    words.forEach((w, i) => S.words.push({ start: t + i * per, end: t + (i + 1) * per, text: w }));
    for (let i = 0; i < words.length; i += 6) {
      const chunk = words.slice(i, i + 6);
      S.captions.push({ start: t + i * per, end: Math.min(t + (i + chunk.length) * per, t + dur), text: chunk.join(' ') });
    }
    t += dur;
  });
}
function renderCaps() {
  const box = $('#caps-list'); box.innerHTML = '';
  if (!S.captions.length) { box.innerHTML = '<p class="note">No captions yet — write scripts, then hit Auto-generate.</p>'; return; }
  S.captions.forEach((cp, i) => {
    const el = document.createElement('div');
    el.className = 'cap';
    el.innerHTML =
      '<input class="cs" type="number" step="0.1" min="0" value="' + cp.start.toFixed(1) + '">' +
      '<input class="ce" type="number" step="0.1" min="0" value="' + cp.end.toFixed(1) + '">' +
      '<input class="ct grow" type="text" value="' + esc(cp.text) + '">' +
      '<button class="ghost small danger">✕</button>';
    el.querySelector('.cs').addEventListener('change', e => { cp.start = +e.target.value || 0; save(true); });
    el.querySelector('.ce').addEventListener('change', e => { cp.end = +e.target.value || 0; save(true); });
    el.querySelector('.ct').addEventListener('input', e => { cp.text = e.target.value; save(true); });
    el.querySelector('button').addEventListener('click', () => { S.captions.splice(i, 1); save(true); renderCaps(); });
    box.appendChild(el);
  });
}

/* ---------- render tab: meta + checklist ---------- */
function syncMetaUI() {
  $('#meta-title').value = S.metaTitle || '';
  $('#meta-desc').value = S.metaDesc || '';
  $('#meta-tags').value = S.metaTags || '';
  $('#ov-title').value = S.ovTitle || '';
  $('#ov-handle').value = S.ovHandle || '';
}
$('#meta-title').addEventListener('input', e => { S.metaTitle = e.target.value; save(true); renderChecklist(); });
$('#meta-desc').addEventListener('input', e => { S.metaDesc = e.target.value; save(true); });
$('#meta-tags').addEventListener('input', e => { S.metaTags = e.target.value; save(true); });

function renderChecklist() {
  const items = [
    ['At least one clip added', S.clips.length > 0],
    ['Every clip has a script (narration)', S.clips.length > 0 && S.clips.every(c => String(c.script || '').trim().length > 10)],
    ['Original voiceover recorded or uploaded on every clip', S.clips.length > 0 && S.clips.every(c => c.audioId)],
    ['Captions generated', S.captions.length > 0],
    ['Title written', (S.metaTitle || '').trim().length > 3],
    ['Attribution will be auto-appended to the description', true],
    ['Sources are public-domain or CC (verify licenses!)', S.clips.length > 0],
  ];
  $('#checklist').innerHTML = items.map(([label, ok]) =>
    '<div class="chk ' + (ok ? 'ok' : 'no') + '"><span>' + (ok ? '✓' : '○') + '</span> ' + esc(label) + '</div>').join('');
}

/* ---------- footer / projects ---------- */
$('#save-btn').addEventListener('click', () => save());
$('#reset-btn').addEventListener('click', () => {
  if (!confirm('Reset this project? Clips, scripts and settings will be cleared.')) return;
  S = defaultState(); syncUI(); renderAll(); save(true); toast('Project reset');
});
$('#project-sel').addEventListener('change', e => switchProject(e.target.value));
$('#proj-new').addEventListener('click', newProject);
$('#proj-export').addEventListener('click', exportProject);
$('#proj-import').addEventListener('change', e => { if (e.target.files[0]) importProject(e.target.files[0]); e.target.value = ''; });
function switchProject(id) {
  if (id === projects.active) return;
  save(true);
  projects.active = id; persistProjects();
  loadState(); syncUI(); renderAll(); renderProjBar();
  toast('Project opened');
}
function newProject() {
  const name = prompt('Project name:', 'Untitled project');
  if (!name) return;
  save(true);
  const id = 'p' + Date.now().toString(36);
  projects.list[id] = { name, updated: Date.now() };
  projects.active = id; persistProjects();
  S = defaultState(); syncUI(); renderAll(); renderProjBar();
  toast('New project ✓');
}
function exportProject() {
  const name = projects.list[projects.active].name;
  downloadBlob(new Blob([JSON.stringify({ app: 'clipforge', v: 2, name, state: S }, null, 1)], { type: 'application/json' }),
    name.replace(/[^\w\-]+/g, '-').toLowerCase() + '.clipforge.json');
  toast('Project exported');
}
function importProject(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== 'clipforge' || !d.state) throw new Error('bad file');
      save(true);
      const id = 'p' + Date.now().toString(36);
      projects.list[id] = { name: d.name || 'Imported project', updated: Date.now() };
      projects.active = id; persistProjects();
      S = Object.assign(defaultState(), d.state);
      syncUI(); renderAll(); renderProjBar();
      toast('Project imported ✓');
    } catch(e) { toast('That file is not a ClipForge project'); }
  };
  r.readAsText(file);
}

/* ---------- IndexedDB ---------- */
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('clipforge', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('media');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbPut(store, blob) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const id = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    tx.objectStore(store).put(blob, id);
    tx.oncomplete = () => res(id); tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(store, id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(store).objectStore(store).get(id);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function idbDel(store, id) {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- boot ---------- */
function syncUI() {
  $$('input[name="format"]').forEach(r => r.checked = r.value === S.format);
  $$('input[name="capstyle"]').forEach(r => r.checked = r.value === (S.captionStyle || 'karaoke'));
  $('#caps-burn').checked = !!S.capsBurn;
  $('#caps-srt').checked = !!S.capsSrt;
  $('#music-vol').value = S.musicVol; $('#music-vol-v').textContent = S.musicVol + '%';
  $('#ov-title-on').checked = !!S.ovTitleOn;
  syncMetaUI(); syncBrandUI();
  if (S.musicId) idbGet('media', S.musicId).then(b => { if (b) $('#music-name').textContent = 'Music attached ✓ (' + (b.size/1048576).toFixed(1) + ' MB)'; });
  else $('#music-name').textContent = 'No music selected.';
}
function renderAll() { renderTimeline(); renderVoice(); renderCaps(); renderChecklist(); }
loadProjects();
loadState();
syncUI();
renderAll();
renderProjBar();
