// Интернационализация. Русский — исходный язык (source of truth).
// Английские словари заполняет суб-агент translator (.cursor/agents/translator.md).

let LANG = (function () {
  try { return localStorage.getItem('bh-lang') || 'ru'; } catch (e) { return 'ru'; }
})();

const I18N = {
  ru: {
    docTitle: 'Симулятор чёрной дыры',
    needWebgl: 'Нужен WebGL2. Обновите браузер.',
    appTitle: '⚫ Симулятор чёрной дыры',

    // панели
    sumPresets: 'Пресеты',
    btnApply: 'Применить',
    sumBH: 'Параметры чёрной дыры',
    lblMass: 'Масса:',
    lblDiam: 'Диаметр горизонта (км):',
    btnOK: 'OK',
    lblSpin: 'Спин (a/M):',
    chkErgo: 'Эргосфера (видна при спине)',
    chkField: 'Магнитные линии полюсов',
    sumDisk: 'Аккреционный диск',
    chkDiskOn: 'Диск включён',
    lblDiskPreset: 'Пресет плазмы:',
    lblDiskIn: 'Внутренний радиус:',
    lblDiskOut: 'Внешний радиус:',
    lblDiskBright: 'Яркость:',
    lblDiskTemp: 'Температура плазмы:',
    hintDisk: 'Температура и цвет плазмы автоматически меняются от массы ЧД и поглощённого вещества.',
    sumSpawn: 'Спавн объектов',
    lblCat: 'Категория:',
    lblObj: 'Объект:',
    lblSpawnD: 'Дистанция спавна:',
    lblOrbit: 'Траектория:',
    orbCirc: 'Круговая орбита',
    orbEll: 'Эллипс (падающий)',
    orbSteep: 'Крутое падение',
    orbFree: 'Свободное падение',
    orbHyp: 'Гипербола (пролёт)',
    btnSpawn: 'Заспавнить',
    btnClear: 'Очистить всё',
    btnBinary: 'Двойная звезда',
    btnSystem: 'Планетная система',
    sumMerger: 'Слияние чёрных дыр',
    lblM2: 'Масса второй ЧД:',
    lblSep: 'Начальное разделение:',
    lblTmerge: 'Длительность инспирала (с):',
    btnMergeStart: 'Запустить слияние',
    btnMergeStop: 'Отмена',
    hintMerger: 'Инспирал по Петерсу (излучение гравитационных волн), ~5% массы уносится ГВ при слиянии.',
    sumSim: 'Симуляция и графика',
    lblTS: 'Ускорение времени:',
    chkPause: 'Пауза',
    lblQuality: 'Качество рендера:',
    qPoop: '💩 (ещё хуже)',
    qPotato: 'Картошка (минимум)',
    qLow: 'Низкое (быстро)',
    qMed: 'Среднее',
    qHigh: 'Высокое',
    qUltra: 'Ультра (суперсэмплинг)',
    qAbsurd: 'Абсурд (без компромиссов)',
    qWhy: 'Почему?... (максимум максимумов)',
    chkReal: 'Реальные размеры объектов',
    chkTrails: 'Следы орбит (прецессия)',
    btnShare: 'Поделиться сценой',
    hInfo: 'Физика',

    // подсказки и режимы
    hintDefault: 'ЛКМ — камера · Колесо — зум · Пробел — пауза · H — интерфейс · C — кино · F — полёт · I — погружение · P — скриншот · R — запись · 1–8 — качество',
    hintFly: 'WASD — полёт · QE — вверх/вниз · Shift — ускорение · Колесо — скорость · F — выход',
    hintImm: 'Мышь/свайп — осматриваться · Esc — выход',
    shareCopied: 'Ссылка скопирована в буфер обмена.',
    shareManual: 'Ссылка в адресной строке — скопируйте её.',

    // погружение
    immTitle: '🧑‍🚀 Погружение',
    immHint: 'Свободное падение в чёрную дыру от первого лица в реальном масштабе времени — почувствуй её размер. Мышь или свайп — осматриваться, на телефоне работает гироскоп. Esc — выход.',
    immDist: 'Начальная дистанция:',
    immSpeed: 'Скорость времени:',
    immSp0125: '×0.125 (очень медленно)',
    immSp025: '×0.25',
    immSp05: '×0.5 (замедленно)',
    immSp1: '×1 — реальное время',
    immSp5: '×5',
    immSp30: '×30',
    immSp300: '×300',
    immSp1000: '×1000',
    immSp10000: '×10000',
    immSp100k: '×100 000',
    immSp1m: '×1 000 000',
    immStart: 'Начать падение',
    immCancel: 'Отмена',
    etaFall: 'Время падения: <b>{t}</b> реального времени',
    etaYou: ' · для вас: <b>{t}</b>',
    hudHorizon: 'горизонт через {t}',
    hudInside: 'внутри горизонта',
    hudDoom: 'разрушение через {t}',
    immHudChk: 'Дополнительный HUD скафандра',
    immSndChk: 'Дополнительные звуки (сирена, отказ систем)',
    sTau: 'Время миссии',
    sPulse: 'Пульс',
    sO2: 'O₂',
    sSignal: 'Связь',
    sIntegr: 'Целостность',
    sTidal: 'Прилив',
    sNoSignal: 'СИГНАЛ ПОТЕРЯН',

    // кнопки-FAB (title)
    tVR: 'VR-режим (шлем, WebXR)',
    tImm: 'Погружение — падение в дыру (I)',
    tCine: 'Кинорежим (C)',
    tFly: 'Свободный полёт (F)',
    tShot: 'Скриншот (P)',
    tRec: 'Запись видео (R)',
    tUIHide: 'Скрыть интерфейс (H)',
    tUIShow: 'Показать интерфейс (H)',
    tLang: 'Switch to English',

    // список объектов и информация о них
    accreting: 'поглощается',
    penrose: '⚡ Пенроуз',
    moreObj: '…и ещё {n}',
    objMass: 'Масса:',
    objRadius: 'Радиус:',
    noTidal: 'не разрушается приливами',
    tidalInside: 'приливный захват внутри горизонта',
    tidalAt: 'приливный захват на ~{r} rs',
    tidalWarn: '⚠ объект сразу начнёт медленно поглощаться',

    // инфопанель
    iMass: 'Масса',
    iHorizon: 'Радиус горизонта r<sub>s</sub>',
    iDiam: 'Диаметр',
    iPhoton: 'Фотонная сфера',
    iISCO: 'ISCO (спин {s})',
    iTisco: 'Период орбиты на ISCO',
    iHawking: 'Темп. Хокинга',
    iEvap: 'Время испарения',
    iDens: 'Средняя плотность',
    iKappa: 'Поверхн. гравитация κ',
    iTidal: 'Прилив (тело 2 м у r<sub>s</sub>)',
    iDilation: 'Замедление времени на 2 r<sub>s</sub>',
    iObjects: 'Объектов в сцене',
    iMergerHdr: '— Слияние —',
    iM2: 'Масса ЧД₂',
    iSep: 'Разделение',
    iFgw: 'Частота ГВ (физ.)',
    gwChirp: 'Гравитационная волна h(t) — чирп',
    gwRingdown: 'Слияние завершено. Рингдаун…',

    // единицы измерения
    uSec: 'с', uMin: 'мин', uHour: 'ч', uDay: 'дней', uYear: 'лет',
    uKg: 'кг', uM: 'м', uKm: 'км', uAU: 'а.е.', uLY: 'св. лет',
    uK: 'К', uNK: 'нК', uKgM3: 'кг/м³', uMS2: 'м/с²', uHz: 'Гц',
  },

  en: {
    docTitle: 'Black Hole Simulator',
    needWebgl: 'WebGL2 required. Please update your browser.',
    appTitle: '⚫ Black Hole Simulator',

    sumPresets: 'Presets',
    btnApply: 'Apply',
    sumBH: 'Black hole parameters',
    lblMass: 'Mass:',
    lblDiam: 'Horizon diameter (km):',
    btnOK: 'OK',
    lblSpin: 'Spin (a/M):',
    chkErgo: 'Ergosphere (visible when spinning)',
    chkField: 'Polar magnetic field lines',
    sumDisk: 'Accretion disk',
    chkDiskOn: 'Disk enabled',
    lblDiskPreset: 'Plasma preset:',
    lblDiskIn: 'Inner radius:',
    lblDiskOut: 'Outer radius:',
    lblDiskBright: 'Brightness:',
    lblDiskTemp: 'Plasma temperature:',
    hintDisk: 'Plasma temperature and color adjust automatically with BH mass and accreted matter.',
    sumSpawn: 'Spawn objects',
    lblCat: 'Category:',
    lblObj: 'Object:',
    lblSpawnD: 'Spawn distance:',
    lblOrbit: 'Trajectory:',
    orbCirc: 'Circular orbit',
    orbEll: 'Ellipse (infall)',
    orbSteep: 'Steep infall',
    orbFree: 'Free fall',
    orbHyp: 'Hyperbola (flyby)',
    btnSpawn: 'Spawn',
    btnClear: 'Clear all',
    btnBinary: 'Binary star',
    btnSystem: 'Planetary system',
    sumMerger: 'Black hole merger',
    lblM2: 'Second BH mass:',
    lblSep: 'Initial separation:',
    lblTmerge: 'Inspiral duration (s):',
    btnMergeStart: 'Start merger',
    btnMergeStop: 'Cancel',
    hintMerger: 'Peters inspiral (gravitational-wave emission); ~5% of mass radiated as GWs at merger.',
    sumSim: 'Simulation & graphics',
    lblTS: 'Time scale:',
    chkPause: 'Pause',
    lblQuality: 'Render quality:',
    qPoop: '💩 (even worse)',
    qPotato: 'Potato (minimum)',
    qLow: 'Low (fast)',
    qMed: 'Medium',
    qHigh: 'High',
    qUltra: 'Ultra (supersampling)',
    qAbsurd: 'Absurd (no compromises)',
    qWhy: 'Why?... (maximum of maximums)',
    chkReal: 'True object sizes',
    chkTrails: 'Orbit trails (precession)',
    btnShare: 'Share scene',
    hInfo: 'Physics',

    hintDefault: 'LMB — camera · Wheel — zoom · Space — pause · H — UI · C — cinema · F — fly · I — immersion · P — screenshot · R — record · 1–8 — quality',
    hintFly: 'WASD — fly · QE — up/down · Shift — boost · Wheel — speed · F — exit',
    hintImm: 'Mouse/swipe — look around · Esc — exit',
    shareCopied: 'Link copied to clipboard.',
    shareManual: 'Link is in the address bar — copy it.',

    immTitle: '🧑‍🚀 Immersion',
    immHint: 'Free fall into a black hole in first person at real time scale — feel its size. Mouse or swipe to look around; gyro on mobile. Esc — exit.',
    immDist: 'Starting distance:',
    immSpeed: 'Time speed:',
    immSp0125: '×0.125 (very slow)',
    immSp025: '×0.25',
    immSp05: '×0.5 (slow)',
    immSp1: '×1 — real time',
    immSp5: '×5',
    immSp30: '×30',
    immSp300: '×300',
    immSp1000: '×1000',
    immSp10000: '×10000',
    immSp100k: '×100,000',
    immSp1m: '×1,000,000',
    immStart: 'Start fall',
    immCancel: 'Cancel',
    etaFall: 'Fall time: <b>{t}</b> real time',
    etaYou: ' · for you: <b>{t}</b>',
    hudHorizon: 'horizon in {t}',
    hudInside: 'inside the horizon',
    hudDoom: 'destruction in {t}',
    immHudChk: 'Extra spacesuit HUD',
    immSndChk: 'Extra sounds (alarm, system failure)',
    sTau: 'Mission time',
    sPulse: 'Pulse',
    sO2: 'O₂',
    sSignal: 'Signal',
    sIntegr: 'Integrity',
    sTidal: 'Tidal',
    sNoSignal: 'SIGNAL LOST',

    tVR: 'VR mode (headset, WebXR)',
    tImm: 'Immersion — fall into the hole (I)',
    tCine: 'Cinema mode (C)',
    tFly: 'Free flight (F)',
    tShot: 'Screenshot (P)',
    tRec: 'Record video (R)',
    tUIHide: 'Hide UI (H)',
    tUIShow: 'Show UI (H)',
    tLang: 'Switch to Russian',

    accreting: 'accreting',
    penrose: '⚡ Penrose',
    moreObj: '…and {n} more',
    objMass: 'Mass:',
    objRadius: 'Radius:',
    noTidal: 'tidal disruption unlikely',
    tidalInside: 'tidal capture inside horizon',
    tidalAt: 'tidal capture at ~{r} rs',
    tidalWarn: '⚠ object will begin slow accretion immediately',

    iMass: 'Mass',
    iHorizon: 'Horizon radius r<sub>s</sub>',
    iDiam: 'Diameter',
    iPhoton: 'Photon sphere',
    iISCO: 'ISCO (spin {s})',
    iTisco: 'Orbital period at ISCO',
    iHawking: 'Hawking temp.',
    iEvap: 'Evaporation time',
    iDens: 'Mean density',
    iKappa: 'Surface gravity κ',
    iTidal: 'Tidal force (2 m body at r<sub>s</sub>)',
    iDilation: 'Time dilation at 2 r<sub>s</sub>',
    iObjects: 'Objects in scene',
    iMergerHdr: '— Merger —',
    iM2: 'BH₂ mass',
    iSep: 'Separation',
    iFgw: 'GW frequency (phys.)',
    gwChirp: 'Gravitational wave h(t) — chirp',
    gwRingdown: 'Merger complete. Ringdown…',

    uSec: 's', uMin: 'min', uHour: 'h', uDay: 'days', uYear: 'years',
    uKg: 'kg', uM: 'm', uKm: 'km', uAU: 'AU', uLY: 'ly',
    uK: 'K', uNK: 'nK', uKgM3: 'kg/m³', uMS2: 'm/s²', uHz: 'Hz',
  },
};

// Английские имена объектов каталога (ключ — русское имя из catalog.js)
const NAME_EN = {
  'Церера': 'Ceres',
  'Веста': 'Vesta',
  'Паллада': 'Pallas',
  'Гигея': 'Hygiea',
  'Комета Галлея': "Halley's Comet",
  'Комета Чурюмова—Герасименко': 'Comet Churyumov–Gerasimenko',
  'Бенну': 'Bennu',
  'Апофис': 'Apophis',
  'Оумуамуа': "'Oumuamua",
  'Луна': 'Moon',
  'Ио': 'Io',
  'Европа': 'Europa',
  'Ганимед': 'Ganymede',
  'Каллисто': 'Callisto',
  'Титан': 'Titan',
  'Энцелад': 'Enceladus',
  'Тритон': 'Triton',
  'Харон': 'Charon',
  'Фобос': 'Phobos',
  'Меркурий': 'Mercury',
  'Венера': 'Venus',
  'Земля': 'Earth',
  'Марс': 'Mars',
  'Юпитер': 'Jupiter',
  'Сатурн': 'Saturn',
  'Уран': 'Uranus',
  'Нептун': 'Neptune',
  'Плутон': 'Pluto',
  'Kepler-452b (суперземля)': 'Kepler-452b (super-Earth)',
  '51 Pegasi b (горячий юпитер)': '51 Pegasi b (hot Jupiter)',
  'TRAPPIST-1e': 'TRAPPIST-1e',
  'Проксима Центавра (красный карлик)': 'Proxima Centauri (red dwarf)',
  'Коричневый карлик': 'Brown dwarf',
  'Солнце': 'Sun',
  'Сириус A': 'Sirius A',
  'Вега': 'Vega',
  'Альтаир': 'Altair',
  'Альдебаран (красный гигант)': 'Aldebaran (red giant)',
  'Арктур': 'Arcturus',
  'Ригель (голубой сверхгигант)': 'Rigel (blue supergiant)',
  'Бетельгейзе (красный сверхгигант)': 'Betelgeuse (red supergiant)',
  'UY Щита (гипергигант)': 'UY Scuti (hypergiant)',
  'Голубой гигант (O-класс)': 'Blue giant (O-type)',
  'Белый карлик (Сириус B)': 'White dwarf (Sirius B)',
  'Нейтронная звезда': 'Neutron star',
  'Магнетар': 'Magnetar',
  'Пульсар (маяк)': 'Pulsar (beacon)',
  'Чёрная дыра 10 M☉': 'Black hole 10 M☉',
  'Кварковая звезда (гипотеза)': 'Quark star (hypothetical)',
  'МКС': 'ISS',
  'Вояджер-1': 'Voyager 1',
  'Спутник-1': 'Sputnik 1',
  'Tesla Roadster': 'Tesla Roadster',
  'JWST': 'JWST',
  'Межзвёздный корабль (фант.)': 'Interstellar ship (fictional)',
  'Облако G2 (как у Стрельца A*)': 'G2 cloud (like at Sagittarius A*)',
  'Холодное молекулярное облако': 'Cold molecular cloud',
  'Горячее ионизованное облако': 'Hot ionized cloud',
  'Планетезималь': 'Planetesimal',
};
// Английские категории каталога
const CAT_EN = {
  'Астероиды и кометы': 'Asteroids and comets',
  'Спутники планет': 'Planetary moons',
  'Планеты': 'Planets',
  'Экзопланеты': 'Exoplanets',
  'Звёзды': 'Stars',
  'Компактные объекты': 'Compact objects',
  'Рукотворные объекты': 'Artificial objects',
  'Газовые облака': 'Gas clouds',
  'Прочее': 'Miscellaneous',
};
// Английские имена/описания пресетов ЧД (ключ — русское имя из PRESETS)
const PRESET_EN = {
  'Стрелец A* (центр Млечного Пути)': {
    name: 'Sagittarius A* (Milky Way center)',
    desc: 'Supermassive BH at our galaxy\'s center, 4.3 million M☉. Imaged by Event Horizon Telescope in 2022.',
  },
  'Феникс A (крупнейшая известная)': {
    name: 'Phoenix A (largest known)',
    desc: 'Ultramassive BH in the Phoenix cluster, ~100 billion M☉ — one of the largest known.',
  },
  'TON 618': {
    name: 'TON 618',
    desc: 'Ultramassive BH of quasar TON 618, ~66 billion M☉.',
  },
  'M87* (Повехере)': {
    name: 'M87* (Virgo A)',
    desc: 'First photographed BH (EHT, 2019), 6.5 billion M☉, galaxy M87.',
  },
  'Гаргантюа (Интерстеллар)': {
    name: 'Gargantua (Interstellar)',
    desc: 'BH from the film Interstellar: 100 million M☉, near-maximum spin.',
  },
  'Лебедь X-1': {
    name: 'Cygnus X-1',
    desc: 'First confirmed stellar-mass BH, X-ray binary.',
  },
  'GW150914 (остаток слияния)': {
    name: 'GW150914 (merger remnant)',
    desc: 'Outcome of the first detected BH merger (LIGO, 2015).',
  },
  'Звёздная ЧД (10 M☉)': {
    name: 'Stellar BH (10 M☉)',
    desc: 'Typical stellar-mass black hole — remnant of a massive star collapse.',
  },
};
// Английские имена/описания пресетов плазмы (ключ — id из DISK_PRESETS)
const DISK_EN = {
  classic: {
    name: 'Classic',
    desc: 'Balanced orange-white disk of moderate accretion.',
  },
  quasar: {
    name: 'Quasar',
    desc: 'Furious Eddington-limit accretion: blazing blue-white plasma.',
  },
  gargantua: {
    name: 'Gargantua',
    desc: 'Warm white glow like the hole from Interstellar.',
  },
  ring: {
    name: 'Thin ring',
    desc: 'Narrow bright ring at the ISCO — remnant of a recently consumed star.',
  },
  ember: {
    name: 'Glowing embers',
    desc: 'Starving hole: cold dark-red plasma barely glows.',
  },
  mist: {
    name: 'Gas haze',
    desc: 'Wide diffuse mist — gas just beginning to fall toward the hole.',
  },
  blazar: {
    name: 'Blazar',
    desc: 'Extreme: blinding ultraviolet disk of an active galactic nucleus.',
  },
};

function T(key) {
  const d = I18N[LANG];
  if (d && d[key] != null) return d[key];
  return I18N.ru[key] != null ? I18N.ru[key] : key;
}
function TF(key, vars) {
  let s = T(key);
  for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
function objName(name) {
  return LANG === 'en' && NAME_EN[name] ? NAME_EN[name] : name;
}
function catLabel(cat) {
  return LANG === 'en' && CAT_EN[cat] ? CAT_EN[cat] : cat;
}
function presetLabel(p) {
  return LANG === 'en' && PRESET_EN[p.name] ? PRESET_EN[p.name].name : p.name;
}
function presetDesc(p) {
  return LANG === 'en' && PRESET_EN[p.name] ? PRESET_EN[p.name].desc : p.desc;
}
function diskLabel(p) {
  return LANG === 'en' && DISK_EN[p.id] ? DISK_EN[p.id].name : p.name;
}
function diskDesc(p) {
  return LANG === 'en' && DISK_EN[p.id] ? DISK_EN[p.id].desc : p.desc;
}

function applyStaticLang() {
  document.documentElement.lang = LANG;
  document.title = T('docTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = T(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = T(el.dataset.i18nTitle); });
  const lb = document.getElementById('lang-btn');
  if (lb) lb.textContent = LANG === 'ru' ? 'EN' : 'RU';
}

function setLang(l) {
  try { localStorage.setItem('bh-lang', l); } catch (e) {}
  location.reload();
}
