#!/usr/bin/env node
// Checks the Dodd and Deeds model used by the eddy current lessons, and every number their narration relies on.
//
//   node tools/eddy/check_dodd_deeds.cjs
//
// 1. Each lesson page carries an exact copy of tools/eddy/dodd_deeds_core.js in its <script id="physics"> block, and
//    Lesson 3 also an exact copy of tools/eddy/dodd_deeds_mu.js (plates with relative permeability).
// 2. The model passes independent checks: an image-coil filament sum (elliptic integrals), the thick-plate and
//    thin-sheet limits, zero thickness = air, and passivity (resistance never negative, reactance never above air).
//    The permeability extension matches the core at mu_r = 1, magnetic image theory at zero frequency, and the
//    sigma / mu_r equivalence at high frequency.
// 3. The claims each lesson makes still hold. Run this after changing the model, the coil or the lesson numbers.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const core = fs.readFileSync(path.join(__dirname, 'dodd_deeds_core.js'), 'utf8').trim();
const muExt = fs.readFileSync(path.join(__dirname, 'dodd_deeds_mu.js'), 'utf8').trim();
let fails = 0;
const ck = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); if (!ok) fails++; };
function load(page, exports, withMu) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const src = html.match(/<script id="physics">([\s\S]*?)<\/script>/)[1];
  ck(page + ': physics block carries the shared core unchanged', src.includes(core));
  if (withMu) ck(page + ': physics block carries the permeability extension unchanged', src.includes(muExt));
  return new Function(src + ';return {' + exports + '};')();
}
const L1 = load('ET-Impedance-Plane.html', 'Zplate,depthMM,COIL,MU0,SIGMA_IACS,Zn,fOf,sepAngle,XPC,P_PEAK,FMIN,liftOfEta');
const L2 = load('ET-Frequency-and-Thickness.html', 'Zplate,Zm,Zp,deltaMils,sepDirs,THICK,MIL');
const L3 = load('ET-Steel-and-Signals.html', 'Zplate,ZplateMu,Zs,dirLift,dirMuDown,dirSigDown,dirThin,thinSize,depthMuMM,STEEL_MU,STEEL_IACS,MIL,angleBetween,degOf,diffZ,unitV', true);
const L3main = fs.readFileSync(path.join(root, 'ET-Steel-and-Signals.html'), 'utf8');
const { Zplate, COIL, MU0 } = L1;
const air = { R: 0, X: 1 }, dist = (a, b) => Math.hypot(a.R - b.R, a.X - b.X), IACS = 5.8e7;
let imageDrop = 0; /* reactance drop for a perfect conductor from the filament sum, reused for the magnetic image check */

console.log('\n--- model checks');
{
  const s = 0.28 * IACS, f = 1e5, thick = Zplate(s, f, Infinity, 0), d10 = Zplate(s, f, 10, 0), d0 = Zplate(s, f, 1e-6, 0);
  ck('plate 25 standard depths thick equals the half-space formula', dist(thick, d10) < 1e-9);
  ck('vanishing thickness gives the air point', dist(d0, air) < 1e-4 * dist(thick, air));
  const MU = MU0, A = (al, l) => { const a = Math.exp(-al * (COIL.wear + l)) - Math.exp(-al * (COIL.wear + l + COIL.h)); return a * a; };
  const DD = new Function(fs.readFileSync(path.join(__dirname, 'dodd_deeds_core.js'), 'utf8') + ';return DD;')();
  function Zthin(sig, f, d) { const k2 = 2 * Math.PI * f * MU * sig * 1e-6; let sr = 0, si = 0; for (let i = 0; i < DD.a.length; i++) { const al = DD.a[i], g = DD.w[i] * A(al, 0), dr = 2 * al, di = k2 * d, dd = dr * dr + di * di; sr += g * (-k2 * d * di) / dd; si += g * (-k2 * d * dr) / dd; } return { R: -si / DD.I0, X: 1 + sr / DD.I0 }; }
  const errs = [0.005, 0.0005, 0.00005].map(d => { const a = Zplate(s * 0.005 / d, 1e4, d, 0), b = Zthin(s * 0.005 / d, 1e4, d); return dist(a, b) / dist(b, air); });
  ck('converges to the thin-sheet (sigma x d) formula', errs[1] < errs[0] / 5 && errs[2] < errs[1] / 5 && errs[2] < 1e-3, errs.map(e => e.toExponential(1)).join(' -> '));
  let pass = true;
  for (const p of [0.1, 1, 10, 100]) for (const f2 of [1e2, 1e4, 1e6, 1e7]) for (const d of [0.001, 0.05, 1, Infinity]) for (const l of [0, 0.5]) { const z = Zplate(p / 100 * IACS, f2, d, l); if (z.R < -1e-12 || z.X > 1 + 1e-12) pass = false; }
  ck('resistance never negative and reactance never above air', pass);
  // independent: reactance drop for a perfect conductor = M(coil, image coil) / L(coil), by summing filament loops
  function ellipK(m) { let a = 1, b = Math.sqrt(1 - m); for (let i = 0; i < 30; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; } return Math.PI / (2 * a); }
  function ellipE(m) { let a = 1, b = Math.sqrt(1 - m), sum = m / 2, p = 1; for (let i = 0; i < 30; i++) { const t = (a + b) / 2, c = (a - b) / 2; b = Math.sqrt(a * b); a = t; p *= 2; sum += p * c * c / 2; } return Math.PI / (2 * a) * (1 - sum); }
  const Mloops = (r1, r2, z) => { const k2 = 4 * r1 * r2 / ((r1 + r2) ** 2 + z * z), k = Math.sqrt(k2); return MU * Math.sqrt(r1 * r2) * ((2 / k - k) * ellipK(k2) - 2 / k * ellipE(k2)); };
  const n = 24, fil = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) fil.push([COIL.r1 + (COIL.r2 - COIL.r1) * (i + 0.5) / n, COIL.h * (j + 0.5) / n]);
  let M = 0, L = 0; const side = (COIL.r2 - COIL.r1) / n;
  for (const p of fil) for (const q of fil) {
    M += Mloops(p[0] * 1e-3, q[0] * 1e-3, (p[1] + q[1] + 2 * COIL.wear) * 1e-3);
    L += p === q ? MU * p[0] * 1e-3 * (Math.log(8 * p[0] / (0.44705 * side)) - 2) : Mloops(p[0] * 1e-3, q[0] * 1e-3, Math.abs(p[1] - q[1]) * 1e-3);
  }
  const pc = Zplate(1e15, 1e7, Infinity, 0);
  imageDrop = M / L;
  ck('perfect-conductor drop matches the image-coil filament sum within 1%', Math.abs((1 - pc.X) / (M / L) - 1) < 0.01, `model ${(1 - pc.X).toFixed(4)}, filaments ${(M / L).toFixed(4)}`);
}

console.log('\n--- Lesson 1 (The Impedance Plane) claims, thick plates at 100 kHz');
{
  const { Zn, fOf, sepAngle } = L1, E = 0.9, at = (iacs, kHz) => Zn(fOf(iacs, kHz || 100), E);
  const al = at(43), cu = at(100);
  ck('on aluminum the dot sits down and right of air', al.X < 1 && al.R > 0);
  ck('copper sits lower and further left than 6061 aluminum', cu.X < al.X && cu.R < al.R);
  const ang = { cu: sepAngle(fOf(100, 100)), al: sepAngle(fOf(43, 100)), ss: sepAngle(fOf(2.4, 100)), ti: sepAngle(fOf(1, 100)) };
  ck('"about forty five degrees" at copper and aluminum', ang.cu > 41 && ang.cu < 48 && ang.al > 40 && ang.al < 48, `Cu ${ang.cu.toFixed(1)}, Al ${ang.al.toFixed(1)}`);
  ck('"about twenty five to thirty degrees" at titanium and stainless', ang.ti > 22 && ang.ti < 28 && ang.ss > 27 && ang.ss < 33, `Ti ${ang.ti.toFixed(1)}, SS ${ang.ss.toFixed(1)}`);
  const t30 = sepAngle(fOf(1, 30)), t100 = ang.ti, t1M = sepAngle(fOf(1, 1000));
  ck('titanium: lower frequency closes the angle, higher opens it', t30 < t100 && t1M > t100 + 8, `${t30.toFixed(1)} < ${t100.toFixed(1)} < ${t1M.toFixed(1)}`);
  ck('titanium standard depth: about 2 mm at 100 kHz, under 1 mm at 1 MHz', Math.abs(L1.depthMM(1, 100) - 2.09) < 0.05 && L1.depthMM(1, 1000) < 1);
  let lo = L1.FMIN, hi = fOf(43, 100); const P = Zn(fOf(43, 100), 0.6), r = Math.hypot(P.R, P.X);
  for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi), z = Zn(m, E); if (Math.hypot(z.R, z.X) > r) lo = m; else hi = m; }
  const Q = Zn(Math.sqrt(lo * hi), E);
  ck('magnitude-only demo: lift-off and a conductivity drop reach the same |Z| at clearly different points', dist(P, Q) > 0.03, `end points ${dist(P, Q).toFixed(3)} apart`);
  ck('perfect conductor sits on the reactance axis below air', L1.XPC > 0.5 && L1.XPC < 0.7, `X = ${L1.XPC.toFixed(4)}`);
}

console.log('\n--- Lesson 2 (Frequency and Thickness) claims');
{
  const { Zm, deltaMils, sepDirs, THICK } = L2, Z = (iacs, kHz, mils) => Zm(iacs, kHz, mils, 0);
  // Check 1: thickness curve shape
  for (const f of [20, 50, 100]) {
    const s = 28, end = Z(s, f, THICK), dl = deltaMils(s, f), span = dist(air, end);
    const cond = []; for (let e = 3; e <= 10.5; e += 0.02) cond.push(L2.Zp(Math.pow(10, e), 0));
    const poly = cond.concat([{ R: 0, X: cond[cond.length - 1].X }, { R: 0, X: 1 }]);
    const inside = p => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.X > p.X) !== (b.X > p.X) && p.R < (b.R - a.R) * (p.X - a.X) / (b.X - a.X) + a.R) c = !c; } return c; };
    const pts = []; for (let k = 1; k <= 400; k++) pts.push(Z(s, f, k * 0.0125 * dl));
    const outside = pts.filter(p => !inside(p) && dist(p, end) > 1e-4).length;
    const A2 = L2.Zp(s * f * 1000 * 1.001, 0), t = { R: A2.R - end.R, X: A2.X - end.X };
    const proj = pts.map(p => (p.R - end.R) * t.R + (p.X - end.X) * t.X); let crossings = 0;
    for (let i = 1; i < proj.length; i++) if (Math.sign(proj[i]) !== Math.sign(proj[i - 1])) crossings++;
    const start = Z(s, f, 0.002 * dl);
    ck(`check 1, brass ${f} kHz: starts near air, swings outside the conductivity curve, hooks, settles`, dist(start, air) < 0.01 * span && outside > 20 && crossings >= 1 && dist(Z(s, f, 2 * dl), end) < 0.012 * span,
      `${outside}/400 points outside; crosses the end point's tangent ${crossings}x`);
  }
  // Check 2: equal steps shrink, nothing changes past ~3 standard depths
  {
    const f = 50, dl = deltaMils(28, f), end = Z(28, f, THICK), span = dist(air, end), pts = [Z(28, f, 1e-4)];
    for (let k = 1; k <= 24; k++) pts.push(Z(28, f, k * 0.25 * dl));
    const gaps = pts.slice(1).map((p, k) => dist(p, pts[k]) / span);
    ck('check 2: equal steps shrink and change under 0.2% per step past 3 standard depths', gaps.slice(3).every((g, k, a) => k === 0 || g <= a[k - 1] * 1.0001) && gaps.slice(12).every(g => g < 0.002) && dist(pts[12], end) / span < 0.002,
      `still to go at 1, 2, 3 depths: ${[4, 8, 12].map(k => (dist(pts[k], end) / span * 100).toFixed(2) + '%').join(', ')}`);
  }
  // Check 3: lower frequency spreads thickness points and needs more thickness to settle
  {
    const rows = [12.5, 25, 50, 100, 200].map(f => { const end = Z(28, f, THICK), span = dist(air, end); let settle = 0; for (let m = 0.5; m < 300; m += 0.5) if (dist(Z(28, f, m), end) < 0.01 * span) { settle = m; break; } let crowd = 0; for (let m = 2; m <= 60; m += 2) if (dist(Z(28, f, m), end) < 0.01 * span) crowd++; return { f, settle, crowd }; });
    ck('check 3: halving the frequency always needs more thickness to settle and piles up fewer points', rows.every((r, i) => i === 0 || (r.settle < rows[i - 1].settle && r.crowd >= rows[i - 1].crowd)), rows.map(r => `${r.f} kHz: ${r.settle} mils, ${r.crowd}/30 piled`).join('; '));
  }
  // Check 4: spread of high and low conductivity groups
  {
    const spread = (ks, f) => { let m = 0; for (let i = 1; i < ks.length; i++) m += dist(Z(ks[i], f, THICK), Z(ks[i - 1], f, THICK)); return m; };
    const hi = [100, 59, 30], lo = [2.4, 1.0, 0.11], near = f => Math.max(...lo.map(k => dist(Z(k, f, THICK), air)));
    ck('check 4: 10 kHz spreads Cu/Al 1100/Al 2024 and bunches 304/Ti/graphite at air; 1 MHz the reverse', spread(hi, 10) > 3 * spread(hi, 1000) && spread(lo, 1000) > 3 * spread(lo, 10) && near(10) < 0.03);
    const a = dist(Z(30, 10, THICK), Z(59, 10, THICK)), b = dist(Z(30, 1000, THICK), Z(59, 1000, THICK));
    ck('Step 2: "almost three times further apart" at 10 kHz than at 1 MHz', a / b > 2.5 && a / b < 3.2, `${(a / b).toFixed(2)}x`);
  }
  // Step 1 angles at 100 kHz
  {
    const g = k => sepDirs(k, 100).deg, v = { cu: g(100), al: g(59), ss: g(2.4), ti: g(1.0) };
    ck('Step 1: "about 44 on copper, 43 on pure aluminum, about 30 on 304, 25 on titanium"', Math.abs(v.cu - 44) < 1.5 && Math.abs(v.al - 43) < 1.5 && Math.abs(v.ss - 30) < 1.5 && Math.round(v.ti) === 25,
      Object.entries(v).map(([k, x]) => k + ' ' + x.toFixed(1)).join(', '));
  }
  // Step 3: 2-mil brass sheet at 50 kHz
  {
    const T = Z(28, 50, THICK), s2 = Z(28, 50, 2);
    ck('Step 3: standard depth of brass at 50 kHz is about 22 mils', Math.abs(deltaMils(28, 50) - 22) < 0.5, deltaMils(28, 50).toFixed(1));
    ck('Step 3: a 2-mil sheet is further left, higher and closer to air than thick brass', s2.R < T.R && s2.X > T.X && dist(s2, air) < dist(T, air));
    let mx = { R: 0 }; for (let m = 1; m <= 40; m += 0.5) { const z = Z(28, 50, m); if (z.R > mx.R) mx = { R: z.R, m }; }
    ck('Step 3: "by about ten mils it has swung out to the right"', mx.m >= 8 && mx.m <= 12 && mx.R > T.R + 0.03, `furthest right at ${mx.m} mils`);
    const span = dist(air, T);
    ck('Step 3: within 1% by 44 mils, nothing visible past 66 mils', dist(Z(28, 50, 44), T) < 0.0105 * span && dist(Z(28, 50, 66), T) < 0.002 * span);
  }
  // Step 4: brass vs 304 at 30 mils, 200 kHz
  {
    const mb = dist(Z(28, 200, 30), Z(28, 200, 31)), ms = dist(Z(2.4, 200, 30), Z(2.4, 200, 31));
    ck('Step 4: one more mil moves 304 about 11 times as far as brass', ms / mb > 8 && ms / mb < 14, `${(ms / mb).toFixed(1)}x`);
    ck('Step 4: standard depths "about thirty eight mils, against eleven for brass"', Math.abs(deltaMils(2.4, 200) - 37.5) < 1 && Math.abs(deltaMils(28, 200) - 11) < 0.5, `${deltaMils(2.4, 200).toFixed(1)} and ${deltaMils(28, 200).toFixed(1)}`);
  }
  // Step 5: 200 vs 400 kHz for 10 to 14 mils of brass
  {
    const g = f => dist(Z(28, f, 10), Z(28, f, 14)), e400 = Z(28, 400, THICK);
    ck('Step 5: 10 to 14 mils spread over about twice as much curve at 200 kHz as at 400 kHz', g(200) / g(400) > 1.8, `${(g(200) / g(400)).toFixed(2)}x`);
    ck('Step 5: at 400 kHz the 14-mil point is within about 1% of thick brass', dist(Z(28, 400, 14), e400) / dist(air, e400) < 0.015);
    ck('Step 5: standard depth about 11 mils at 200 kHz and under 8 at 400 kHz', Math.abs(deltaMils(28, 200) - 11) < 0.5 && deltaMils(28, 400) < 8);
  }
}
console.log('\n--- permeability extension checks');
{
  const { ZplateMu } = L3;
  let d1 = 0; for (const p of [3, 43, 100]) for (const f of [1e3, 1e5, 1e7]) for (const d of [Infinity, 0.3]) for (const l of [0, 0.5]) { const s = p / 100 * IACS; d1 = Math.max(d1, dist(ZplateMu(s, f, d, l, 1 + 1e-9), Zplate(s, f, d, l)), dist(ZplateMu(s, f, d, l, 1), Zplate(s, f, d, l))); }
  ck('mu_r = 1 gives the core result', d1 < 1e-9, d1.toExponential(1));
  const dc = [2, 10, 100].map(mu => { const z = ZplateMu(0.1 * IACS, 1, Infinity, 0, mu), K = (mu - 1) / (mu + 1); return { mu, model: z.X - 1, image: K * imageDrop, R: z.R }; });
  ck('zero frequency: reactance rise matches magnetic image theory, (mu-1)/(mu+1) times the filament sum, within 1%', dc.every(r => Math.abs(r.model / r.image - 1) < 0.01 && r.R < 1e-3), dc.map(r => `mu ${r.mu}: ${r.model.toFixed(4)} vs ${r.image.toFixed(4)}`).join('; '));
  const hf = [1e7, 1e8, 1e9].map(f => { const a = ZplateMu(0.1 * IACS, f, Infinity, 0, 100), b = Zplate(0.1 * IACS / 100, f, Infinity, 0), pc = Zplate(1e15, 1e7, Infinity, 0); return dist(a, b) / dist(b, pc); });
  ck('high frequency: steel approaches a nonmagnetic metal with conductivity sigma / mu_r', hf[1] < hf[0] && hf[2] < hf[1] && hf[2] < 0.005, hf.map(x => (x * 100).toFixed(2) + '%').join(' -> '));
  let neg = 0; for (const mu of [1.5, 10, 100, 1000]) for (const p of [1, 10, 100]) for (let e = 1; e <= 8; e += 0.5) for (const d of [Infinity, 1, 0.05]) for (const l of [0, 0.3]) if (ZplateMu(p / 100 * IACS, 10 ** e, d, l, mu).R < -1e-12) neg++;
  ck('resistance never negative for magnetic plates', neg === 0);
  const s = 0.1 * IACS, dl = L3.depthMuMM(10, 100, 100);
  ck('magnetic plate 25 standard depths thick equals the half-space; zero thickness gives air', dist(ZplateMu(s, 1e5, Infinity, 0, 100), ZplateMu(s, 1e5, 25 * dl, 0, 100)) < 1e-9 && dist(ZplateMu(s, 1e5, 1e-7, 0, 100), air) < 1e-4);
}

console.log('\n--- Lesson 3 (Steel and Signal Separation) claims');
{
  const { Zs, dirLift, dirMuDown, dirSigDown, dirThin, thinSize, depthMuMM, STEEL_MU, STEEL_IACS, angleBetween, degOf, diffZ } = L3;
  const ST = (kHz, lift, mu, dmm) => Zs(STEEL_IACS, kHz, lift || 0, mu || STEEL_MU, dmm), AL = (kHz, lift, iacs) => Zs(iacs || 43, kHz, lift || 0, 1), CU = kHz => Zs(100, kHz, 0, 1);
  const axis = (u, v) => { const d = angleBetween(u, v); return d > 90 ? 180 - d : d; };
  const num = re => +L3main.match(re)[1];
  const EDGE_TURN = num(/EDGE_TURN = (-?[\d.]+)/), CRACK_TURN = num(/CRACK_TURN = (-?[\d.]+)/), METER_FS = num(/METER_FS = ([\d.]+)/);
  ck('assumption shown on the page: steel is 10 %IACS with mu_r = 100', STEEL_IACS === 10 && STEEL_MU === 100 && /mu_r = 100|&mu;<sub>r<\/sub> = 100/.test(L3main));
  // check 1
  const fr = [0.1, 1, 10, 100, 1000];
  ck('check 1: steel sits above the air line from 100 Hz to 1 MHz; aluminum and copper below', fr.every(k => ST(k).X > 1 && AL(k).X < 1 && CU(k).X < 1), fr.map(k => `${k} kHz steel X ${ST(k).X.toFixed(3)}`).join(', '));
  ck('Step 1: "about twenty six percent above air" at 100 kHz', ST(100).X > 1.24 && ST(100).X < 1.28, ST(100).X.toFixed(3));
  // check 2
  {
    const mono = (fz, sx) => { let prev = fz(0), ok = true; for (let m = 1; m <= 200; m++) { const z = fz(m * 0.1); if (z.R > prev.R + 1e-12 || sx * (z.X - prev.X) < -1e-12) ok = false; prev = z; } return ok; };
    const ts = dirLift(STEEL_IACS, 100, STEEL_MU), ta = dirLift(43, 100, 1);
    ck('check 2: lift-off from steel moves the dot down and left all the way to 20 mils', ts.R < 0 && ts.X < 0 && mono(l => ST(100, l), -1), `starts at ${degOf(ts).toFixed(0)} deg`);
    ck('check 2: lift-off from aluminum moves it up and left all the way', ta.R < 0 && ta.X > 0 && mono(l => AL(100, l), 1), `starts at ${degOf(ta).toFixed(0)} deg`);
  }
  // check 3, with the frequency dependence the lesson relies on
  {
    const g = k => angleBetween(dirLift(STEEL_IACS, k, STEEL_MU), dirMuDown(STEEL_IACS, k, STEEL_MU)), v = { f100Hz: g(0.1), f1k: g(1), f10k: g(10), f100k: g(100) };
    ck('check 3: on steel at 100 Hz, lift-off and a permeability drop point within a small angle ("about five degrees")', Math.round(v.f100Hz) === 5, v.f100Hz.toFixed(1) + ' deg');
    ck('Steps 2 and 3: "thirty at one kilohertz", "about forty by ten kilohertz", "about forty" at 100 kHz', Math.round(v.f1k) === 30 && Math.abs(v.f10k - 40) < 1.5 && Math.abs(v.f100k - 40) < 2, Object.entries(v).map(([k, x]) => k + ' ' + x.toFixed(1)).join(', '));
    const mc = angleBetween(dirMuDown(STEEL_IACS, 100, STEEL_MU), { R: -dirSigDown(STEEL_IACS, 100, STEEL_MU).R, X: -dirSigDown(STEEL_IACS, 100, STEEL_MU).X });
    ck('Step 2: at 100 kHz "a permeability drop looks exactly like a rise in conductivity"', mc < 1, mc.toFixed(2) + ' deg');
  }
  // check 4: the bridge meter
  {
    const A = AL(100), B = AL(100, 0, 30), u = dirLift(43, 100, 1), n0 = { R: -u.X, X: u.R }, n = n0.R > 0 ? n0 : { R: -n0.R, X: -n0.X };
    const at = (P, v, s) => ({ R: P.R + v.R * s, X: P.X + v.X * s }), rd = (z, D) => dist(z, D);
    const Dg = at(A, n, 0.1), Db = at(A, n, -0.1), Df = at(A, n, 0.25), Dl = at(A, u, -0.1), d0 = rd(A, Dg);
    const lift2 = rd(AL(100, 2), Dg) - d0, ab = rd(B, Dg) - d0;
    ck('check 4: with D on the perpendicular, 2 mils of lift-off barely changes the reading ("about three percent") while A to B does ("about thirteen")', Math.abs(lift2 / d0 - 0.03) < 0.012 && Math.abs(-ab / d0 - 0.13) < 0.015 && Math.abs(ab) > 3 * Math.abs(lift2), `lift-off ${(lift2 / d0 * 100).toFixed(1)}%, A to B ${(ab / d0 * 100).toFixed(1)}%`);
    ck('check 4: 1 mil of lift-off changes it by under a tenth of the alloy change', Math.abs(rd(AL(100, 1), Dg) - d0) < 0.1 * Math.abs(ab));
    ck('Step 4: with D on the lift-off path, 2 mils of lift-off moves the reading more than the alloy change', Math.abs(rd(AL(100, 2), Dl) - rd(A, Dl)) > Math.abs(rd(B, Dl) - rd(A, Dl)));
    ck('Step 4: a farther D hugs lift-off better but drives the needle off scale', Math.abs(rd(AL(100, 2), Df) - rd(A, Df)) < Math.abs(lift2) && rd(A, Df) > METER_FS && d0 < METER_FS);
    ck('Checkpoint 4C: B sits higher on the curve; D above the curve: the reading goes down; D below: it goes up', B.X > A.X && rd(B, Dg) < rd(A, Dg) && rd(B, Db) > rd(A, Db));
    const c = dirSigDown(43, 100, 1), m0 = { R: c.X, X: -c.R }, Dc = at(A, m0.R > 0 ? m0 : { R: -m0.R, X: -m0.X }, 0.1), e0 = rd(A, Dc);
    const alloyMax = Math.max(Math.abs(rd(AL(100, 0, 41), Dc) - e0), Math.abs(rd(AL(100, 0, 45), Dc) - e0)), coat = Math.abs(rd(AL(100, 2), Dc) - e0);
    ck('Step 4 reverse trick: D at right angles to the conductivity curve ignores 41 to 45 %IACS but reads a 2-mil coating', alloyMax < 0.001 && coat > 0.01, `alloy ${alloyMax.toFixed(4)}, coating ${coat.toFixed(4)}`);
  }
  // check 5
  {
    const steps = f => { const o = []; for (let i = 0; i < 6; i++) o.push(dist(f(5 * i), f(5 * (i + 1)))); return o; };
    const s = steps(l => ST(100, l)), a = steps(l => AL(100, l)), dec = x => x.every((v, i) => i === 0 || v < x[i - 1]);
    ck('check 5: equal 5-mil lift-off steps make shrinking moves on steel and aluminum', dec(s) && dec(a), s.map(x => x.toFixed(4)).join(', '));
    ck('Step 6: "the first five mils move the dot about forty percent further than the next five"', s[0] / s[1] > 1.3 && s[0] / s[1] < 1.5, (s[0] / s[1]).toFixed(2) + 'x');
    const th = []; for (let d = 30; d > 6; d -= 4) th.push(dist(Zs(43, 100, 0, 1, d * L3.MIL), Zs(43, 100, 0, 1, (d - 4) * L3.MIL)));
    ck('Step 6: thinning a 6061 sheet in equal steps makes growing moves (nonlinear the other way)', th.every((v, i) => i === 0 || v > th[i - 1]));
  }
  // Step 3: frequency rotates phase, steel's thin skin and the thin-sheet example
  {
    const ph = (z) => degOf(diffZ(air, z));
    ck('Step 3: aluminum\'s arrow goes from nearly flat (100 Hz) to nearly straight down (1 MHz); steel\'s from straight up, leaning right and down', Math.abs(ph(AL(0.1))) < 15 && ph(AL(1000)) < -80 && ph(ST(0.1)) > 85 && ph(ST(1000)) < 30 && ph(ST(1000)) > 0,
      `Al ${ph(AL(0.1)).toFixed(0)} to ${ph(AL(1000)).toFixed(0)}, steel ${ph(ST(0.1)).toFixed(0)} to ${ph(ST(1000)).toFixed(0)}`);
    ck('Step 3: standard depth about seven hundredths of a millimeter in steel at 100 kHz, a third of a millimeter in 6061', Math.abs(depthMuMM(STEEL_IACS, 100, STEEL_MU) - 0.07) < 0.008 && Math.abs(depthMuMM(43, 100, 1) - 0.33) < 0.03,
      `${depthMuMM(STEEL_IACS, 100, STEEL_MU).toFixed(3)} and ${depthMuMM(43, 100, 1).toFixed(3)} mm`);
    const sep = k => axis(dirLift(STEEL_IACS, k, STEEL_MU, 0.3), dirThin(STEEL_IACS, k, STEEL_MU, 0.3)), size = k => thinSize(STEEL_IACS, k, STEEL_MU, 0.3);
    ck('Step 3: 0.3 mm steel sheet, lift-off vs thinning "eight degrees at 1 kHz, seventy nine at 10, fifteen at 30"', Math.round(sep(1)) === 8 && Math.round(sep(10)) === 79 && Math.round(sep(30)) === 15, [1, 10, 30].map(k => sep(k).toFixed(1)).join(', '));
    ck('Step 3: it separates best near 10 kHz', [2, 3, 5, 7, 15, 20, 30].every(k => sep(k) < sep(10)));
    ck('Step 3: above 30 kHz the signal fades away, and by 100 kHz it is gone', size(30) < 0.3 * size(1) && size(50) < 0.15 * size(1) && size(100) < 0.02 * size(1), [1, 10, 30, 50, 100].map(k => size(k).toExponential(1)).join(', '));
  }
  // illustrative paths point the way the script describes
  {
    const sepA = angleBetween(dirLift(43, 100, 1), dirSigDown(43, 100, 1));
    ck('illustrative crack: between lift-off and a conductivity drop', CRACK_TURN < 0 && -CRACK_TURN < sepA, `${-CRACK_TURN} of ${sepA.toFixed(1)} deg`);
    ck('illustrative edge: a small angle off lift-off, toward the conductivity-drop side', EDGE_TURN < 0 && -EDGE_TURN <= 15);
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
