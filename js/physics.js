// Физические константы (СИ)
const G = 6.674e-11;
const C = 2.998e8;
const MSUN = 1.989e30;
const HBAR = 1.0546e-34;
const KB = 1.3807e-23;
const YEAR = 3.156e7;
const AU = 1.496e11;
const LY = 9.461e15;

// Радиус Шварцшильда, м
function schwarzschildRadius(M) { return 2 * G * M / (C * C); }

// ISCO для Керра (прогрейд), в единицах rs
function iscoRadius(spin) {
  const a = spin;
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const rIscoM = 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2)); // в GM/c²
  return rIscoM / 2; // в rs
}

// Температура Хокинга, К
function hawkingTemp(M) { return HBAR * C * C * C / (8 * Math.PI * G * M * KB); }

// Время испарения, с
function evaporationTime(M) { return 8.41e-17 * M * M * M; }

// Характерная температура диска, К: T ∝ M^-1/4 (Шакура—Сюняев);
// нормировка ~1e7 К для 10 M☉ — типичный, а не эддингтоновский темп аккреции
function diskTempEstimate(M) {
  return 1e7 * Math.pow(M / MSUN, -0.25);
}

// Круговая орбитальная скорость (Ньютон), м/с
function circularVelocity(M, r) { return Math.sqrt(G * M / r); }

// Приливный радиус разрушения объекта (радиус Роша), м
function tidalRadius(Mbh, mObj, rObj) {
  if (mObj <= 0 || rObj <= 0) return 0;
  return rObj * Math.cbrt(2 * Mbh / mObj);
}

// ---- Форматирование ----
function fmtExp(x, digits = 2) {
  if (!isFinite(x)) return '∞';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 5) return x.toPrecision(3).replace(/\.?0+$/, '');
  const m = x / Math.pow(10, e);
  return m.toFixed(digits) + '×10' + supNum(e);
}

function supNum(n) {
  const sup = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n).split('').map(c => sup[c] || c).join('');
}

function fmtMass(kg) {
  const ms = kg / MSUN;
  if (ms >= 0.01) return fmtExp(ms) + ' M☉';
  const me = kg / 5.97e24;
  if (me >= 0.001) return fmtExp(me) + ' M⊕';
  return fmtExp(kg) + ' ' + T('uKg');
}

function fmtLength(m) {
  if (m < 1e3) return fmtExp(m) + ' ' + T('uM');
  if (m < 0.1 * AU) return fmtExp(m / 1e3) + ' ' + T('uKm');
  if (m < 0.5 * LY) return fmtExp(m / AU) + ' ' + T('uAU');
  return fmtExp(m / LY) + ' ' + T('uLY');
}

function fmtTime(s) {
  if (s < 1e-3) return fmtExp(s) + ' ' + T('uSec');
  if (s < 120) return fmtExp(s) + ' ' + T('uSec');
  if (s < 7200) return fmtExp(s / 60) + ' ' + T('uMin');
  if (s < 172800) return fmtExp(s / 3600) + ' ' + T('uHour');
  if (s < 2 * YEAR) return fmtExp(s / 86400) + ' ' + T('uDay');
  return fmtExp(s / YEAR) + ' ' + T('uYear');
}

function fmtTemp(K) {
  if (K < 1e-3) return fmtExp(K * 1e9) + ' ' + T('uNK');
  return fmtExp(K) + ' ' + T('uK');
}
