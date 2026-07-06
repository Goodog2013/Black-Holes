<div align="center">

# ⚫ Black Hole Simulator

**Interactive real-time black hole simulator in your browser**

WebGL2 · zero dependencies · works offline · EN/RU interface

[🇬🇧 English](#-english) · [🇷🇺 Русский](#-русский) · [MIT License](LICENSE)

</div>

---

## 🇬🇧 English

An interactive 3D black hole simulator: real general-relativity visuals, a first-person plunge through the event horizon, tidal disruption of stars into GPU particle streams, black hole mergers with gravitational waves — all in vanilla JavaScript + WebGL2, no build step, no dependencies. Main focus on immersion mode.

### 🚀 Quick start

Open `index.html` in a modern browser (Chrome / Edge / Firefox). That's it — everything runs locally.

### 🔭 Physics

- 🌀 **Gravitational lensing** — ray tracing of null geodesics (Schwarzschild bending + Lense–Thirring frame dragging for spin): Einstein ring, layered photon ring, asymmetric shadow.
- 🔥 **Accretion disk** — Keplerian rotation, relativistic Doppler beaming (approaching side brighter), gravitational redshift, T ∝ r^(−3/4) profile, blackbody colors.
- 🪐 **Orbits** — Paczyński–Wiita pseudo-Newtonian potential (reproduces the ISCO and orbital instability), relativistic periapsis precession with rosette orbit trails (like star S2 at Sgr A*).
- 💫 **Tidal disruption events** — objects crossing the Roche limit stretch into ellipsoids and unwind into streams of 65,536 GPU particles that heat up and spiral into the disk; the flash produces a **light echo** that later re-lights the photon ring, and fresh matter drives a **brightness wave** across the disk.
- ⚡ **Relativistic jets** — hot plasma along the spin axis (Blandford–Znajek), flaring after a star is devoured; polar magnetic field lines twisted by frame dragging.
- 🌊 **Black hole mergers** — Peters inspiral (GW emission), chirp signal h(t), ringdown, GW ripple across the background, ~5% of mass radiated away.
- 🎡 **Ergosphere & Penrose process** — oblate shimmering shell around a spinning hole; objects inside get dragged, and escapees steal rotational energy (the spin actually drops).
- 🕳️ **Hawking physics panel** — horizon radius, photon sphere, Kerr ISCO, Hawking temperature, evaporation time, tidal forces, time dilation — live for any mass from asteroid-scale to 10¹² M☉.

### 🧑‍🚀 Immersion mode — fall into the hole

A first-person free fall built to match the NASA/Goddard plunge visualization and Andrew Hamilton's (JILA) inside-the-horizon renders:

- exact Schwarzschild radial infall by **proper time** — the horizon is crossed with no drama, exactly as GR predicts (no fade-to-black myth);
- **relativistic aberration + Doppler boost**: the sky crowds forward, blueshifted and δ³-brightened, while the view behind empties and reddens;
- near the singularity the tidal aberration **flattens the whole sky into a bright horizontal ring** that narrows and tears — then spaghettification;
- futuristic **spacesuit HUD**: mission clock, pulse, O₂, suit integrity, tidal g-force and comms signal that honestly dies at the horizon 📡;
- breathing, fear, alarm, signal-loss and system-failure **sound design**; time speed from ×0.125 to ×1,000,000 (you'll need it for Phoenix A — a 23-year fall!);
- VR-ish look-around: mouse, swipe, or gyroscope on phones.

### 🎨 Graphics

- HDR pipeline: float buffers, two-level Gaussian bloom, soft tonemapping, vignette, anti-banding dither and per-pixel raymarch jitter.
- Multi-layer turbulent plasma (ridged noise), glowing inner rim, photon-sphere glow, 7 plasma presets.
- Physically-derived customization: the disk inner edge follows the ISCO of the current spin, plasma temperature scales as T ∝ M^(−1/4).
- Background: three star layers with real blackbody colors, Milky Way with dust lanes and nebulae.
- 8 quality presets: from 💩 (10 geodesic steps at 10% resolution) to **"Why?..."** (1024 steps, ×2.4 supersampling, five-pass bloom).

### 🎛️ Modes & tools

| Key | Action |
|---|---|
| **I** | 🧑‍🚀 Immersion — first-person fall |
| **C** | 🎬 Cinematic auto-orbit |
| **F** | 🚀 Free flight (WASD/QE, Shift boost) |
| **P** / **R** | 📷 Screenshot / ⏺ WebM recording |
| **H** | 👁 Hide all UI |
| **Space** | ⏸ Pause |
| **1–8** | Quality presets |

Scene sharing via URL, autosaved settings, EN/RU language switcher, 57 spawnable objects (from comets and the ISS to UY Scuti, magnetars and a Tesla Roadster 🚗), binary stars and planetary systems, gas clouds, a pulsar lighthouse.

### 📚 Research

The physics was verified against published sources — see [`research/blackhole-physics.md`](research/blackhole-physics.md) (in Russian): every formula in the simulator checked, with notes on photon subrings, MAD jets, TDE light curves and GW kicks.

### 📄 License

[MIT](LICENSE) — use it, fork it, fall into it.

---

## 🇷🇺 Русский

Интерактивный 3D-симулятор чёрной дыры: честная картинка общей теории относительности, падение сквозь горизонт от первого лица, приливное разрушение звёзд в потоки GPU-частиц, слияния чёрных дыр с гравитационными волнами — на чистом JavaScript + WebGL2, без сборки и зависимостей. Основное внимание уделено режиму погружения.

### 🚀 Запуск

Откройте `index.html` в современном браузере (Chrome / Edge / Firefox). Всё. Работает офлайн.

### 🔭 Физика

- 🌀 **Гравитационное линзирование** — рейтрейсинг нуль-геодезик (изгиб Шварцшильда + увлечение кадра Лензе—Тирринга при спине): кольцо Эйнштейна, слоистое фотонное кольцо, асимметричная тень.
- 🔥 **Аккреционный диск** — кеплеровское вращение, релятивистский Доплер (приближающаяся сторона ярче), гравитационное красное смещение, профиль T ∝ r^(−3/4), цвета чёрного тела.
- 🪐 **Орбиты** — псевдоньютоновский потенциал Пачинского—Виита (воспроизводит ISCO и неустойчивость орбит), релятивистская прецессия перицентра со следами-«розетками» (как у звезды S2 у Стрельца A*).
- 💫 **Приливное разрушение** — объект, пересёкший предел Роша, вытягивается в эллипсоид и разматывается в струю из 65 536 GPU-частиц, которые греются и по спирали вливаются в диск; вспышка даёт **световое эхо**, а свежее вещество — **волну яркости** по диску.
- ⚡ **Релятивистские джеты** — горячая плазма вдоль оси спина (Бландфорд—Знаек), вспышка после съеденной звезды; магнитные линии у полюсов, закрученные увлечением кадра.
- 🌊 **Слияния чёрных дыр** — инспирал по Петерсу (излучение ГВ), чирп h(t), рингдаун, рябь по фону, ~5% массы уносится волнами.
- 🎡 **Эргосфера и процесс Пенроуза** — сплюснутая мерцающая оболочка у вращающейся дыры; объекты внутри закручиваются, а вылетевшие уносят энергию вращения (спин честно падает).
- 🕳️ **Панель физики** — радиус горизонта, фотонная сфера, ISCO Керра, температура Хокинга, время испарения, приливы, замедление времени — живьём для любой массы от астероидной до 10¹² M☉.

### 🧑‍🚀 Погружение — падение в дыру

Свободное падение от первого лица, сверенное с визуализацией NASA/Goddard и рендерами Эндрю Хэмилтона (JILA) изнутри горизонта:

- точное радиальное падение Шварцшильда по **собственному времени** — горизонт пересекается без всякой драмы, ровно как в ОТО (никакого мифа о «заливке чернотой»);
- **релятивистская аберрация + допплер-буст**: небо стягивается вперёд, синеет и усиливается в δ³ раза, а сзади пустеет и краснеет;
- у сингулярности приливная аберрация **сплющивает всё небо в яркое горизонтальное кольцо**, которое сужается и рвётся — дальше спагеттификация;
- футуристичный **HUD скафандра**: часы миссии, пульс, O₂, целостность, приливные перегрузки и связь, которая честно умирает на горизонте 📡;
- дыхание, страх, сирена, потеря сигнала и отказ систем — **звуковой дизайн**; скорость времени от ×0.125 до ×1 000 000 (пригодится для Феникса A — падение длиной 23 года!);
- осмотр как в VR: мышь, свайп или гироскоп на телефоне.

### 🎨 Графика

- HDR-конвейер: float-буферы, двухуровневый гауссов bloom, мягкий тонмаппинг, виньетка, дизеринг и попиксельный джиттер рейтрейсинга против бандинга.
- Многослойная турбулентная плазма (ridged-шум), раскалённая внутренняя кромка, свечение фотонной сферы, 7 пресетов плазмы.
- Физическая кастомизация: внутренний край диска следует за ISCO текущего спина, температура плазмы масштабируется как T ∝ M^(−1/4).
- Фон: три слоя звёзд с реальными цветами чёрного тела, Млечный Путь с пылевыми прожилками и туманностями.
- 8 пресетов качества: от 💩 (10 шагов геодезики в 10% разрешения) до **«Почему?...»** (1024 шага, суперсэмплинг ×2.4, пятипроходный bloom).

### 🎛️ Режимы и утилиты

| Клавиша | Действие |
|---|---|
| **I** | 🧑‍🚀 Погружение — падение от первого лица |
| **C** | 🎬 Кинорежим-автооблёт |
| **F** | 🚀 Свободный полёт (WASD/QE, Shift — ускорение) |
| **P** / **R** | 📷 Скриншот / ⏺ запись WebM |
| **H** | 👁 Скрыть весь интерфейс |
| **Пробел** | ⏸ Пауза |
| **1–8** | Пресеты качества |

Шаринг сцены ссылкой, автосохранение настроек, переключатель языка EN/RU, 57 объектов для спавна (от комет и МКС до UY Щита, магнетаров и Tesla Roadster 🚗), двойные звёзды и планетные системы, газовые облака, пульсар-маяк.

### 📚 Исследование

Физика сверена с публикациями — см. [`research/blackhole-physics.md`](research/blackhole-physics.md): проверена каждая формула симулятора, плюс заметки о суб-кольцах фотонного кольца, MAD-джетах, кривых блеска TDE и «пинках» после слияний.

### 📄 Лицензия

[MIT](LICENSE) — пользуйтесь, форкайте, падайте.
