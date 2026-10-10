/* ===== Physics: Dodd and Deeds (1968) analytical model =====
   An air-core circular coil above a nonmagnetic conducting plate of thickness d, with air behind it.
   Coil (mm): inner radius r1, outer radius r2, height h. A wear face keeps it COIL.wear above the part at contact;
   lift-off adds to that gap. Impedance is normalized to the coil-in-air reactance, so air sits at (0, 1):
     Zn = j (1 + I / I0)
     I  = integral_0^inf G(a) A(a) Rf(a) da,       I0 = integral_0^inf G(a) 2 (a h + e^(-a h) - 1) da
     G  = P(a)^2 / a^6,   P(a) = integral from a r1 to a r2 of x J1(x) dx,   A = (e^(-a l1) - e^(-a l2))^2
     Rf = (a^2 - a1^2)(1 - e^(-2 a1 d)) / ((a + a1)^2 - (a - a1)^2 e^(-2 a1 d)),   a1 = sqrt(a^2 + j w mu0 sigma)
   with l1 = wear face + lift-off and l2 = l1 + h. Simpson's rule on a = u^2 (160 steps) and Gauss-Legendre for P
   keep the error under 1e-7. tools/eddy/check_dodd_deeds.cjs checks this against an independent image-coil
   filament sum, the thick-plate and thin-sheet limits, passivity, and the claims each lesson makes. */
var COIL = { r1: 1.0, r2: 2.0, h: 1.0, wear: 0.1 };
var MU0 = 4e-7 * Math.PI, SIGMA_IACS = 5.8e7; /* 100 %IACS = 58.0 MS/m */
function besselJ1(x) { /* rational and asymptotic approximations, absolute error about 1e-8 */
  var ax = Math.abs(x), y, a1, a2, r;
  if (ax < 8) {
    y = x * x;
    a1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
    a2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a1 / a2;
  }
  var z = 8 / ax, xx = ax - 2.356194491; y = z * z;
  a1 = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
  a2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  r = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a1 - z * Math.sin(xx) * a2);
  return x < 0 ? -r : r;
}
var DD = (function () {
  var GX = [-0.9739065285, -0.8650633667, -0.6794095683, -0.4333953941, -0.1488743390, 0.1488743390, 0.4333953941, 0.6794095683, 0.8650633667, 0.9739065285];
  var GW = [0.0666713443, 0.1494513492, 0.2190863625, 0.2692667193, 0.2955242247, 0.2955242247, 0.2692667193, 0.2190863625, 0.1494513492, 0.0666713443];
  function intXJ1(a, b) { /* integral of x J1(x) from a to b, Gauss-Legendre on unit-length panels */
    var n = Math.max(1, Math.ceil(b - a)), w = (b - a) / n, s = 0;
    for (var k = 0; k < n; k++) { var m = a + (k + 0.5) * w; for (var i = 0; i < 10; i++) { var x = m + 0.5 * w * GX[i]; s += GW[i] * x * besselJ1(x); } }
    return s * 0.5 * w;
  }
  var N = 160, umax = Math.sqrt(40 / COIL.r1), du = umax / N, a = [], w = [], I0 = 0;
  for (var i = 1; i <= N; i++) { /* i = 0 has zero weight because da = 2u du */
    var u = i * du, al = u * u, P = intXJ1(al * COIL.r1, al * COIL.r2);
    var wt = (i === N ? 1 : (i % 2 ? 4 : 2)) * du / 3 * 2 * u * P * P / Math.pow(al, 6);
    a.push(al); w.push(wt);
    I0 += wt * 2 * (al * COIL.h + Math.exp(-al * COIL.h) - 1);
  }
  return { a: a, w: w, I0: I0 };
})();
var zCache = {}, zCount = 0;
/* sigma in S/m, fHz in Hz, dmm = plate thickness in mm (Infinity or 1e5 and above = thick), lift = lift-off in mm above the
   wear face (Infinity = coil in air). Returns {R, X}, normalized. Results are cached: do not modify the returned object. */
function Zplate(sigma, fHz, dmm, lift) {
  if (!(lift < 1e4) || !(sigma > 0) || !(fHz > 0) || !(dmm > 0)) return { R: 0, X: 1 };
  var key = sigma + '|' + fHz + '|' + dmm + '|' + lift, hit = zCache[key];
  if (hit) return hit;
  var k2 = 2 * Math.PI * fHz * MU0 * sigma * 1e-6, l1 = COIL.wear + lift, l2 = l1 + COIL.h, thick = !(dmm < 1e5), sr = 0, si = 0;
  for (var i = 0; i < DD.a.length; i++) {
    var al = DD.a[i], A = Math.exp(-al * l1) - Math.exp(-al * l2), g = DD.w[i] * A * A;
    var r = Math.hypot(al * al, k2), qr = Math.sqrt((r + al * al) / 2), qi = Math.sqrt(Math.max(0, (r - al * al) / 2));
    var Rr, Ri, nr, ni, dr, di, dd;
    if (thick) { /* (a - a1) / (a + a1) */
      nr = al - qr; ni = -qi; dr = al + qr; di = qi; dd = dr * dr + di * di;
      Rr = (nr * dr + ni * di) / dd; Ri = (ni * dr - nr * di) / dd;
    } else {
      var e = Math.exp(-2 * qr * dmm), ph = -2 * qi * dmm, er = e * Math.cos(ph), ei = e * Math.sin(ph);
      var Nr = -ei * k2, Ni = -(1 - er) * k2; /* (1 - E)(-j k2) */
      var pr = al + qr, pi = qi, mr = al - qr, mi = -qi;
      var p2r = pr * pr - pi * pi, p2i = 2 * pr * pi, m2r = mr * mr - mi * mi, m2i = 2 * mr * mi;
      dr = p2r - (m2r * er - m2i * ei); di = p2i - (m2r * ei + m2i * er); dd = dr * dr + di * di;
      Rr = (Nr * dr + Ni * di) / dd; Ri = (Ni * dr - Nr * di) / dd;
    }
    sr += g * Rr; si += g * Ri;
  }
  var z = { R: -si / DD.I0, X: 1 + sr / DD.I0 };
  if (++zCount > 60000) { zCache = {}; zCount = 0; }
  zCache[key] = z;
  return z;
}
/* Standard depth of penetration in mm for a nonmagnetic metal: delta = 1 / sqrt(pi f mu0 sigma) = 503 / sqrt(f sigma) */
function depthMM(iacs, kHz) { return 503 / Math.sqrt(kHz * 1e3 * iacs / 100 * SIGMA_IACS) * 1000; }
