/* ClipForge Studio v2 — render.js : ffmpeg.wasm local render pipeline.
   Karaoke captions, brand intro/outro cards, channel presets. */
async function ensureFFmpeg(onLog) {
  if (window._ff && window._ff.loaded) return window._ff;
  const { createFFmpeg, fetchFile } = FFmpeg;
  const ffmpeg = createFFmpeg({ log: false });
  ffmpeg.setLogger(({ message }) => onLog && onLog(message));
  await ffmpeg.load();
  ffmpeg.loaded = true;
  window._ff = ffmpeg; window._fetchFile = fetchFile;
  return ffmpeg;
}
function escDt(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\n/g, ' ');
}
async function ensureFont(ffmpeg) {
  try { ffmpeg.FS('stat', '/font.ttf'); return; } catch(e) {}
  const res = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.8/files/roboto-latin-700-normal.woff');
  const buf = new Uint8Array(await res.arrayBuffer());
  ffmpeg.FS('writeFile', '/font.ttf', buf);
}
function assT(s) {
  s = Math.max(0, s);
  const h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = Math.floor(s%60), cs = Math.floor((s%1)*100);
  return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') + '.' + String(cs).padStart(2,'0');
}
function assEsc(t) { return String(t).replace(/\{/g, '（').replace(/\}/g, '）'); }
function hexToAss(hex) {
  const h = String(hex || '#00e5a0').replace('#', '');
  if (h.length !== 6) return '&H0000E5A0';
  return '&H00' + h.slice(4,6) + h.slice(2,4) + h.slice(0,2);
}
function assHeader() {
  return '[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
}
/* Classic bottom captions */
function buildClassicASS(captions, W, H) {
  const fs = W === 1080 ? 72 : 54, mv = W === 1080 ? 220 : 120;
  let s = assHeader() +
    'Style: Cap,Roboto,' + fs + ',&H00FFFFFF,&H000019FF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,40,40,' + mv + ',1\n\n[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  captions.forEach(c => {
    s += 'Dialogue: 0,' + assT(c.start) + ',' + assT(c.end) + ',Cap,,0,0,0,,' + assEsc(c.text) + '\n';
  });
  return s;
}
/* Karaoke word-by-word highlight */
function buildKaraokeASS(words, W, H, color) {
  const fs = W === 1080 ? 88 : 66, mv = W === 1080 ? 320 : 170;
  let s = assHeader() +
    'Style: Karaoke,Roboto,' + fs + ',&H00FFFFFF,' + hexToAss(color) + ',&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,50,50,' + mv + ',1\n\n[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  for (let i = 0; i < words.length; i += 4) {
    const line = words.slice(i, i + 4);
    const txt = line.map(w => '{\\kf' + Math.max(1, Math.round((w.end - w.start) * 100)) + '}' + assEsc(w.text)).join(' ');
    s += 'Dialogue: 0,' + assT(line[0].start) + ',' + assT(line[line.length-1].end) + ',Karaoke,,0,0,0,,' + txt + '\n';
  }
  return s;
}
async function makeCard(ffmpeg, text, W, H, color, outName) {
  const fs = W === 1080 ? 76 : 62;
  await ffmpeg.run(
    '-f', 'lavfi', '-i', 'color=c=0x0b0e14:s=' + W + 'x' + H + ':d=2.5:r=30',
    '-vf', 'drawtext=fontfile=/font.ttf:text=\'' + escDt(text) + '\':fontsize=' + fs + ':fontcolor=' + color + ':x=(w-text_w)/2:y=(h-text_h)/2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', outName
  );
}

async function renderVideo(ffmpeg, S, onProgress) {
  const W = S.format === 'short' ? 1080 : 1920;
  const H = S.format === 'short' ? 1920 : 1080;
  const brand = S.brand || {};
  const brandColor = brand.color || '#00e5a0';
  await ensureFont(ffmpeg);
  const fetchFile = window._fetchFile;
  const log = [];
  const segs = [];
  let totalDur = 0;

  // 1) per-clip segments
  for (let i = 0; i < S.clips.length; i++) {
    const c = S.clips[i];
    const dur = Math.max(0.5, c.out - c.in);
    let src;
    if (c.fileUrl) { await ffmpeg.FS('writeFile', 'src' + i, await fetchFile(c.fileUrl)); src = 'src' + i; }
    else if (c.mediaId) {
      const blob = await idbGet('media', c.mediaId);
      await ffmpeg.FS('writeFile', 'src' + i, await fetchFile(blob));
      src = 'src' + i;
    } else continue;
    const out = 'seg' + i + '.mp4';
    await ffmpeg.run(
      '-ss', String(c.in), '-t', String(dur), '-i', src,
      '-vf', 'scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H + ',setsar=1,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', out
    );
    segs.push({ file: out, dur });
    totalDur += dur;
    onProgress && onProgress((i + 1) / (S.clips.length + 3) * 0.6, 'Cut clip ' + (i + 1) + '/' + S.clips.length);
  }
  if (!segs.length) throw new Error('No renderable clips.');

  // 2) brand intro / outro cards
  const INTRO_D = brand.intro && brand.intro.trim() ? 2.5 : 0;
  const OUTRO_D = brand.outro && brand.outro.trim() ? 2.5 : 0;
  const parts = [];
  if (INTRO_D) {
    const label = (brand.name ? brand.name + '  ·  ' : '') + brand.intro.trim();
    await makeCard(ffmpeg, label, W, H, brandColor, 'intro.mp4');
    parts.push('intro.mp4');
    onProgress && onProgress(0.65, 'Intro card…');
  }
  segs.forEach(sg => parts.push(sg.file));
  if (OUTRO_D) {
    const label = brand.outro.trim() + (brand.handle ? '  ·  ' + brand.handle : '');
    await makeCard(ffmpeg, label, W, H, brandColor, 'outro.mp4');
    parts.push('outro.mp4');
  }
  const listTxt = parts.map(p => "file '" + p + "'").join('\n');
  await ffmpeg.FS('writeFile', 'list.txt', new TextEncoder().encode(listTxt));
  await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'joined.mp4');
  onProgress && onProgress(0.7, 'Assembling…');

  // 3) voiceover (delayed past intro)
  let hasVoice = false;
  const vpieces = [];
  let voff = 0;
  for (let i = 0; i < S.clips.length; i++) {
    const c = S.clips[i];
    const dur = Math.max(0.5, c.out - c.in);
    if (c.audioId) {
      const blob = await idbGet('media', c.audioId);
      await ffmpeg.FS('writeFile', 'va' + i, await fetchFile(blob));
      vpieces.push({ file: 'va' + i, off: voff });
      hasVoice = true;
    }
    voff += dur;
  }
  if (hasVoice) {
    const fparts = vpieces.map((p, k) => '[' + k + ':a]adelay=' + Math.round(p.off * 1000) + '|0[a' + k + ']');
    const amix = vpieces.map((p, k) => '[a' + k + ']').join('') + 'amix=inputs=' + vpieces.length + ':normalize=0[voice]';
    const inputs = [];
    vpieces.forEach(p => inputs.push('-i', p.file));
    const delayMs = Math.round(INTRO_D * 1000);
    const af = delayMs > 0
      ? fparts.join(';') + ';' + amix + ';[voice]adelay=' + delayMs + '|' + delayMs + '[vout]'
      : fparts.join(';') + ';' + amix + '[vout]';
    await ffmpeg.run(...inputs, '-filter_complex', af, '-map', '[vout]', '-c:a', 'aac', '-b:a', '128k', 'voice_full.m4a');
  }

  // 4) music bed
  let hasMusic = false;
  if (S.musicId) {
    try {
      const blob = await idbGet('media', S.musicId);
      await ffmpeg.FS('writeFile', 'music', await fetchFile(blob));
      hasMusic = true;
    } catch(e) {}
  }

  // 5) final mix + burn-ins
  const assName = 'caps.ass';
  const style = S.captionStyle || 'karaoke';
  const words = (S.words && S.words.length ? S.words : []).map(w => ({ start: w.start + INTRO_D, end: w.end + INTRO_D, text: w.text }));
  const caps = (S.captions || []).map(c => ({ start: c.start + INTRO_D, end: c.end + INTRO_D, text: c.text }));
  let assText = null;
  if (S.capsBurn && (words.length || caps.length)) {
    assText = (style === 'karaoke' && words.length)
      ? buildKaraokeASS(words, W, H, brandColor)
      : buildClassicASS(caps, W, H, brandColor);
    await ffmpeg.FS('writeFile', assName, new TextEncoder().encode(assText));
  }
  let vf = 'null';
  if (assText) vf = "ass='" + assName + "'";
  const overlays = [];
  if (S.ovTitleOn && S.ovTitle) {
    const fs = W === 1080 ? 64 : 52;
    overlays.push('drawtext=fontfile=/font.ttf:text=\'' + escDt(S.ovTitle) + '\':fontsize=' + fs +
      ':fontcolor=white:borderw=2:bordercolor=black@0.6:x=(w-text_w)/2:y=120:enable=\'lt(t,4)\'');
  }
  if (S.ovHandle || brand.handle) {
    const fs = W === 1080 ? 40 : 32;
    overlays.push('drawtext=fontfile=/font.ttf:text=\'' + escDt(S.ovHandle || brand.handle) + '\':fontsize=' + fs +
      ':fontcolor=white@0.85:borderw=1:bordercolor=black@0.5:x=w-text_w-40:y=h-text_h-60');
  }
  if (overlays.length) vf = vf === 'null' ? overlays.join(',') : vf + ',' + overlays.join(',');

  const fin = ['-i', 'joined.mp4'];
  const maps = ['-map', '0:v'];
  let afilter = null;
  if (hasVoice && hasMusic) {
    fin.push('-i', 'voice_full.m4a', '-i', 'music');
    maps.push('-map', '1:a', '-map', '2:a');
    const mv = (S.musicVol / 100).toFixed(2);
    afilter = '[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo[va];[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=' + mv + '[mu];[va][mu]amix=inputs=2:duration=longest:normalize=0[aout]';
    maps.push('-map', '[aout]');
  } else if (hasVoice) {
    fin.push('-i', 'voice_full.m4a');
    maps.push('-map', '1:a');
  } else if (hasMusic) {
    fin.push('-i', 'music');
    maps.push('-map', '1:a');
    const mv = (S.musicVol / 100).toFixed(2);
    afilter = '[1:a]volume=' + mv + '[aout]';
    maps.push('-map', '[aout]');
  }
  const args = [...fin, '-vf', vf, ...maps];
  if (afilter) args.push('-filter_complex', afilter);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', 'final.mp4');
  onProgress && onProgress(0.8, 'Burning captions & mixing…');
  await ffmpeg.run(...args);
  onProgress && onProgress(1, 'Done');
  const data = ffmpeg.FS('readFile', 'final.mp4');
  return { blob: new Blob([data.buffer], { type: 'video/mp4' }), log };
}
