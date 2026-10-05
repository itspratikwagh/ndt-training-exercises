/* EPOCH 650-style flaw detector trainer
 * Shared engine for the UT Level I Epoch lessons: instrument model, front-panel
 * renderer, step-block view, guided-lesson runner and scripted lesson video.
 * Units: inches and microseconds. Each lesson page calls Epoch650.page({...}).
 */
(function () {
  'use strict';

  // ================= Physics =================
  const TRUE_V = 0.2320;          // steel longitudinal velocity of the "real" block, inch/µs
  const T0 = 0.50;                // probe delay: wear plate + couplant, µs
  const STEPS = [0.100, 0.200, 0.300, 0.400, 0.500];

  const DEFAULTS = {
    gain: 40.0, vel: 0.2300, zero: 0.000, range: 1.000, delay: 0.000,
    g1: { start: 0.300, width: 0.150, level: 40 }
  };

  function echoes(st) {
    const g = Math.pow(10, (st.gain - 40) / 20);
    const list = [{ t: 0, pct: 160 * Math.max(g, 0.35), w: 0.32, ip: true, n: 0 }];
    const th = st.frozen ? st.frozen.probe : st.probe;
    if (th != null) {
      const base = 62 * (1 - 0.1 * th), r = 1 - 0.28 * Math.sqrt(th / 0.5);
      for (let n = 1; n <= 60; n++) {
        const a = base * Math.pow(r, n - 1);
        if (a < 0.6) break;
        list.push({ t: T0 + 2 * n * th / TRUE_V, pct: a * g, w: 0.24, n });
      }
    }
    return list;
  }
  const sOf = (st, t) => st.vel * (t - st.zero) / 2;           // screen distance (in) of a raw time
  function inGate(st) { const e = echoes(st); return e.filter(x => { const s = sOf(st, x.t); return s >= st.g1.start - 1e-6 && s <= st.g1.start + st.g1.width + 1e-6; }); }
  function gateHit(st) {                                          // first echo that breaks the gate level
    for (const e of inGate(st)) if (e.pct >= st.g1.level) return { e, s: sOf(st, e.t) };
    return null;
  }
  function gateMax(st) { let b = null; for (const e of inGate(st)) if (!b || e.pct > b.pct) b = e; return b; }
  function reading(st) { const h = gateHit(st); return h ? h.s : null; }

  // ================= Instrument model =================
  const GROUPS = [
    ['Basic', 'Pulser', 'Receiver', 'Trig', 'Display'],
    ['Gate 1', 'Gate 2', 'Auto Cal', 'Meas Setup', 'Alarms'],
    ['File', 'Setup', 'Config', 'Info', 'Reset']
  ];
  const ro = (label, value) => ({ label, value, ro: true });
  const PARAMS = {
    'Basic': [{ label: 'Velocity', key: 'vel' }, { label: 'Zero', key: 'zero' }, { label: 'Range', key: 'range' }, { label: 'Delay', key: 'delay' }, ro('Units', 'inch')],
    'Pulser': [ro('PRF', 'Auto Med'), ro('Energy', '100 V'), ro('Damping', '50 Ω'), ro('Mode', 'P/E'), ro('Pulser', 'Square'), ro('Freq', '5.00 MHz')],
    'Receiver': [ro('Filter', '2.0–21.5'), ro('Rectify', 'Full'), ro('Reject', '0 %')],
    'Trig': [ro('Angle', '0.0°'), ro('Thickness', '0.000'), ro('X Value', '0.000')],
    'Display': [ro('Grid', 'Standard'), ro('Fill', 'Off'), ro('Color', 'Default')],
    'Gate 1': [{ label: 'Start', key: 'g1.start' }, { label: 'Width', key: 'g1.width' }, { label: 'Level', key: 'g1.level' }, ro('Alarm', 'Off')],
    'Gate 2': [ro('Status', 'Off'), ro('Start', '1.000'), ro('Width', '0.500'), ro('Level', '40 %')],
    'Auto Cal': [ro('Type', 'Thickness'), { label: 'Cal-Zero', action: 'calzero' }, { label: 'Cal-Vel', action: 'calvel' }],
    'Meas Setup': [ro('Reading 1', 'Thickness'), ro('Reading 2', 'Amp %'), ro('Mode', 'Peak')],
    'Alarms': [ro('Alarm', 'Off')], 'File': [ro('Manage', '—')], 'Setup': [ro('Setup', '—')], 'Config': [ro('Config', '—')], 'Info': [ro('Info', '—')], 'Reset': [ro('Reset', '—')]
  };
  const ADJ = {
    'gain': { steps: [0.1, 1, 2, 6], def: 1, min: 0, max: 110, dec: 1 },
    'vel': { steps: [0.0001, 0.001, 0.01], def: 1, min: 0.05, max: 0.6, dec: 4 },
    'zero': { steps: [0.001, 0.01, 0.1], def: 1, min: 0, max: 60, dec: 3 },
    'range': { steps: [0.001, 0.01, 0.1, 1], def: 2, min: 0.1, max: 20, dec: 3 },
    'delay': { steps: [0.001, 0.01, 0.1, 1], def: 1, min: 0, max: 20, dec: 3 },
    'g1.start': { steps: [0.001, 0.01, 0.1], def: 1, min: 0, max: 20, dec: 3 },
    'g1.width': { steps: [0.001, 0.01, 0.1], def: 1, min: 0.02, max: 20, dec: 3 },
    'g1.level': { steps: [1, 5], def: 1, min: 5, max: 95, dec: 0 },
    'dialog': { steps: [0.001, 0.01, 0.1], def: 1, min: 0, max: 20, dec: 3 }
  };
  const getv = (st, k) => k === 'dialog' ? st.dialog.value : k.startsWith('g1.') ? st.g1[k.slice(3)] : st[k];
  function setv(st, k, v) {
    const a = ADJ[k]; v = Math.min(a.max, Math.max(a.min, v)); v = +v.toFixed(a.dec);
    if (k === 'dialog') st.dialog.value = v; else if (k.startsWith('g1.')) st.g1[k.slice(3)] = v; else st[k] = v;
  }
  const fmtv = (k, v) => k === 'gain' ? v.toFixed(1) : k === 'g1.level' ? v.toFixed(0) + ' %' : k === 'vel' ? v.toFixed(4) : k === 'zero' ? v.toFixed(3) + ' µs' : v.toFixed(3);

  function makeState(o) {
    const st = {
      gain: DEFAULTS.gain, vel: DEFAULTS.vel, zero: DEFAULTS.zero, range: DEFAULTS.range, delay: DEFAULTS.delay,
      g1: Object.assign({}, DEFAULTS.g1),
      group: 0, menu: 'Basic', sel: null, target: 'gain', stepIdx: {},
      second: false, freeze: false, frozen: null, full: false,
      probe: null, cal: { stage: 'idle', p1: null, p2: null, single: false }, dialog: null,
      toast: null, events: [], knob: 0, now: 0, lastPress: null
    };
    if (o) { const g1 = o.g1; Object.assign(st, o); st.g1 = Object.assign({}, DEFAULTS.g1, g1 || {}); if (o.cal) st.cal = Object.assign({ stage: 'idle', p1: null, p2: null, single: false }, o.cal); }
    for (const k in ADJ) if (st.stepIdx[k] == null) st.stepIdx[k] = ADJ[k].def;
    return st;
  }
  function toast(st, text, kind) { st.toast = { text, kind: kind || 'info', t: st.now }; }
  function ev(st, name, data) { st.events.push(Object.assign({ name, t: st.now }, data || {})); }

  function press(st, key) {
    st.lastPress = { key, t: st.now };
    const second = st.second; st.second = false;
    if (key === '2NDF') { st.second = !second; return; }
    if (st.dialog) return pressDialog(st, key);
    if (/^F[1-5]$/.test(key)) {
      const m = GROUPS[st.group][+key[1] - 1]; st.menu = m; st.sel = null; st.target = 'gain';
      ev(st, 'menu', { menu: m }); return;
    }
    if (/^P[1-7]$/.test(key)) {
      const p = (PARAMS[st.menu] || [])[+key[1] - 1];
      if (!p) return;
      if (p.ro) { toast(st, p.label + ' is not used in this lesson'); return; }
      if (p.action) return calAction(st, p.action);
      st.sel = p.key; st.target = p.key; ev(st, 'param', { key: p.key }); return;
    }
    switch (key) {
      case 'NEXT':
        if (second) { st.full = !st.full; ev(st, 'full'); return; }
        st.group = (st.group + 1) % GROUPS.length; st.menu = GROUPS[st.group][0]; st.sel = null; st.target = 'gain';
        ev(st, 'next', { group: st.group }); return;
      case 'DB':
        if (second) { toast(st, 'REF dB is not used in this lesson'); return; }
        st.target = 'gain'; st.sel = null; ev(st, 'db'); return;
      case 'GATES':
        if (second) return autoPct(st);
        st.group = 1; st.menu = 'Gate 1'; st.sel = 'g1.start'; st.target = 'g1.start'; ev(st, 'gates'); return;
      case 'FREEZE':
        if (second) { toast(st, 'SAVE is not used in this lesson'); return; }
        st.freeze = !st.freeze; st.frozen = st.freeze ? { probe: st.probe } : null; ev(st, 'freeze'); return;
      case 'CHECK': {
        const a = ADJ[st.target]; st.stepIdx[st.target] = (st.stepIdx[st.target] + 1) % a.steps.length;
        ev(st, 'step', { target: st.target, step: a.steps[st.stepIdx[st.target]] }); return;
      }
      case 'ESC': st.sel = null; st.target = 'gain'; return;
      case 'POWER': toast(st, 'Power stays on for this lesson'); return;
    }
  }
  function turn(st, n) {
    st.knob += n;
    const k = st.dialog ? 'dialog' : st.target, a = ADJ[k];
    setv(st, k, getv(st, k) + n * a.steps[st.stepIdx[k]]);
    ev(st, 'turn', { key: k, value: getv(st, k) });
  }
  function autoPct(st) {
    const e = gateMax(st);
    if (!e || e.ip) { toast(st, 'AUTO 80%: no echo in Gate 1', 'warn'); ev(st, 'auto', { ok: false }); return; }
    const base = e.pct / Math.pow(10, (st.gain - 40) / 20);
    setv(st, 'gain', 40 + 20 * Math.log10(80 / base));
    ev(st, 'auto', { ok: true, n: e.n }); toast(st, 'AUTO 80%: gain ' + st.gain.toFixed(1) + ' dB');
  }
  function calAction(st, act) {
    const h = gateHit(st);
    if (!h) { toast(st, 'Put Gate 1 on an echo first', 'warn'); return; }
    if (h.e.ip) { toast(st, 'Gate 1 is on the initial pulse — move it to a back-wall echo', 'warn'); return; }
    if (act === 'calvel' && st.cal.stage !== 'zero') { toast(st, 'Do Cal-Zero first, then Continue', 'warn'); return; }
    st.dialog = { mode: act, value: +(Math.round(h.s * 100) / 100).toFixed(3) };  // start on a round 0.01 so the knob lands on round values
    st.stepIdx.dialog = ADJ.dialog.def;
    ev(st, 'dialog', { mode: act });
  }
  function pressDialog(st, key) {
    const d = st.dialog, h = gateHit(st);
    if (key === 'ESC') { st.dialog = null; toast(st, 'Calibration step cancelled'); return; }
    if (key === 'CHECK') { st.stepIdx.dialog = (st.stepIdx.dialog + 1) % ADJ.dialog.steps.length; return; }
    if (key !== 'P6' && key !== 'P7') return;
    if (!h || h.e.ip) { toast(st, 'Gate 1 lost the echo — re-gate it', 'warn'); return; }
    if (d.mode === 'calzero') {
      st.zero = +(h.e.t - 2 * d.value / st.vel).toFixed(3);
      st.cal.p1 = { t: h.e.t, d: d.value, n: h.e.n, probe: st.probe };
      st.dialog = null;
      if (key === 'P6') { st.cal.stage = 'zero'; st.cal.single = false; toast(st, 'Zero set. Gate the second reference, then Cal-Vel'); ev(st, 'calzero', { d: d.value, next: 'continue' }); }
      else { st.cal.stage = 'idle'; st.cal.single = true; toast(st, 'Done after Cal-Zero: only zero was set', 'warn'); ev(st, 'calzero', { d: d.value, next: 'done' }); }
      return;
    }
    if (d.mode === 'calvel') {
      if (key === 'P6') { toast(st, 'Press Done (P7) to finish the calibration'); return; }
      const p1 = st.cal.p1, t2 = h.e.t;
      if (Math.abs(t2 - p1.t) < 0.05 || Math.abs(d.value - p1.d) < 0.01) { toast(st, 'Second point must be a different thickness than the first', 'warn'); return; }
      const v = 2 * (d.value - p1.d) / (t2 - p1.t);
      if (!(v > 0.05 && v < 0.6)) { toast(st, 'Those two points give an impossible velocity — check the values', 'warn'); return; }
      st.vel = +v.toFixed(4); st.zero = +(p1.t - 2 * p1.d / st.vel).toFixed(3);
      st.cal.p2 = { t: t2, d: d.value, n: h.e.n, probe: st.probe }; st.cal.stage = 'done'; st.dialog = null;
      toast(st, 'Calibration done: velocity ' + st.vel.toFixed(4) + ' inch/µs, zero ' + st.zero.toFixed(3) + ' µs');
      ev(st, 'calvel', { d: d.value });
    }
  }
  function place(st, th) {
    st.probe = th; ev(st, 'place', { th });
  }

  // ================= Drawing kit =================
  const SANS = "'Manrope', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace";
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  function font(ctx, size, weight, mono) { ctx.font = `${weight || 600} ${size}px ${mono ? MONO : SANS}`; }
  function txt(ctx, s, x, y, o) {
    o = o || {}; font(ctx, o.size || 14, o.weight || 600, o.mono);
    ctx.fillStyle = o.color || '#fff'; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillText(s, x, y);
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrap(ctx, s, maxW) {
    const words = s.split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  }
  function bullets(ctx, b, arr, color, y0) {
    let y = y0 != null ? y0 : b.y + 76;
    arr.forEach(s => {
      font(ctx, 15, 600); const ls = wrap(ctx, s, b.w - 56);
      ctx.fillStyle = color || '#2a6fdb'; ctx.beginPath(); ctx.arc(b.x + 24, y - 5, 4, 0, 7); ctx.fill();
      ls.forEach((l, i) => txt(ctx, l, b.x + 38, y + i * 20, { size: 15, weight: 600, color: '#1f1d1b' }));
      y += ls.length * 20 + 12;
    });
    return y;
  }
  function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function noise(p) { const i = Math.floor(p), f = p - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u); }

  // ================= Front panel =================
  const W = 1000, H = 600;
  const SCR = { x: 100, y: 30, w: 620, h: 440 };
  const KEYS = [];
  for (let i = 0; i < 5; i++) KEYS.push({ id: 'F' + (i + 1), x: 22, y: SCR.y + 50 + i * 66, w: 62, h: 54, label: 'F' + (i + 1) });
  for (let i = 0; i < 7; i++) KEYS.push({ id: 'P' + (i + 1), x: SCR.x + i * (SCR.w / 7) + 6, y: 490, w: SCR.w / 7 - 12, h: 46, label: 'P' + (i + 1) });
  KEYS.push({ id: 'CHECK', x: 760, y: 232, w: 96, h: 50, label: '✓' });
  KEYS.push({ id: 'ESC', x: 880, y: 232, w: 96, h: 50, label: '↩' });
  KEYS.push({ id: '2NDF', x: 760, y: 306, w: 96, h: 52, label: '2nd F', yellow: true });
  KEYS.push({ id: 'NEXT', x: 880, y: 306, w: 96, h: 52, label: 'NEXT', alt: 'FULL' });
  KEYS.push({ id: 'DB', x: 760, y: 380, w: 96, h: 52, label: 'dB', alt: 'REF dB' });
  KEYS.push({ id: 'GATES', x: 880, y: 380, w: 96, h: 52, label: 'GATES', alt: 'AUTO XX%' });
  KEYS.push({ id: 'FREEZE', x: 760, y: 454, w: 96, h: 52, label: 'FREEZE', alt: 'SAVE' });
  KEYS.push({ id: 'POWER', x: 880, y: 454, w: 96, h: 52, label: '⏻', power: true });
  const KNOB = { x: 868, y: 118, r: 82 };
  const keyById = id => KEYS.find(k => k.id === id);
  function keyCenter(id) { if (id === 'KNOB') return { x: KNOB.x, y: KNOB.y }; const k = keyById(id); return { x: k.x + k.w / 2, y: k.y + k.h / 2 }; }
  function hit(x, y) {
    if (Math.hypot(x - KNOB.x, y - KNOB.y) <= KNOB.r) return { knob: x < KNOB.x ? -1 : 1 };
    for (const k of KEYS) if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return { key: k.id };
    return null;
  }

  function drawInstrument(ctx, st, opt) {
    opt = opt || {};
    // body
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#4a4f55'); g.addColorStop(1, '#2d3136');
    rrect(ctx, 0, 0, W, H, 28); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#1b1e21'; ctx.lineWidth = 3; ctx.stroke();
    rrect(ctx, 10, 10, W - 20, H - 20, 22); ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2; ctx.stroke();
    // yellow bumper accents
    ctx.fillStyle = '#e8b923'; rrect(ctx, 0, 60, 8, 120, 3); ctx.fill(); rrect(ctx, W - 8, 60, 8, 120, 3); ctx.fill();
    // bezel + screen
    rrect(ctx, SCR.x - 8, SCR.y - 8, SCR.w + 16, SCR.h + 16, 8); ctx.fillStyle = '#111315'; ctx.fill();
    drawScreen(ctx, st, opt);
    // keys
    const pressedRecently = id => st.lastPress && st.lastPress.key === id && st.now - st.lastPress.t < 0.22;
    for (const k of KEYS) {
      const down = pressedRecently(k.id), glow = opt.hints && opt.hints.includes(k.id);
      rrect(ctx, k.x, k.y + (down ? 2 : 0), k.w, k.h, 9);
      ctx.fillStyle = k.yellow ? (down ? '#c99c10' : '#e8b923') : k.power ? '#3a1f1f' : (down ? '#15181b' : '#23272b'); ctx.fill();
      ctx.strokeStyle = k.id === '2NDF' && st.second ? '#fff' : '#101214'; ctx.lineWidth = k.id === '2NDF' && st.second ? 3 : 2; ctx.stroke();
      if (!down) { ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(k.x + 8, k.y + 2); ctx.lineTo(k.x + k.w - 8, k.y + 2); ctx.stroke(); }
      const cy = k.y + k.h / 2 + (down ? 2 : 0) + (k.alt ? 6 : 0);
      txt(ctx, k.label, k.x + k.w / 2, cy + 1, { size: k.label.length > 3 ? 15 : 18, weight: 800, color: k.yellow ? '#1b1e21' : k.power ? '#ff8a80' : '#f1f3f5', align: 'center', base: 'middle' });
      if (k.alt) txt(ctx, k.alt, k.x + k.w / 2, k.y + 13 + (down ? 2 : 0), { size: 10, weight: 800, color: '#e8b923', align: 'center', base: 'middle' });
      if (glow) glowRing(ctx, k.x - 5, k.y - 5, k.w + 10, k.h + 10, 12, st.now);
    }
    // knob
    const kg = ctx.createRadialGradient(KNOB.x - 20, KNOB.y - 24, 10, KNOB.x, KNOB.y, KNOB.r);
    kg.addColorStop(0, '#5a6067'); kg.addColorStop(1, '#1c1f22');
    ctx.fillStyle = '#15171a'; ctx.beginPath(); ctx.arc(KNOB.x, KNOB.y, KNOB.r + 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(KNOB.x, KNOB.y, KNOB.r, 0, Math.PI * 2); ctx.fill();
    const ang = (st.knobAnim != null ? st.knobAnim : st.knob) * (Math.PI / 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3;
    for (let i = 0; i < 24; i++) { const a = ang + i * Math.PI / 12; ctx.beginPath(); ctx.moveTo(KNOB.x + Math.cos(a) * (KNOB.r - 12), KNOB.y + Math.sin(a) * (KNOB.r - 12)); ctx.lineTo(KNOB.x + Math.cos(a) * (KNOB.r - 3), KNOB.y + Math.sin(a) * (KNOB.r - 3)); ctx.stroke(); }
    ctx.fillStyle = '#e8b923'; ctx.beginPath(); ctx.arc(KNOB.x + Math.cos(ang - Math.PI / 2) * (KNOB.r - 26), KNOB.y + Math.sin(ang - Math.PI / 2) * (KNOB.r - 26), 7, 0, Math.PI * 2); ctx.fill();
    txt(ctx, '◀', KNOB.x - KNOB.r + 22, KNOB.y + 6, { size: 16, color: 'rgba(255,255,255,0.35)', align: 'center' });
    txt(ctx, '▶', KNOB.x + KNOB.r - 22, KNOB.y + 6, { size: 16, color: 'rgba(255,255,255,0.35)', align: 'center' });
    if (opt.hints && opt.hints.includes('KNOB')) { ctx.save(); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 4; ctx.globalAlpha = 0.55 + 0.45 * Math.sin(st.now * 6); ctx.beginPath(); ctx.arc(KNOB.x, KNOB.y, KNOB.r + 12, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    // labels
    txt(ctx, 'EPOCH 650-style trainer', 22, 580, { size: 13, weight: 800, color: 'rgba(255,255,255,0.55)' });
    txt(ctx, 'UT LEVEL I', W - 24, 580, { size: 11, weight: 700, color: 'rgba(232,185,35,0.8)', align: 'right', mono: true });
  }
  function glowRing(ctx, x, y, w, h, r, now) {
    ctx.save(); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 4; ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now * 6);
    rrect(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore();
  }

  function drawScreen(ctx, st, opt) {
    const X = SCR.x, Y = SCR.y;
    ctx.save(); rrect(ctx, X, Y, SCR.w, SCR.h, 4); ctx.clip();
    ctx.fillStyle = '#0b1320'; ctx.fillRect(X, Y, SCR.w, SCR.h);
    // top bar
    ctx.fillStyle = '#16202e'; ctx.fillRect(X, Y, SCR.w, 42);
    const gainSel = st.target === 'gain' && !st.dialog;
    rrect(ctx, X + 6, Y + 5, 150, 32, 4); ctx.fillStyle = gainSel ? '#3b3212' : '#0f1824'; ctx.fill();
    ctx.strokeStyle = gainSel ? '#ffd84d' : '#2b3a4d'; ctx.lineWidth = gainSel ? 2 : 1; ctx.stroke();
    txt(ctx, 'dB', X + 14, Y + 27, { size: 12, weight: 800, color: '#9fb3c8', mono: true });
    txt(ctx, st.gain.toFixed(1), X + 96, Y + 30, { size: 22, weight: 700, color: '#fff', mono: true, align: 'right' });
    txt(ctx, 'Δ' + ADJ.gain.steps[st.stepIdx.gain].toFixed(1), X + 148, Y + 27, { size: 11, weight: 600, color: '#9fb3c8', mono: true, align: 'right' });
    if (st.second) { rrect(ctx, X + 164, Y + 9, 56, 24, 4); ctx.fillStyle = '#e8b923'; ctx.fill(); txt(ctx, '2nd F', X + 192, Y + 26, { size: 12, weight: 800, color: '#1b1e21', align: 'center', mono: true }); }
    if (st.freeze) txt(ctx, 'FREEZE', X + 228, Y + 26, { size: 12, weight: 800, color: '#7fd3ff', mono: true });
    const rd = reading(st), mx = gateHit(st);
    const box = (x, w, lab, val, col) => {
      rrect(ctx, x, Y + 5, w, 32, 4); ctx.fillStyle = '#0f1824'; ctx.fill(); ctx.strokeStyle = '#2b3a4d'; ctx.lineWidth = 1; ctx.stroke();
      txt(ctx, lab, x + 8, Y + 18, { size: 9, weight: 700, color: col, mono: true });
      txt(ctx, val, x + w - 8, Y + 32, { size: 19, weight: 700, color: '#fff', mono: true, align: 'right' });
    };
    box(X + SCR.w - 322, 190, 'G1 THICKNESS (inch)', rd == null ? '- - - -' : rd.toFixed(3), '#ff8a80');
    box(X + SCR.w - 126, 120, 'G1 AMP', mx ? (mx.e.pct > 110 ? '>110%' : mx.e.pct.toFixed(0) + '%') : '---', '#ff8a80');
    if (opt && opt.highlight === 'thickness') glowRing(ctx, X + SCR.w - 327, Y + 1, 200, 40, 7, st.now);
    // menu tabs (F1-F5)
    const full = st.full;
    const A = full ? { x: X + 8, y: Y + 50, w: SCR.w - 16, h: SCR.h - 58 - 22 } : { x: X + 108, y: Y + 50, w: SCR.w - 116, h: 328 };
    if (!full) {
      GROUPS[st.group].forEach((m, i) => {
        const ty = Y + 50 + i * 66, on = st.menu === m;
        rrect(ctx, X + 6, ty, 94, 58, 4); ctx.fillStyle = on ? '#1f4f7a' : '#111b28'; ctx.fill();
        ctx.strokeStyle = on ? '#7fc4ff' : '#223044'; ctx.lineWidth = on ? 2 : 1; ctx.stroke();
        font(ctx, 13, 700); const lines = wrap(ctx, m, 84);
        lines.forEach((ln, j) => txt(ctx, ln, X + 53, ty + 30 + (j - (lines.length - 1) / 2) * 15, { size: 13, weight: 700, color: on ? '#fff' : '#9fb3c8', align: 'center', base: 'middle' }));
      });
      txt(ctx, 'Menu ' + (st.group + 1) + '/3 · NEXT', X + 53, Y + 50 + 5 * 66 - 4, { size: 9, weight: 700, color: '#6c8098', align: 'center', mono: true });
    }
    drawAscan(ctx, st, A, opt);
    // params (P1-P7)
    if (!full) {
      const ps = st.dialog ? dialogParams(st) : (PARAMS[st.menu] || []);
      const bw = SCR.w / 7, py = Y + 390;
      for (let i = 0; i < 7; i++) {
        const p = ps[i], bx = X + i * bw + 3;
        rrect(ctx, bx, py, bw - 6, 44, 4);
        const on = p && !st.dialog && p.key && st.sel === p.key;
        ctx.fillStyle = on ? '#3b3212' : p ? '#111b28' : '#0d1520'; ctx.fill();
        ctx.strokeStyle = on ? '#ffd84d' : p && p.hot ? '#7dffb0' : '#223044'; ctx.lineWidth = on || (p && p.hot) ? 2 : 1; ctx.stroke();
        if (!p) continue;
        txt(ctx, p.label, bx + (bw - 6) / 2, py + 16, { size: 11, weight: 700, color: p.ro ? '#6c8098' : '#9fb3c8', align: 'center' });
        let val = p.value != null ? p.value : p.key ? fmtv(p.key, getv(st, p.key)) : p.action ? '▸' : '';
        if (on) val += ' ';
        txt(ctx, val, bx + (bw - 6) / 2, py + 36, { size: p.key === 'vel' ? 12 : 13, weight: 700, color: p.ro ? '#8a9bb0' : '#fff', align: 'center', mono: true });
        if (on) txt(ctx, 'Δ' + ADJ[p.key].steps[st.stepIdx[p.key]], bx + bw - 12, py + 12, { size: 8, weight: 700, color: '#ffd84d', align: 'right', mono: true });
      }
    }
    if (st.dialog) drawDialog(ctx, st, A);
    // toast
    if (st.toast && st.now - st.toast.t < 3.2) {
      const a = clamp((3.2 - (st.now - st.toast.t)) / 0.4);
      ctx.save(); ctx.globalAlpha = a; font(ctx, 13, 700); const tw = Math.min(ctx.measureText(st.toast.text).width + 24, A.w - 10);
      rrect(ctx, A.x + (A.w - tw) / 2, A.y + 8, tw, 28, 5); ctx.fillStyle = st.toast.kind === 'warn' ? '#6b2412' : '#12324f'; ctx.fill();
      ctx.strokeStyle = st.toast.kind === 'warn' ? '#ff9a6b' : '#7fc4ff'; ctx.lineWidth = 1.5; ctx.stroke();
      txt(ctx, st.toast.text, A.x + A.w / 2, A.y + 27, { size: 13, weight: 700, color: '#fff', align: 'center' }); ctx.restore();
    }
    ctx.restore();
  }
  function dialogParams(st) {
    const arr = [ro('Cal', st.dialog.mode === 'calzero' ? 'Zero' : 'Velocity'), null, null, null, null,
      { label: 'Continue', value: 'P6', hot: st.dialog.mode === 'calzero' }, { label: 'Done', value: 'P7', hot: st.dialog.mode === 'calvel' }];
    return arr;
  }
  function drawDialog(ctx, st, A) {
    const w = 330, h = 128, x = A.x + A.w - w - 14, y = A.y + 44;
    rrect(ctx, x, y, w, h, 8); ctx.fillStyle = 'rgba(12,22,36,0.96)'; ctx.fill(); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2; ctx.stroke();
    txt(ctx, st.dialog.mode === 'calzero' ? 'AUTO CAL · CAL-ZERO' : 'AUTO CAL · CAL-VEL', x + 16, y + 26, { size: 13, weight: 800, color: '#ffd84d', mono: true });
    txt(ctx, 'Known thickness of the gated echo:', x + 16, y + 50, { size: 12, weight: 600, color: '#9fb3c8' });
    txt(ctx, st.dialog.value.toFixed(3) + '″', x + 16, y + 86, { size: 30, weight: 700, color: '#fff', mono: true });
    txt(ctx, 'Δ' + ADJ.dialog.steps[st.stepIdx.dialog].toFixed(3), x + w - 16, y + 86, { size: 12, weight: 700, color: '#ffd84d', mono: true, align: 'right' });
    txt(ctx, 'Knob: adjust · ✓: step · ' + (st.dialog.mode === 'calzero' ? 'P6 Continue' : 'P7 Done'), x + 16, y + 114, { size: 11, weight: 600, color: '#9fb3c8' });
  }
  function drawAscan(ctx, st, A, opt) {
    ctx.fillStyle = '#050b14'; ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.strokeStyle = 'rgba(160,190,220,0.16)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { const gx = A.x + i * A.w / 10; ctx.beginPath(); ctx.moveTo(gx, A.y); ctx.lineTo(gx, A.y + A.h); ctx.stroke(); }
    for (let i = 0; i <= 10; i++) { const gy = A.y + i * A.h / 10; ctx.setLineDash(i % 2 ? [2, 4] : []); ctx.beginPath(); ctx.moveTo(A.x, gy); ctx.lineTo(A.x + A.w, gy); ctx.stroke(); }
    ctx.setLineDash([]);
    const plotH = A.h - 16, bottom = A.y + A.h - 16;
    const E = echoes(st), R = st.range, D = st.delay;
    const S = s => A.x + (s - D) / R * A.w;
    ctx.save(); ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h - 15); ctx.clip();
    // trace
    ctx.beginPath();
    for (let px = 0; px <= A.w; px++) {
      const s = D + px / A.w * R, p = s * 2 / st.vel + st.zero;
      let a = 1.2 + 2.2 * noise(p * 6.3) * noise(p * 1.1 + 4);
      for (const e of E) {
        const s0 = sOf(st, e.t), dpx = (s - s0) / R * A.w;
        const wpx = Math.max(st.vel * e.w / 2 / R * A.w, e.ip ? 6 : 3.2), wu = dpx < 0 ? wpx * 0.5 : wpx * (e.ip ? 1.4 : 1);
        if (Math.abs(dpx) > 4 * wu) continue;
        a += e.pct * Math.exp(-(dpx / wu) * (dpx / wu)) * (0.5 + 0.5 * Math.abs(Math.sin(dpx * 0.95)));
      }
      const y = bottom - Math.min(a, 108) / 100 * plotH;
      if (px === 0) ctx.moveTo(A.x, y); else ctx.lineTo(A.x + px, y);
    }
    ctx.strokeStyle = '#f5e663'; ctx.lineWidth = 1.6; ctx.stroke();
    // gate 1
    const gs = S(st.g1.start), ge = S(st.g1.start + st.g1.width), gy = bottom - st.g1.level / 100 * plotH;
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gs, gy); ctx.lineTo(ge, gy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gs, gy - 5); ctx.lineTo(gs, gy + 5); ctx.moveTo(ge, gy - 5); ctx.lineTo(ge, gy + 5); ctx.stroke();
    if (opt && opt.arrows) drawArrows(ctx, st, A, S, bottom, plotH, opt.arrows);
    const h = gateHit(st);
    if (h) { const hx = S(h.s); ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(hx, gy - 3); ctx.lineTo(hx - 6, gy - 12); ctx.lineTo(hx + 6, gy - 12); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // scale
    for (let i = 0; i <= 10; i += 2) {
      const v = D + i * R / 10;
      txt(ctx, v.toFixed(R >= 2 ? 1 : 2), A.x + i * A.w / 10, A.y + A.h - 3, { size: 10, weight: 600, color: '#8fa4bb', mono: true, align: i === 0 ? 'left' : i === 10 ? 'right' : 'center' });
    }
  }

  // Glowing arrows over each visible back-wall echo (numbered when arrows.numbered)
  function visibleBackwalls(st) {
    return echoes(st).filter(e => { if (e.ip) return false; const s = sOf(st, e.t); return s >= st.delay && s <= st.delay + st.range && e.pct >= 3; });
  }
  function drawArrows(ctx, st, A, S, bottom, plotH, arrows) {
    const pulse = 0.65 + 0.35 * Math.sin(st.now * 5);
    visibleBackwalls(st).forEach((e, i) => {
      const x = S(sOf(st, e.t)), peak = Math.max(bottom - Math.min(e.pct, 104) / 100 * plotH, A.y + 46);
      const tip = peak - 6, tail = tip - 26;
      ctx.save(); ctx.globalAlpha = pulse; ctx.shadowColor = '#5fd4ff'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#5fd4ff'; ctx.fillStyle = '#5fd4ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, tail); ctx.lineTo(x, tip - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, tip); ctx.lineTo(x - 7, tip - 10); ctx.lineTo(x + 7, tip - 10); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (arrows.numbered) txt(ctx, String(i + 1), x, tail - 6, { size: 14, weight: 800, color: '#5fd4ff', align: 'center', mono: true });
    });
  }

  // ================= Step block view =================
  function drawBlock(ctx, b, st, opt) {
    opt = opt || {};
    rrect(ctx, b.x, b.y, b.w, b.h, 10); ctx.fillStyle = opt.bg || '#ffffff'; ctx.fill(); ctx.strokeStyle = '#ddd6cc'; ctx.lineWidth = 1; ctx.stroke();
    txt(ctx, 'STEP BLOCK · CARBON STEEL', b.x + 12, b.y + 20, { size: 11, weight: 700, color: '#8f8882', mono: true });
    const base = b.y + b.h - 34, sx = (b.w - 40) / 5, scale = Math.min((b.h - 110) / 0.5, 220);
    const rects = [];
    const grd = ctx.createLinearGradient(0, base - 0.5 * scale, 0, base); grd.addColorStop(0, '#cfd5dd'); grd.addColorStop(1, '#9aa5b2');
    STEPS.forEach((th, i) => {
      const x = b.x + 20 + i * sx, top = base - th * scale;
      ctx.fillStyle = grd; ctx.fillRect(x, top, sx, th * scale);
      const on = st.probe === th, hov = opt.hover === th;
      if (on || hov) { ctx.fillStyle = on ? 'rgba(42,111,219,0.18)' : 'rgba(42,111,219,0.08)'; ctx.fillRect(x, top, sx, th * scale); }
      txt(ctx, th.toFixed(3), x + sx / 2, base + 18, { size: 12, weight: 700, color: on ? '#2a6fdb' : '#57524d', align: 'center', mono: true });
      rects.push({ th, x, y: top - 60, w: sx, h: base - top + 60 });
    });
    ctx.strokeStyle = '#5f6b78'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x + 20, base);
    STEPS.forEach((th, i) => { const x = b.x + 20 + i * sx, top = base - th * scale; ctx.lineTo(x, top); ctx.lineTo(x + sx, top); });
    ctx.lineTo(b.x + 20 + 5 * sx, base); ctx.closePath(); ctx.stroke();
    const dragging = opt.drag;
    if (st.probe != null && !dragging) {
      const i = STEPS.indexOf(st.probe), x = b.x + 20 + i * sx + sx / 2, top = base - st.probe * scale;
      ctx.fillStyle = 'rgba(120,190,255,0.35)'; ctx.fillRect(x - 16, top - 2, 32, 3);
      drawProbe(ctx, x, top);
      ctx.strokeStyle = 'rgba(217,115,26,0.7)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, base); ctx.stroke(); ctx.setLineDash([]);
      rects.probe = { x: x - 22, y: top - 50, w: 44, h: 50 };
    } else if ((!opt.noHint || opt.parked) && !dragging) {
      const px = b.x + 48, py = b.y + 92;                      // parked probe, waiting to be dragged
      drawProbe(ctx, px, py);
      if (!opt.noHint) txt(ctx, '← drag the probe onto a step', px + 34, py - 18, { size: 13, weight: 700, color: '#2a6fdb' });
      rects.probe = { x: px - 22, y: py - 50, w: 44, h: 50 };
      if (opt.glowProbe) glowRing(ctx, px - 24, py - 52, 48, 56, 8, st.now);
    }
    if (dragging) drawProbe(ctx, dragging.x, dragging.y + 22, 0.9);
    return rects;
  }
  function drawProbe(ctx, x, top, alpha) {
    ctx.save(); if (alpha != null) ctx.globalAlpha = alpha;
    rrect(ctx, x - 16, top - 44, 32, 40, 4); ctx.fillStyle = '#3a3f47'; ctx.fill();
    ctx.fillStyle = '#d4a017'; ctx.fillRect(x - 16, top - 6, 32, 3);
    ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, top - 44); ctx.quadraticCurveTo(x + 6, top - 62, x + 30, top - 66); ctx.stroke();
    ctx.restore();
  }

  // ================= Guided trainer =================
  function mountTrainer(o) {
    const cv = o.canvas, ctx = cv.getContext('2d'), K = cv.width / W;
    const bc = o.blockCanvas, bctx = bc.getContext('2d'), BK = bc.width / 400;
    let st = makeState(o.initial()), stepI = 0, hints = true, hover = null, rects = [];
    const listeners = [];
    const api = {
      get state() { return st; }, get step() { return stepI; },
      reset() { st = makeState(o.initial()); stepI = 0; st.now = performance.now() / 1000; refresh(); },
      setHints(v) { hints = v; }, onChange(fn) { listeners.push(fn); }, poke() { refresh(); },
      reading: () => reading(st), gateHit: () => gateHit(st), echoes: () => echoes(st)
    };
    function refresh() {
      const steps = o.steps;
      listeners.forEach(f => f(st, api));
      while (stepI < steps.length && steps[stepI].check(st, api)) stepI++;
      renderSteps();
    }
    function renderSteps() {
      const el = o.stepsEl; el.innerHTML = '';
      o.steps.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = i < stepI ? 'done' : i === stepI ? 'now' : '';
        const tip = i === stepI && s.tip ? (typeof s.tip === 'function' ? s.tip(st, api) : s.tip) : '';
        li.innerHTML = (typeof s.text === 'function' ? s.text(st, api, i < stepI) : s.text) + (tip ? `<div class="tip">${tip}</div>` : '');
        el.appendChild(li);
      });
      if (stepI >= o.steps.length && o.doneEl) o.doneEl.hidden = false; else if (o.doneEl) o.doneEl.hidden = true;
    }
    function pos(e, c, k) { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width / k, y: (e.clientY - r.top) * c.height / r.height / k }; }
    let hold = null;
    function doHit(hh) {
      st.now = performance.now() / 1000;
      if (o.guard && o.guard(hh, st, api) === false) { refresh(); return; }   // lesson blocked or handled it
      if (hh.key) press(st, hh.key); else turn(st, hh.knob);
      refresh();
    }
    cv.addEventListener('pointerdown', e => {
      const p = pos(e, cv, K), hh = hit(p.x, p.y); if (!hh) return;
      e.preventDefault(); doHit(hh);
      if (hh.knob) {                                   // hold to keep turning; speeds up the longer you hold
        let n = 0; const dir = hh.knob;
        hold = setInterval(() => { n++; if (n > 4) doHit({ knob: dir * (n > 30 ? 25 : n > 20 ? 10 : n > 12 ? 5 : 1) }); }, 80);
      }
    });
    const stop = () => { if (hold) clearInterval(hold); hold = null; };
    cv.addEventListener('pointerup', stop); cv.addEventListener('pointerleave', stop);
    cv.addEventListener('wheel', e => { const p = pos(e, cv, K); if (Math.hypot(p.x - KNOB.x, p.y - KNOB.y) > KNOB.r + 10) return; e.preventDefault(); doHit({ knob: e.deltaY > 0 ? -1 : 1 }); }, { passive: false });
    cv.addEventListener('pointermove', e => { const p = pos(e, cv, K); cv.style.cursor = hit(p.x, p.y) ? 'pointer' : 'default'; });
    cv.tabIndex = 0;
    cv.addEventListener('keydown', e => {
      const map = { ArrowRight: { knob: 1 }, ArrowUp: { knob: 1 }, ArrowLeft: { knob: -1 }, ArrowDown: { knob: -1 }, Enter: { key: 'CHECK' }, Escape: { key: 'ESC' } };
      if (map[e.key]) { e.preventDefault(); doHit(map[e.key]); }
    });
    // probe: drag it onto a step (clicking a step also works)
    let drag = null;
    const inR = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    const stepAt = p => rects.find(r => inR(p, r));
    function tryPlace(th) {
      st.now = performance.now() / 1000;
      if (o.onPlace && o.onPlace(st, th, api) === false) { refresh(); return; }
      place(st, th); refresh();
    }
    bc.addEventListener('pointermove', e => {
      const p = pos(e, bc, BK), r = stepAt(p);
      hover = r ? r.th : null;
      if (drag) { drag.x = p.x; drag.y = p.y; drag.moved = true; }
      bc.style.cursor = drag ? 'grabbing' : inR(p, rects.probe) ? 'grab' : r ? 'pointer' : 'default';
    });
    bc.addEventListener('pointerleave', () => { if (!drag) hover = null; });
    bc.addEventListener('pointerdown', e => {
      const p = pos(e, bc, BK);
      if (inR(p, rects.probe)) { e.preventDefault(); drag = { x: p.x, y: p.y, moved: false }; bc.setPointerCapture(e.pointerId); return; }
      const r = stepAt(p); if (r) tryPlace(r.th);
    });
    bc.addEventListener('pointerup', e => {
      if (!drag) return;
      const p = pos(e, bc, BK), r = stepAt(p), moved = drag.moved; drag = null; hover = null;
      if (r && moved) tryPlace(r.th);
    });
    function frame() {
      st.now = performance.now() / 1000;
      ctx.setTransform(K, 0, 0, K, 0, 0); ctx.clearRect(0, 0, W, H);
      const cur = o.steps[stepI];
      const hk = hints && cur ? (typeof cur.keys === 'function' ? cur.keys(st, api) : cur.keys) || [] : [];
      drawInstrument(ctx, st, { hints: hk, arrows: o.arrows ? o.arrows(st, api) : null, highlight: o.highlight ? o.highlight(st, api) : null });
      bctx.setTransform(BK, 0, 0, BK, 0, 0); bctx.clearRect(0, 0, 400, bc.height / BK);
      rects = drawBlock(bctx, { x: 0, y: 0, w: 400, h: bc.height / BK }, st, { hover, drag, glowProbe: hints && cur && cur.place != null && st.probe == null });
      if (hints && cur && cur.place != null && st.probe !== cur.place) {
        const r = rects.find(r => r.th === cur.place); if (r) glowRing(bctx, r.x + 2, r.y + 50, r.w - 4, r.h - 48, 6, st.now);
      }
      requestAnimationFrame(frame);
    }
    st.now = performance.now() / 1000; refresh(); requestAnimationFrame(frame);
    return api;
  }

  // ================= Scripted lesson video =================
  // cues: [{ say, do: [[offsetSec, action], ...], hold, card }]
  // action: 'F1'..'P7','CHECK','ESC','2NDF','NEXT','DB','GATES','FREEZE'  |  ['knob', n]  |  ['place', th]  |  ['set', {..}]  |  ['toast', text]
  // voice: optional measured narration length (s) per cue, so each line gets exactly its spoken time
  const VOICE_LEAD = 0.15;                       // narration starts this long after the cue begins
  function buildTimeline(cues, voice) {
    let t = 0.6; const acts = [], out = [];
    cues.forEach((c, i) => {
      const words = c.say.split(/\s+/).length;
      let last = 0;
      (c.do || []).forEach(([off, a]) => {
        if (Array.isArray(a) && a[0] === 'knob') {
          const n = a[1], dir = Math.sign(n), gap = a[2] || 0.16;
          for (let k = 0; k < Math.abs(n); k++) acts.push({ t: t + off + k * gap, a: ['knob', dir] });
          last = Math.max(last, off + Math.abs(n) * gap);
        } else { acts.push({ t: t + off, a }); last = Math.max(last, off); }
      });
      const spoken = voice && voice[i] != null ? VOICE_LEAD + voice[i] + 0.3 : words / 2.55;
      const dur = Math.max(spoken, last + 0.7) + (c.hold || 0.35);
      const q = { t0: t, t1: t + dur, say: c.say, speak: c.speak || c.say, card: c.card, i };
      ['arrows', 'highlight'].forEach(k => { if (k in c) q[k] = c[k]; });
      out.push(q);
      t += dur;
    });
    acts.sort((x, y) => x.t - y.t);
    return { cues: out, acts, total: t + 1.2 };
  }
  function stateAt(init, tl, t) {
    const st = makeState(init());
    let knobFrom = 0, knobT = -9;
    for (const x of tl.acts) {
      if (x.t > t) break;
      st.now = x.t; const a = x.a;
      if (typeof a === 'string') press(st, a);
      else if (a[0] === 'knob') { knobFrom = st.knob; knobT = x.t; turn(st, a[1]); }
      else if (a[0] === 'place') place(st, a[1]);
      else if (a[0] === 'set') { const v = a[1]; Object.assign(st, v); if (v.g1) st.g1 = Object.assign({}, st.g1, v.g1); }
      else if (a[0] === 'toast') toast(st, a[1], a[2]);
    }
    st.now = t;
    const k = clamp((t - knobT) / 0.12); st.knobAnim = lerp(knobFrom, st.knob, k);
    return st;
  }
  function cursorAt(tl, t) {
    // ghost finger: glides to the next target 0.45 s before each press
    const targets = tl.acts.filter(x => typeof x.a === 'string' || x.a[0] === 'knob' || x.a[0] === 'place');
    const where = x => typeof x.a === 'string' ? { kind: 'inst', ...keyCenter(x.a) } : x.a[0] === 'knob' ? { kind: 'inst', x: KNOB.x + x.a[1] * 44, y: KNOB.y + 10 } : { kind: 'block', th: x.a[1] };
    let prev = null, next = null;
    for (const x of targets) { if (x.t <= t) prev = x; else { next = x; break; } }
    if (!prev && !next) return null;
    const P = prev ? where(prev) : null, N = next ? where(next) : null;
    if (!prev) return t > next.t - 0.6 ? { ...N, press: 0, alpha: clamp((t - (next.t - 0.6)) / 0.3) } : null;
    const since = t - prev.t;
    if (next && next.t - t < 0.45 && P.kind === N.kind) {
      const f = 1 - (next.t - t) / 0.45, e = f * f * (3 - 2 * f);
      return { kind: N.kind, x: lerp(P.x, N.x, e), y: lerp(P.y, N.y, e), th: N.th, press: 0, alpha: 1 };
    }
    if (next && next.t - t < 0.45) return { ...N, press: 0, alpha: 1 };
    return { ...P, press: clamp(1 - since / 0.25), alpha: clamp(1 - (since - 2.5) / 0.6) };
  }
  function drawFinger(ctx, x, y, press) {
    ctx.save();
    if (press > 0) { ctx.strokeStyle = 'rgba(255,216,77,' + press + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 18 + (1 - press) * 22, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = '#1b1e21'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8b923'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  const VW = 1280, VH = 720, IS = 0.9, IX = 18, IY = 66;
  function renderVideo(ctx, cfg, tl, t, showSubs) {
    const st = stateAt(cfg.initial, tl, t);
    ctx.fillStyle = '#f6f3ee'; ctx.fillRect(0, 0, VW, VH);
    // title bar
    rrect(ctx, 18, 14, 40, 36, 6); ctx.fillStyle = '#A82020'; ctx.fill();
    txt(ctx, cfg.num || 'UT', 38, 38, { size: 16, weight: 800, color: '#fff', align: 'center', mono: true });
    txt(ctx, cfg.title, 70, 42, { size: 24, weight: 800, color: '#1f1d1b' });
    txt(ctx, 'EPOCH 650-STYLE TRAINER · UT LEVEL I', VW - 18, 40, { size: 12, weight: 600, color: '#8f8882', align: 'right', mono: true });
    // instrument
    ctx.save(); ctx.translate(IX, IY); ctx.scale(IS, IS);
    let arrows = null, highlight = null;
    for (const q of tl.cues) { if (q.t0 > t) break; if ('arrows' in q) arrows = q.arrows; if ('highlight' in q) highlight = q.highlight; }
    drawInstrument(ctx, st, { arrows: arrows ? { numbered: arrows === 'numbered' } : null, highlight });
    const c = cursorAt(tl, t);
    if (c && c.kind === 'inst') { ctx.globalAlpha = c.alpha; drawFinger(ctx, c.x, c.y, c.press); ctx.globalAlpha = 1; }
    ctx.restore();
    // right column
    const bx = IX + W * IS + 16, bw = VW - bx - 18;
    const B = { x: bx, y: IY, w: bw, h: 210 };
    // probe drag: in the second before a 'place', the finger carries the probe from its parking spot to the step
    const nextPlace = tl.acts.find(x => Array.isArray(x.a) && x.a[0] === 'place' && x.t > t && x.t - t < 1.1);
    let dragPos = null;
    if (nextPlace && st.probe == null) {
      const rr0 = drawBlock(document.createElement('canvas').getContext('2d'), B, st, { noHint: true }).find(q => q.th === nextPlace.a[1]);
      const f = clamp(1 - (nextPlace.t - t) / 1.0), e = f * f * (3 - 2 * f);
      dragPos = { x: lerp(B.x + 48, rr0.x + rr0.w / 2, e), y: lerp(B.y + 70, rr0.y + 60 - 22, e) - Math.sin(Math.PI * e) * 30 };
    }
    const r = drawBlock(ctx, B, st, { noHint: true, parked: true, drag: dragPos });
    if (dragPos) drawFinger(ctx, dragPos.x, dragPos.y - 10, 0);
    else if (c && c.kind === 'block') { const rr = r.find(q => q.th === c.th); if (rr) { ctx.globalAlpha = c.alpha; drawFinger(ctx, rr.x + rr.w / 2, rr.y + 40, c.press); ctx.globalAlpha = 1; } }
    const cue = tl.cues.find(q => t >= q.t0 && t < q.t1) || tl.cues[tl.cues.length - 1];
    let card = null; for (const q of tl.cues) { if (q.t0 > t) break; if (q.card) card = q.card; }
    const CB = { x: bx, y: IY + 222, w: bw, h: IY + H * IS - (IY + 222) };
    rrect(ctx, CB.x, CB.y, CB.w, CB.h, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#ddd6cc'; ctx.lineWidth = 1; ctx.stroke();
    if (card && cfg.cards && cfg.cards[card]) cfg.cards[card](ctx, CB, st, t, { txt, rrect, wrap, font, bullets, reading: () => reading(st), gateHit: () => gateHit(st) });
    // subtitles
    if (showSubs && cue && t < tl.total - 0.8) {
      const a = clamp(Math.min((t - cue.t0) / 0.2, (cue.t1 - t) / 0.2));
      ctx.save(); ctx.globalAlpha = Math.max(a, 0.001);
      font(ctx, 23, 700); const lines = wrap(ctx, cue.say, VW - 140);
      const lh = 30, hgt = lines.length * lh + 18, y0 = VH - 10 - hgt;
      rrect(ctx, 40, y0, VW - 80, hgt, 10); ctx.fillStyle = 'rgba(15,22,32,0.86)'; ctx.fill();
      lines.forEach((ln, i) => txt(ctx, ln, VW / 2, y0 + 9 + lh * (i + 0.5), { size: 23, weight: 700, color: '#fff', align: 'center', base: 'middle' }));
      ctx.restore();
    }
    return cue;
  }

  function mountVideo(o) {
    const cv = o.canvas, ctx = cv.getContext('2d'), K = cv.width / VW;
    const tl = buildTimeline(o.cfg.cues, o.cfg.voice);
    let tNow = 0, playing = false, last = null, subs = true, lastCue = -1;
    // narration track (one file, starts at t = 0); the clock follows it while it plays
    let audio = null;
    if (o.cfg.audio && !o.noAudio) {
      audio = new Audio(o.cfg.audio); audio.preload = 'auto';
      audio.addEventListener('error', () => { audio = null; });
      if (o.voice) o.voice.addEventListener('change', () => { if (audio) audio.muted = !o.voice.checked; });
    }
    const audioOk = () => audio && audio.readyState >= 2 && !audio.error;
    const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    function draw() {
      ctx.setTransform(K, 0, 0, K, 0, 0);
      const cue = renderVideo(ctx, o.cfg, tl, tNow, subs);
      o.scrub.value = Math.round(tNow / tl.total * 1000);
      o.time.textContent = fmt(tNow) + ' / ' + fmt(tl.total);
      if (cue && cue.i !== lastCue) { lastCue = cue.i; }
    }
    function setPlaying(p) {
      playing = p; if (p && tNow >= tl.total - 0.05) tNow = 0;
      o.play.textContent = p ? '❚❚ Pause' : '▶ Play'; if (o.big) o.big.hidden = p || tNow > 0; last = null;
      if (audio) { if (p) { try { audio.currentTime = tNow; } catch (e) {} audio.play().catch(() => {}); } else audio.pause(); }
    }
    o.play.addEventListener('click', () => setPlaying(!playing));
    if (o.big) o.big.addEventListener('click', () => setPlaying(true));
    cv.addEventListener('click', () => setPlaying(!playing));
    o.scrub.addEventListener('input', () => { tNow = o.scrub.value / 1000 * tl.total; if (o.big) o.big.hidden = true; if (audio) try { audio.currentTime = tNow; } catch (e) {} draw(); });
    if (o.subs) o.subs.addEventListener('change', () => { subs = o.subs.checked; draw(); });
    function loop(ts) {
      if (playing) {
        if (audioOk() && !audio.paused && !audio.ended && audio.currentTime < tl.total) tNow = audio.currentTime;
        else if (last != null) tNow += (ts - last) / 1000;
        last = ts; if (tNow >= tl.total) { tNow = tl.total; setPlaying(false); } draw();
      }
      requestAnimationFrame(loop);
    }
    draw(); requestAnimationFrame(loop);
    return {
      duration: tl.total, voiceLead: VOICE_LEAD, cues: tl.cues.map(c => ({ start: c.t0, end: c.t1, text: c.say, speak: c.speak })),
      allCues: o.cfg.cues.map(c => ({ text: c.say, speak: c.speak || c.say })),
      stateAt: t => { const s = stateAt(o.cfg.initial, tl, t); return { range: s.range, gain: s.gain, vel: s.vel, zero: s.zero, probe: s.probe, g1: s.g1.start, rd: reading(s), cal: s.cal.stage, dialog: s.dialog && s.dialog.value, menu: s.menu, amp: (gateHit(s) || { e: {} }).e.pct }; },
      frame: (t, q) => { ctx.setTransform(K, 0, 0, K, 0, 0); renderVideo(ctx, o.cfg, tl, t, true); return cv.toDataURL('image/jpeg', q || 0.93).slice(23); },
      redraw: draw
    };
  }

  // ================= Page scaffold =================
  function page(cfg) {
    const fonts = document.fonts ? Promise.all(["700 20px 'Manrope'", "800 20px 'Manrope'", "600 20px 'Manrope'", "700 20px 'JetBrains Mono'", "600 20px 'JetBrains Mono'"].map(f => document.fonts.load(f))).catch(() => {}) : Promise.resolve();
    Promise.race([fonts, new Promise(r => setTimeout(r, 2500))]).then(() => build(cfg));
  }
  function build(cfg) {
    const main = document.getElementById('app');
    const hasVideo = !!cfg.video;                     // lessons can ship without a video
    let n = 0;
    main.innerHTML = `
      <p class="lede">${cfg.lede}</p>
      ${hasVideo ? `<h2><span class="n">${++n}</span> Watch the lesson</h2>
      <div class="player">
        <div class="stage-wrap"><canvas id="vid" width="1920" height="1080" aria-label="Lesson video"></canvas><button class="bigplay" id="big" aria-label="Play">▶</button></div>
        <div class="controls"><button class="play" id="play">▶ Play</button><input type="range" id="scrub" min="0" max="1000" value="0" aria-label="Seek"><span class="time" id="time"></span>${cfg.video.audio ? '<label><input type="checkbox" id="voice" checked> Voice</label>' : ''}<label><input type="checkbox" id="subs" checked> Subtitles</label></div>
      </div>` : ''}
      <h2><span class="n">${++n}</span> Try it on the Epoch</h2>
      <p class="lede">${cfg.tryIntro}</p>
      <div class="trainer">
        <div class="inst"><canvas id="inst" width="1500" height="900" aria-label="EPOCH 650-style flaw detector"></canvas>
          <div class="helpline">${cfg.helpline || 'Click keys to press them. Turn the knob by clicking its left or right half (hold to keep turning), scrolling over it, or pressing ← → after clicking the instrument. <b>✓</b> changes the step size.'}</div></div>
        <aside class="side">
          <canvas id="block" width="800" height="440" aria-label="Step block — click a step to place the probe"></canvas>
          <div class="panel"><div class="ph"><b>Steps</b><label><input type="checkbox" id="hints" checked> Highlight keys</label></div>
            <ol class="steps" id="steps"></ol>
            <div class="done" id="done" hidden>✓ Exercise complete. ${cfg.doneText || ''}</div>
            <div class="row"><button id="reset">Start over</button></div></div>
          <div id="extra"></div>
        </aside>
      </div>
      <h2><span class="n">${++n}</span> Key points</h2>
      <div class="card">${cfg.keyPoints}</div>`;
    const trainer = mountTrainer({
      canvas: document.getElementById('inst'), blockCanvas: document.getElementById('block'),
      stepsEl: document.getElementById('steps'), doneEl: document.getElementById('done'),
      initial: cfg.trainerInitial, steps: cfg.steps, onPlace: cfg.onPlace, guard: cfg.guard, arrows: cfg.arrows, highlight: cfg.highlight
    });
    document.getElementById('hints').addEventListener('change', e => trainer.setHints(e.target.checked));
    document.getElementById('reset').addEventListener('click', () => { if (cfg.onReset) cfg.onReset(); trainer.reset(); });
    if (cfg.extra) cfg.extra(document.getElementById('extra'), trainer);
    const params = new URLSearchParams(location.search);
    if (params.has('record')) document.body.classList.add('record');
    if (params.has('embed')) document.body.classList.add('embed');   // ?embed: for iframes, hides the link back to the hub
    window.__trainer = trainer;
    if (!hasVideo) return;
    const video = mountVideo({
      canvas: document.getElementById('vid'), cfg: cfg.video, play: document.getElementById('play'), big: document.getElementById('big'),
      scrub: document.getElementById('scrub'), time: document.getElementById('time'), subs: document.getElementById('subs'),
      voice: document.getElementById('voice'), noAudio: params.has('record')
    });
    window.__video = Object.assign(video, { ready: true, title: cfg.video.title });
    window.__trainer = trainer;
  }

  // ================= Shared calibration cards (video) =================
  // graph: time vs thickness with the two calibration points; verify: readings on steps not used to calibrate
  function calCards(o) {
    const maxD = o.maxD || 0.6, maxT = Math.ceil((2 * maxD / TRUE_V + T0) / 2) * 2, vsteps = o.verify || [0.3, 0.4];
    return {
      why(ctx, b, st, t, h) {
        h.txt(ctx, 'Two unknowns', b.x + 18, b.y + 38, { size: 21, weight: 800, color: '#1f1d1b' });
        h.txt(ctx, 'thickness = velocity × time ÷ 2', b.x + 18, b.y + 66, { size: 14, weight: 700, color: '#A82020', mono: true });
        h.bullets(ctx, b, ['ZERO: the delay through the wear plate and couplant.', 'VELOCITY: how fast sound travels in the steel.', 'Two unknowns need two known thicknesses.'], '#A82020', b.y + 104);
      },
      graph(ctx, b, st, t, h) {
        h.txt(ctx, 'TIME vs THICKNESS', b.x + b.w - 16, b.y + 24, { size: 12, weight: 700, color: '#8f8882', mono: true, align: 'right' });
        const gx = b.x + 52, gy = b.y + 44, gw = b.w - 72, gh = b.h - 100;
        const GX = d => gx + d / maxD * gw, GY = tt => gy + gh - tt / maxT * gh;
        ctx.strokeStyle = '#ddd6cc'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) { const d = maxD * i / 4; ctx.beginPath(); ctx.moveTo(GX(d), gy); ctx.lineTo(GX(d), gy + gh); ctx.stroke(); h.txt(ctx, d.toFixed(2), GX(d), gy + gh + 16, { size: 11, color: '#57524d', mono: true, align: 'center' }); }
        for (let i = 0; i <= 4; i++) { const tt = maxT * i / 4; ctx.beginPath(); ctx.moveTo(gx, GY(tt)); ctx.lineTo(gx + gw, GY(tt)); ctx.stroke(); h.txt(ctx, tt.toFixed(1), gx - 6, GY(tt) + 4, { size: 11, color: '#57524d', mono: true, align: 'right' }); }
        h.txt(ctx, 'thickness (inch)', gx + gw, gy + gh + 34, { size: 11, color: '#8f8882', mono: true, align: 'right' });
        h.txt(ctx, 'µs', gx - 6, gy - 10, { size: 11, color: '#8f8882', mono: true, align: 'right' });
        ctx.strokeStyle = '#1f1d1b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.stroke();
        const pts = [st.cal.p1, st.cal.p2].filter(Boolean);
        if (st.cal.stage === 'done') {
          const tf = d => st.zero + 2 * d / st.vel;
          ctx.strokeStyle = '#1f1d1b'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(GX(0), GY(tf(0))); ctx.lineTo(GX(maxD), GY(tf(maxD))); ctx.stroke();
          ctx.fillStyle = '#d9731a'; ctx.beginPath(); ctx.arc(GX(0), GY(st.zero), 6, 0, 7); ctx.fill();
          h.txt(ctx, 'zero ' + st.zero.toFixed(3) + ' µs', GX(maxD * 0.12), GY(st.zero) - 6, { size: 12, weight: 800, color: '#d9731a', mono: true });
          h.txt(ctx, 'slope → velocity', GX(maxD * 0.03), gy + 18, { size: 12, weight: 800, color: '#1f1d1b', mono: true });
          h.txt(ctx, st.vel.toFixed(4) + ' inch/µs', GX(maxD * 0.03), gy + 34, { size: 12, weight: 800, color: '#1f1d1b', mono: true });
        }
        pts.forEach((p, i) => {
          ctx.fillStyle = i ? '#1f1d1b' : '#A82020'; ctx.beginPath(); ctx.arc(GX(p.d), GY(p.t), 7, 0, 7); ctx.fill();
          h.txt(ctx, (i ? 'Cal-Vel ' : 'Cal-Zero ') + p.d.toFixed(3), GX(p.d) + (i ? -10 : 10), GY(p.t) + (i ? -12 : 18), { size: 12, weight: 800, color: i ? '#1f1d1b' : '#A82020', mono: true, align: i ? 'right' : 'left' });
        });
      },
      verify(ctx, b, st, t, h) {
        h.txt(ctx, 'Verify', b.x + 18, b.y + 36, { size: 21, weight: 800, color: '#1f1d1b' });
        h.txt(ctx, 'on steps NOT used to calibrate', b.x + 18, b.y + 60, { size: 13, weight: 700, color: '#57524d' });
        const cal = st.events.findIndex(e => e.name === 'calvel');
        const seen = new Set(cal < 0 ? [] : st.events.slice(cal).filter(e => e.name === 'place').map(e => e.th));
        vsteps.forEach((d, i) => {
          const y = b.y + 110 + i * 46;
          h.txt(ctx, 'Step ' + d.toFixed(3), b.x + 22, y, { size: 16, weight: 700, color: '#1f1d1b', mono: true });
          if (!seen.has(d)) return;
          const r = st.vel * (T0 + 2 * d / TRUE_V - st.zero) / 2, ok = Math.abs(r - d) < 0.003;
          h.txt(ctx, 'reads ' + r.toFixed(3), b.x + 170, y, { size: 16, weight: 800, color: ok ? '#0d904f' : '#d93025', mono: true });
          h.txt(ctx, ok ? '✓' : '✗', b.x + b.w - 26, y, { size: 20, weight: 800, color: ok ? '#0d904f' : '#d93025' });
        });
      },
      mistakes(ctx, b, st, t, h) {
        h.txt(ctx, 'Common mistakes', b.x + 18, b.y + 38, { size: 21, weight: 800, color: '#1f1d1b' });
        h.bullets(ctx, b, o.mistakes, '#d93025', b.y + 80);
      }
    };
  }

  // ================= Lesson helpers =================
  // Floating question card on the instrument. Full card sits under the screen (over the P keys);
  // a "mini" card sits over the right-hand keys below the knob. Neither covers the A-scan or the knob.
  function questionCard() {
    const el = document.createElement('div'); el.className = 'qpop'; el.hidden = true; el.setAttribute('aria-live', 'polite');
    document.querySelector('.inst').appendChild(el);
    function place() {
      if (el.hidden) return;
      if (matchMedia('(max-width: 900px)').matches) { el.style.left = el.style.top = el.style.width = ''; return; }
      const cv = document.getElementById('inst'), w = cv.offsetWidth, h = cv.offsetHeight, mini = el.classList.contains('mini');
      el.style.left = cv.offsetLeft + w * (mini ? 0.752 : 0.096) + 'px';
      el.style.top = cv.offsetTop + h * (mini ? 0.375 : 0.805) + 'px';
      el.style.width = w * (mini ? 0.236 : 0.63) + 'px';
    }
    addEventListener('resize', place);
    return {
      el,
      show(html, mini) { el.className = mini ? 'qpop mini' : 'qpop'; el.hidden = false; el.innerHTML = html; place(); return el; },
      hide() { el.hidden = true; }
    };
  }
  // Knob rules for range lessons: fixed 0.01″ step (✓ does nothing), knob locked while a card asks
  // something, and the knob stops exactly on the target range so nobody overshoots.
  function fixedStepRangeGuard(o) {
    return (hh, st) => {
      if (hh.key === 'CHECK') { toast(st, 'The knob step stays at 0.01″ for this lesson'); return false; }
      if (hh.knob == null) return;
      const msg = o.locked && o.locked(); if (msg) { toast(st, msg, 'warn'); return false; }
      const R = o.target && o.target();
      if (R != null && st.sel === 'range') {
        const nxt = st.range + hh.knob * 0.01;
        if ((st.range < R - 1e-9 && nxt >= R - 1e-9) || (st.range > R + 1e-9 && nxt <= R + 1e-9)) { turn(st, Math.round((R - st.range) / 0.01)); return false; }
      }
    };
  }

  window.Epoch650 = { questionCard, fixedStepRangeGuard, calCards, visibleBackwalls, toast, page, makeState, keyCenter, W, H, press, turn, place, echoes, reading, gateHit, sOf, TRUE_V, T0, STEPS, draw: { txt, rrect, wrap, font } };
})();
