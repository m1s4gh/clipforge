/* ClipForge Studio v2 — export.js : captions, export pack, edit plan */
function srtT(s) {
  s = Math.max(0, s);
  const h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = Math.floor(s%60), ms = Math.floor((s%1)*1000);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') + ',' + String(ms).padStart(3,'0');
}
function buildSRT(captions) {
  return captions.map((c, i) => (i+1) + '\n' + srtT(c.start) + ' --> ' + srtT(c.end) + '\n' + c.text + '\n').join('\n');
}
function attributionBlock(clips) {
  const lines = ['—', 'Footage sources (verify licenses before publishing):'];
  clips.forEach((c, i) => {
    lines.push((i+1) + '. "' + c.title + '" — ' + c.source + ' (' + c.license + ')' + (c.pageUrl ? ' ' + c.pageUrl : ''));
  });
  return lines.join('\n');
}
function buildMetadata(S) {
  const tags = (S.metaTags || '').split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
  const srcs = (S.sources || '').trim();
  const desc = (S.metaDesc || '').trim() + '\n\n' + attributionBlock(S.clips) +
    (srcs ? '\n\nSources & further reading:\n' + srcs : '');
  return { title: S.metaTitle || 'Untitled', description: desc.trim(), hashtags: tags.map(t => '#' + t.replace(/\s+/g, '')).join(' ') };
}
function buildEditPlan(S) {
  return {
    app: 'clipforge', version: 2, exportedAt: new Date().toISOString(),
    format: S.format === 'short' ? '1080x1920 (9:16)' : '1920x1080 (16:9)',
    captionStyle: S.captionStyle || 'karaoke',
    brand: S.brand || {},
    title: S.metaTitle, description: S.metaDesc, hashtags: (S.metaTags || '').split(',').map(t => t.trim()).filter(Boolean),
    music: S.musicId ? { volume: S.musicVol + '%' } : null,
    overlays: { title: S.ovTitleOn ? S.ovTitle : null, watermark: S.ovHandle || (S.brand && S.brand.handle) || null },
    clips: S.clips.map((c, i) => ({
      order: i + 1, title: c.title, source: c.source, license: c.license,
      pageUrl: c.pageUrl, file: c.fileUrl || '(uploaded file)',
      in: c.in, out: c.out, duration: +(c.out - c.in).toFixed(1),
      script: c.script, voiceover: c.audioId ? 'recorded (' + (c.audioName || 'audio') + ')' : 'MISSING — record before publishing',
      captions: S.captions.filter(() => true).length ? 'see .srt' : 'none',
    })),
    originalityChecklist: [
      'Original human narration on every clip (not just music/captions)',
      'Educational commentary or new insight added — not a re-upload',
      'Title, description and thumbnail are original',
      'Sources attributed in the description',
      'Calm, evidence-based tone — explains mechanisms, never conspiracies',
    ],
    sources: (S.sources || '').split('\n').map(s => s.trim()).filter(Boolean),
    policyGuard: {
      autoFlags: (typeof scanGuard === 'function' ? scanGuard() : []).map(([l, m]) => l + ': ' + m),
      manualConfirmations: S.guard || {},
    },
  };
}

$('#render-btn').addEventListener('click', async () => {
  if (!S.clips.length) { toast('Add clips first'); return; }
  const btn = $('#render-btn'), bar = $('#progress'), pbar = $('#progress-bar'),
        status = $('#render-status'), logEl = $('#render-log');
  btn.disabled = true; bar.classList.remove('hidden'); logEl.classList.add('hidden');
  const setP = (f, msg) => { pbar.style.width = Math.round(f * 100) + '%'; status.textContent = msg || ''; };
  try {
    setP(0.02, 'Loading ffmpeg (~25 MB first time)…');
    const ffmpeg = await ensureFFmpeg(m => {
      logEl.textContent += m + '\n';
      if (/time=/.test(m)) { const t = m.match(/time=(\d+):(\d+):([\d.]+)/); if (t) status.textContent = 'Rendering… ' + t[1] + ':' + t[2] + ':' + t[3]; }
    });
    const { blob } = await renderVideo(ffmpeg, S, setP);
    const url = URL.createObjectURL(blob);
    $('#out-video').src = url;
    $('#outputs').classList.remove('hidden');
    window._outBlob = blob; window._outUrl = url;
    $('#dl-video').onclick = () => downloadBlob(blob, 'clipforge-' + Date.now() + '.mp4');
    setP(1, 'Done — preview above, then download.');
    logEl.classList.remove('hidden');
    toast('Render complete ✓');
  } catch (e) {
    status.textContent = 'Render failed: ' + e.message;
    logEl.classList.remove('hidden');
    logEl.textContent += '\nERROR: ' + (e.stack || e.message);
    toast('Render failed — see log');
  } finally { btn.disabled = false; }
});

$('#dl-srt').addEventListener('click', () => {
  if (!S.captions.length || !S.capsSrt) { toast('Generate captions first'); return; }
  downloadBlob(new Blob([buildSRT(S.captions)], { type: 'text/plain' }), 'clipforge-captions.srt');
});
$('#dl-plan').addEventListener('click', () => {
  downloadBlob(new Blob([JSON.stringify(buildEditPlan(S), null, 2)], { type: 'application/json' }), 'clipforge-edit-plan.json');
});
$('#dl-meta').addEventListener('click', () => {
  const m = buildMetadata(S);
  const txt = 'TITLE\n' + m.title + '\n\nDESCRIPTION\n' + m.description + '\n\nHASHTAGS\n' + m.hashtags + '\n';
  downloadBlob(new Blob([txt], { type: 'text/plain' }), 'clipforge-youtube-meta.txt');
});
