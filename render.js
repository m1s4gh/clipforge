/* ClipForge Studio v1 — render.js : ffmpeg.wasm local render pipeline */
'use strict';

const FF_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';
const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf',
];
let ff = null, ffLoaded = false;

const logEl = () => $('#render-log');
function rlog(m) { const el = logEl(); el.classList.remove('hidden'); el.textContent += m + '\n'; el.scrollTop = el.scrollHeight; }
function rstatus(m) { $('#render-status').textContent = m; }
function rprog(pct, phase) {
  $('#progress').classList.remove('hidden');
  $('#progress-bar').style.width = Math.min(100, Math.max(0, pct)) + '%';
  if (phase) rstatus(phase);
}

async function ensureFF() {
  if (ffLoaded) return ff;
  const { createFFmpeg } = FFmpeg;
  ff = createFFmpeg({ corePath: FF_CORE, log: false });
  ff.setLogger(({ message }) => { if (/error|fail/i.test(message)) rlog('[ffmpeg] ' + message); });
  rstatus('Loading video engine (first run downloads ~25MB)…');
  await ff.load();
  ffLoaded = true;
  return ff;
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed HTTP ' + r.status);
  return new Blob([await r.arrayBuffer()]);
}
function extOf(url, blob) {
  const m = (url || '').match(/\.([a-z0-9]{2,4})(\?|$)/i);
  if (m) return m[1].toLowerCase();
  const t = (blob && blob.type) || '';
  if (/webm/.test(t)) return 'webm';
  if (/mp4/.test(t)) return 'mp4';
  if (/mov|quicktime/.test(t)) return 'mov';
  if (/mpeg/.test(t)) return 'mp3';
  if (/wav/.test(t)) return 'wav';
  return 'bin';
}
const escDt = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\n/g, ' ');

async function loadFont(ffmpeg) {
  for (const u of FONT_URLS) {
    try {
      const b = await fetchBytes(u);
      ffmpeg.FS('writeFile', '/font.ttf', await FFmpeg.fetchFile(b));
      rlog('font loaded');
      return true;
    } catch(e) { rlog('font failed: ' + u); }
  }
  return false;
}

$('#render-btn').addEventListener('click', async () => {
  const clips = S.clips.filter(c => !c.refOnly);
  if (!clips.length) { alert('Add at least one footage clip first.'); return; }
  const btn = $('#render-btn');
  btn.disabled = true;
  $('#outputs').classList.add('hidden');
  logEl().textContent = ''; logEl().classList.remove('hidden');
  try {
    const W = S.format === 'short' ? 1080 : 1920;
    const H = S.format === 'short' ? 1920 : 1080;
    const ffmpeg = await ensureFF();
    const { fetchFile } = FFmpeg;
    const durs = clips.map(c => Math.max(0.5, c.out - c.in));
    const total = durs.reduce((a, b) => a + b, 0);

    /* ---- 1. per-clip video segments ---- */
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], dur = durs[i];
      rprog((i / clips.length) * 40, 'Processing clip ' + (i+1) + '/' + clips.length + '…');
      let blob, url = null;
      if (c.kind === 'upload') { blob = await idb.get('file:' + c.id); if (!blob) throw new Error('missing upload: ' + c.name); }
      else { rlog('fetch ' + c.fileUrl); blob = await fetchBytes(c.fileUrl); url = c.fileUrl; }
      const ext = extOf(url, blob);
      ffmpeg.FS('writeFile', 'src' + i + '.' + ext, await fetchFile(blob));
      await ffmpeg.run('-ss', String(c.in), '-t', String(dur), '-i', 'src' + i + '.' + ext,
        '-vf', 'scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', 'seg' + i + '.mp4');
      ffmpeg.FS('unlink', 'src' + i + '.' + ext);

      /* voice or silence, padded to segment length */
      if (c.voiceId) {
        const vb = await idb.get('voice:' + c.voiceId);
        if (!vb) throw new Error('missing voiceover for clip ' + (i+1));
        const vext = extOf('', vb);
        ffmpeg.FS('writeFile', 'v' + i + '.' + vext, await fetchFile(vb));
        await ffmpeg.run('-i', 'v' + i + '.' + vext, '-t', String(dur), '-af', 'apad,atrim=0:' + dur, '-c:a', 'pcm_s16le', 'va' + i + '.wav');
        ffmpeg.FS('unlink', 'v' + i + '.' + vext);
      } else {
        await ffmpeg.run('-f', 'lavfi', '-i', 'aevalsrc=0:d=' + dur, '-c:a', 'pcm_s16le', 'va' + i + '.wav');
      }
      rlog('clip ' + (i+1) + ' ok (' + dur.toFixed(1) + 's)');
    }

    /* ---- 2. concat video + voice ---- */
    rprog(45, 'Joining clips…');
    ffmpeg.FS('writeFile', 'vlist.txt', clips.map((_, i) => "file 'seg" + i + ".mp4'").join('\n'));
    ffmpeg.FS('writeFile', 'alist.txt', clips.map((_, i) => "file 'va" + i + ".wav'").join('\n'));
    await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'vlist.txt', '-c', 'copy', 'v.mp4');
    await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'alist.txt', '-c:a', 'pcm_s16le', 'voice.wav');

    /* ---- 3. music bed ---- */
    rprog(55, 'Mixing audio…');
    let mixIn = 'voice.wav';
    if (S.musicId) {
      const mb = await idb.get('music:' + S.musicId);
      if (mb) {
        const mext = extOf('', mb);
        ffmpeg.FS('writeFile', 'mus.' + mext, await fetchFile(mb));
        await ffmpeg.run('-i', 'voice.wav', '-stream_loop', '-1', '-i', 'mus.' + mext, '-t', String(total),
          '-filter_complex', '[1:a]volume=' + (S.musicVol/100).toFixed(2) + '[m];[0:a][m]amix=inputs=2:duration=longest[a]',
          '-map', '[a]', '-c:a', 'aac', 'mix.m4a');
        ffmpeg.FS('unlink', 'mus.' + mext);
        mixIn = 'mix.m4a';
      }
    } else {
      await ffmpeg.run('-i', 'voice.wav', '-c:a', 'aac', 'mix.m4a');
    }
    await ffmpeg.run('-i', 'v.mp4', '-i', mixIn, '-c:v', 'copy', '-c:a', 'copy', '-shortest', 'pre.mp4');

    /* ---- 4. captions + overlays (best effort) ---- */
    rprog(75, 'Adding captions & overlays…');
    let final = 'pre.mp4';
    const hasFont = await loadFont(ffmpeg);
    const vf = [];
    if (hasFont && S.capsBurn && S.captions.length) {
      ffmpeg.FS('writeFile', 'caps.ass', buildASS(W, H));
      vf.push("subtitles=caps.ass:fontsdir='/'");
    }
    if (hasFont && S.ovTitleOn && S.ovTitle.trim()) {
      const fs = W === 1080 ? 84 : 64;
      vf.push("drawtext=fontfile=/font.ttf:text='" + escDt(S.ovTitle.trim()) + "':fontsize=" + fs +
        ":fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=" + (W === 1080 ? 200 : 130) + ":enable='between(t,0,4)'");
    }
    if (hasFont && S.ovHandle.trim()) {
      vf.push("drawtext=fontfile=/font.ttf:text='" + escDt(S.ovHandle.trim()) + "':fontsize=" + (W === 1080 ? 44 : 36) +
        ":fontcolor=white:borderw=1:bordercolor=black:x=w-text_w-40:y=h-110");
    }
    if (vf.length) {
      try {
        await ffmpeg.run('-i', 'pre.mp4', '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'copy', 'out.mp4');
        final = 'out.mp4';
        rlog('burn-in ok');
      } catch(e) { rlog('burn-in failed, using clean render: ' + e.message); }
    }

    /* ---- 5. deliver ---- */
    rprog(95, 'Finishing…');
    const data = ffmpeg.FS('readFile', final);
    const outBlob = new Blob([data.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(outBlob);
    const ov = $('#out-video'); ov.src = url;
    $('#outputs').classList.remove('hidden');
    $('#dl-video').onclick = () => download(outBlob, 'clipforge-' + Date.now() + '.mp4');
    rprog(100, 'Done ✓');
    rlog('render complete: ' + (outBlob.size/1048576).toFixed(1) + ' MB, ' + total.toFixed(1) + 's');

    /* cleanup FS */
    try {
      [...Array(clips.length).keys()].forEach(i => { ffmpeg.FS('unlink', 'seg' + i + '.mp4'); ffmpeg.FS('unlink', 'va' + i + '.wav'); });
      ['vlist.txt','alist.txt','v.mp4','voice.wav','mix.m4a','pre.mp4','out.mp4','caps.ass','/font.ttf'].forEach(f => { try { ffmpeg.FS('unlink', f); } catch(e){} });
    } catch(e){}
    renderChecklist();
  } catch(e) {
    rlog('RENDER FAILED: ' + (e.message || e));
    rstatus('Render failed — see log.');
  }
  btn.disabled = false;
});

/* export buttons */
$('#dl-srt').addEventListener('click', () => {
  if (!S.captions.length) { alert('Generate captions first.'); return; }
  download(new Blob([buildSRT()], { type: 'text/plain' }), 'captions.srt');
});
$('#dl-plan').addEventListener('click', () => download(new Blob([buildEditPlan()], { type: 'application/json' }), 'edit-plan.json'));
$('#dl-meta').addEventListener('click', () => download(new Blob([buildMetaPack()], { type: 'text/plain' }), 'youtube-details.txt'));

/* footer */
$('#save-btn').addEventListener('click', () => { save(); alert('Project saved in this browser.'); });
$('#reset-btn').addEventListener('click', () => {
  if (confirm('Reset the whole project? Recordings and uploads in this browser will be kept, but the timeline will clear.')) {
    S = { ...S, clips: [], captions: [], title: '' }; save(); location.reload();
  }
});

/* init */
load(); restoreUI(); renderCaps();
