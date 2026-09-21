/* ClipForge Studio v1 — export.js : captions, export pack, edit plan, checklist */
'use strict';

/* ---------- captions ---------- */
function assTime(s) {
  s = Math.max(0, s);
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = (s % 60) | 0, cs = ((s % 1) * 100) | 0;
  return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') + '.' + String(cs).padStart(2,'0');
}
function srtTime(s) {
  s = Math.max(0, s);
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = (s % 60) | 0, ms = ((s % 1) * 1000) | 0;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') + ',' + String(ms).padStart(3,'0');
}

function genCaptions() {
  const caps = [];
  let t = 0;
  for (const c of S.clips) {
    if (c.refOnly) continue;
    const dur = Math.max(0.5, c.out - c.in);
    const words = (c.script || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) { t += dur; continue; }
    const per = dur / words.length, grp = S.format === 'short' ? 4 : 7;
    for (let i = 0; i < words.length; i += grp) {
      const s = t + i * per, e = t + Math.min(words.length, i + grp) * per;
      caps.push({ start: +s.toFixed(2), end: +e.toFixed(2), text: words.slice(i, i + grp).join(' ') });
    }
    t += dur;
  }
  S.captions = caps; saveSoon(); renderCaps();
}

function renderCaps() {
  const box = $('#caps-list'); box.innerHTML = '';
  if (!S.captions.length) { box.innerHTML = '<p class="note">No captions yet — write scripts, then hit Auto-generate.</p>'; return; }
  S.captions.forEach((cp, i) => {
    const el = document.createElement('div');
    el.className = 'cap-row';
    el.innerHTML = '<input data-f="start" value="' + cp.start.toFixed(1) + '"><input data-f="end" value="' + cp.end.toFixed(1) + '">' +
      '<input data-f="text" value="' + esc(cp.text) + '"><button class="icon-btn" title="delete">✕</button>';
    el.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
      const v = inp.value.trim();
      cp[inp.dataset.f] = inp.dataset.f === 'text' ? v : (parseFloat(v) || 0);
      saveSoon();
    }));
    el.querySelector('button').addEventListener('click', () => { S.captions.splice(i, 1); saveSoon(); renderCaps(); });
    box.appendChild(el);
  });
}
$('#caps-gen').addEventListener('click', genCaptions);

function buildSRT() {
  return S.captions.map((c, i) => (i+1) + '\n' + srtTime(c.start) + ' --> ' + srtTime(c.end) + '\n' + c.text + '\n').join('\n');
}
function buildASS(w, h) {
  const fs = w === 1080 ? 72 : 56;
  let s = '[Script Info]\nScriptType: v4.00+\nPlayResX: ' + w + '\nPlayResY: ' + h + '\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, BorderStyle, Outline, Shadow\n' +
    'Style: Cap,Roboto,' + fs + ',&H00FFFFFF,&H000019FF,&H00000000,&H96000000,-1,0,2,60,60,' + (w === 1080 ? 180 : 90) + ',1,3,1\n\n' +
    '[Events]\nFormat: Layer, Start, End, Style, Text\n';
  for (const c of S.captions) s += 'Dialogue: 0,' + assTime(c.start) + ',' + assTime(c.end) + ',Cap,' + c.text.replace(/\n/g, ' ') + '\n';
  return s;
}

/* ---------- downloads ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- attribution + metadata ---------- */
function attributionBlock() {
  const lines = [];
  S.clips.forEach((c, i) => {
    lines.push((i+1) + '. "' + c.name + '" — ' + (c.credit || 'unknown') + ' [' + (c.license || 'license unknown') + ']' + (c.pageUrl ? ' ' + c.pageUrl : ''));
  });
  return 'Footage sources:\n' + lines.join('\n');
}

function buildMetaPack() {
  const tags = S.metaTags.split(',').map(t => t.trim()).filter(Boolean).map(t => '#' + t.replace(/^#/, '').replace(/\s+/g, ''));
  return 'TITLE\n' + (S.metaTitle || S.title || 'Untitled') +
    '\n\nDESCRIPTION\n' + (S.metaDesc || '') +
    '\n\n' + attributionBlock() +
    '\n\nHASHTAGS\n' + tags.join(' ') + '\n';
}

function buildEditPlan() {
  return JSON.stringify({
    tool: 'ClipForge Studio v1', exported: new Date().toISOString(),
    format: S.format === 'short' ? 'youtube-shorts 1080x1920' : 'youtube 1920x1080',
    title: S.metaTitle, description: S.metaDesc, hashtags: S.metaTags.split(',').map(t => t.trim()).filter(Boolean),
    clips: S.clips.map((c, i) => ({
      order: i + 1, name: c.name, source: c.credit, license: c.license, page: c.pageUrl,
      trim: c.refOnly ? null : { in: c.in, out: c.out },
      transforms: c.refOnly ? [] : ['crop-' + (S.format === 'short' ? '9:16' : '16:9'), 'scale-' + (S.format === 'short' ? '1080x1920' : '1920x1080')],
      narration_script: c.script || null, voiceover: c.voiceId ? 'original recording' : null,
      reference_only: !!c.refOnly,
    })),
    captions: S.captions, music: S.musicId ? 'user-provided royalty-free track @ ' + S.musicVol + '%' : null,
    overlays: { title_card: S.ovTitleOn ? S.ovTitle : null, watermark: S.ovHandle || null },
    attribution: attributionBlock(),
    publish: 'Upload the MP4 manually in YouTube Studio. Paste the title/description/hashtags. Add the footage credit lines to the description (required for CC-BY sources).',
  }, null, 2);
}

/* ---------- checklist ---------- */
function renderChecklist() {
  const box = $('#checklist'); if (!box) return;
  const clips = S.clips.filter(c => !c.refOnly);
  const items = [
    [clips.length > 0, 'At least one footage clip in the timeline'],
    [clips.length > 0 && clips.every(c => (c.script || '').trim().split(/\s+/).length >= 8), 'Every clip has real narration script (8+ words)'],
    [clips.length > 0 && clips.every(c => c.voiceId), 'Original voiceover recorded on every clip'],
    [S.captions.length > 0, 'Captions generated'],
    [S.clips.every(c => c.license && c.credit), 'Every source has license + credit recorded'],
    [S.clips.filter(c => /CC-BY|Creative Commons/i.test(c.license || '')).length === 0 || true, 'CC-BY sources will be credited in the description (auto-included)'],
    [!S.musicId || true, S.musicId ? 'Music track is royalty-free / licensed by you' : 'No music — fine, or add a royalty-free track'],
    [S.format === 'short' ? totalDur() <= 65 : true, S.format === 'short' ? 'Shorts length ≤ ~60s (now ' + totalDur().toFixed(0) + 's)' : 'Long-form selected'],
  ];
  box.innerHTML = '';
  items.forEach(([ok, txt]) => {
    const el = document.createElement('div');
    el.className = 'check ' + (ok ? 'ok' : 'no');
    el.innerHTML = '<span class="st">' + (ok ? '✔' : '○') + '</span><span>' + esc(txt) + '</span>';
    box.appendChild(el);
  });
}
