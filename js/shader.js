// Вершинный и фрагментный шейдеры (WebGL2, GLSL ES 3.0)

const VERT_SRC = `#version 300 es
precision highp float;
const vec2 verts[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(verts[gl_VertexID], 0., 1.); }
`;

const FRAG_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamMat;      // столбцы: right, up, forward
uniform float uFov;

uniform int   uNumBH;
uniform vec3  uBHPos[2];
uniform float uBHRs[2];     // радиус горизонта в сценических единицах
uniform float uBHSpin[2];

uniform int   uDiskOn;
uniform float uDiskIn;      // в единицах rs каждой ЧД
uniform float uDiskOut;
uniform float uDiskTemp;    // К
uniform float uDiskBright;
uniform float uDiskBoost;   // вспышка от поглощённого вещества

#define MAXOBJ 24
uniform int   uObjCount;
uniform vec4  uObjPos[MAXOBJ];  // xyz, радиус
uniform vec4  uObjCol[MAXOBJ];  // rgb, emissive

uniform float uFlash;       // вспышка слияния 0..1
uniform float uRippleT;     // время после слияния (для ГВ-ряби), <0 = нет
uniform int   uSteps;
uniform int   uDetail;      // 1 = экстремальная детализация (пресет «Абсурд»)

uniform int   uErgo;        // показывать эргосферу
uniform vec3  uEchoPos;     // световое эхо: центр вспышки (сцена)
uniform float uEchoR;       // текущий радиус фронта эха
uniform float uEchoStr;     // сила эха (0 = нет)
// волны яркости от свежей аккреции: (phi0, r0, t, сила)
uniform int   uAccN;
uniform vec4  uAccWave[3];

// приливное вытягивание поглощаемой звезды (эллипсоид)
uniform int   uStretchIdx;  // индекс объекта, -1 = нет
uniform vec4  uStretch;     // xyz — ось (к ЧД), w — коэффициент растяжения K

// падающий наблюдатель (режим «Погружение»)
uniform vec4  uFallV;       // xyz — направление движения, w — β (v/c локально)
uniform float uFlat;        // 0..1 приливная аберрация у сингулярности: небо сплющивается

// ---------- шум ----------
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0., a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * noise2(p); p *= 2.13; a *= 0.5; }
  return v;
}
// гребневой шум — волокна плазмы
float ridged(vec2 p){
  float v = 0., a = 0.55;
  for(int i = 0; i < 4; i++){
    v += a * (1. - abs(2. * noise2(p) - 1.));
    p *= 2.2; a *= 0.5;
  }
  return v;
}

// ---------- цвет чёрного тела ----------
vec3 blackbody(float T){
  T = clamp(T, 1000., 40000.);
  float t = T / 100.;
  vec3 c;
  c.r = t <= 66. ? 1. : clamp(1.2929 * pow(t - 60., -0.1332), 0., 1.);
  c.g = t <= 66. ? clamp(0.3900816 * log(t) - 0.6318414, 0., 1.)
                 : clamp(1.1298909 * pow(t - 60., -0.0755148), 0., 1.);
  c.b = t >= 66. ? 1. : (t <= 19. ? 0. : clamp(0.5432068 * log(t - 10.) - 1.19625408, 0., 1.));
  return c;
}

// ---------- звёздный фон ----------
vec3 starLayer(vec3 d, float scale, float bright, float sharp){
  vec3 p = d * scale;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash13(id);
  vec3 sp = vec3(hash13(id + 7.1), hash13(id + 13.7), hash13(id + 27.3)) - 0.5;
  float dist = length(f - sp * 0.85);
  float star = exp(-dist * dist * sharp);
  // реалистичные цвета звёзд — спектр чёрного тела
  float temp = mix(2600., 14000., pow(max(hash13(id + 3.3), 0.001), 1.6));
  float tw = 0.85 + 0.15 * sin(uTime * (0.6 + h * 3.) + h * 40.);
  return blackbody(temp) * star * bright * tw * pow(max(h, 0.001), 24.);
}

vec3 background(vec3 d){
  vec3 col = vec3(0.);
  // три слоя звёзд: редкие яркие (дают bloom), средние, плотная россыпь
  col += starLayer(d, 30., 26., 320.);
  col += starLayer(d, 68., 10., 420.);
  col += starLayer(d, 140., 5., 520.);
  // «Абсурд»: четвёртый слой — пыль из тысяч едва различимых звёзд
  if(uDetail == 1) col += starLayer(d, 260., 2.2, 640.);
  // очень слабый фон дальних звёзд
  float far = fbm(d.xy * 20. + d.z * 13.);
  col += vec3(0.0006, 0.00066, 0.0009) * far * far;

  // Млечный Путь: тёплое ядро, газ и тёмные пылевые прожилки
  float band = exp(-pow(d.y * 3.0, 2.));
  float neb1 = fbm(d.xz * 3.2 + 17.);
  float neb2 = fbm(d.zx * 6.5 - 8.);
  float dust = smoothstep(0.35, 0.8, fbm(d.xz * 7.5 + 40.) * (0.6 + 0.6 * neb1));
  vec3 nebCol = mix(vec3(0.30, 0.18, 0.38), vec3(0.55, 0.38, 0.28), neb2);
  col += band * neb1 * neb1 * nebCol * 0.045 * (1. - dust * 0.9);
  col += band * vec3(0.55, 0.45, 0.38) * 0.006 * (1. - dust * 0.95);
  // редкие цветные туманности вне плоскости
  float wisp = fbm(d.yx * 2.6 + 31.);
  wisp = wisp * wisp * wisp;
  col += wisp * vec3(0.006, 0.003, 0.009) * (1. - band);
  return col;
}

// ---------- аккреционный диск ----------
vec4 sampleDisk(vec3 hit, int bi, vec3 rayDir){
  float rs = uBHRs[bi];
  vec3 rel = hit - uBHPos[bi];
  float rr = length(rel.xz) / rs;   // радиус в единицах rs
  float dIn = uDiskIn, dOut = uDiskOut;
  if(rr < dIn || rr > dOut) return vec4(0.);

  // кеплеровская скорость в долях c: v = sqrt(rs/(2r))
  float beta = clamp(sqrt(0.5 / rr), 0., 0.75);
  vec3 tang = normalize(vec3(-rel.z, 0., rel.x)); // прогрейд
  if(uBHSpin[bi] < 0.) tang = -tang;
  float grav = sqrt(max(1. - 1. / rr, 0.02));            // грав. красное смещение
  float gam = 1. / sqrt(1. - beta * beta);
  float dopp = 1. / (gam * (1. + beta * dot(tang, rayDir))); // релятивистский Доплер
  float shift = dopp * grav;

  // температурный профиль T ∝ r^(-3/4)
  float T = uDiskTemp * pow(dIn / rr, 0.75);
  float Tobs = T * shift;

  // турбулентность плазмы: дифференциальное вращение + волокна.
  // шум сэмплится в со-вращающихся декартовых координатах — без шва на стыке atan
  float omega = 0.7 * pow(rr, -1.5);
  float rot = uTime * omega * (uBHSpin[bi] < 0. ? -1. : 1.);
  float cs = cos(rot), sn = sin(rot);
  vec2 qn = vec2(rel.x * cs + rel.z * sn, -rel.x * sn + rel.z * cs) / (rs * rr);
  float lr = log(rr);
  float n1 = fbm(qn * 3.0 + vec2(lr * 7.0 - uTime * 0.05, 0.));
  float n2 = fbm(qn * 5.5 + vec2(lr * 11., lr * 9. - uTime * 0.12));
  float fil = ridged(qn * 7. + vec2(lr * 15., lr * 4.));
  float streaks = 0.30 + 1.15 * n1 * n2 * 2.0 + 0.55 * fil * fil;
  if(uDetail == 1){
    // «Абсурд»: тонкие волокна и мелкая рябь поверх основной турбулентности
    float fil2 = ridged(qn * 16. + vec2(lr * 34., -lr * 12.));
    float n3 = fbm(qn * 9. + vec2(lr * 22., -uTime * 0.20));
    streaks = streaks * (0.72 + 0.55 * n3) + 0.38 * fil2 * fil2 * fil2;
  }

  // радиальный профиль плотности
  float edgeIn = smoothstep(dIn, dIn * 1.10, rr);
  float edgeOut = 1. - smoothstep(dOut * 0.5, dOut, rr);
  float dens = edgeIn * edgeOut * streaks;

  // волна яркости от свежей аккреции: горячее пятно у точки входа вещества
  // сносится дифференциальным вращением, фронт разбегается по радиусу
  float waveB = 0.;
  if(uAccN > 0){
    float phi = atan(rel.z, rel.x);
    float sgn = uBHSpin[bi] < 0. ? -1. : 1.;
    float om = 0.7 * pow(max(rr, 1.), -1.5) * sgn;
    for(int w = 0; w < 3; w++){
      if(w >= uAccN) break;
      vec4 W = uAccWave[w];               // phi0, r0, t, сила
      float ph0 = W.x + om * W.z;         // пятно уносится кеплеровским вращением
      float dphi = atan(sin(phi - ph0), cos(phi - ph0));
      float az = exp(-dphi * dphi / (0.25 + W.z * 0.45));   // азимутальное размытие
      float d1 = rr - (W.y + 0.85 * W.z);                    // фронт наружу
      float d2 = rr - max(W.y - 0.85 * W.z, dIn);            // фронт внутрь
      float w1 = exp(-min(d1 * d1 * 1.8, 30.));
      float w2 = 0.7 * exp(-min(d2 * d2 * 2.2, 30.));
      waveB += W.w * az * (w1 + w2) * exp(-W.z * 0.28);
    }
  }

  // светимость растёт с температурой (≈ Стефан—Больцман, смягчённый)
  float heat = pow(clamp(Tobs / uDiskTemp, 1e-4, 1.6), 1.9) * (1. + waveB * 0.8);
  // раскалённая внутренняя кромка
  float rim = 1. + 1.4 * smoothstep(dIn * 1.7, dIn, rr);
  float beam = min(pow(dopp, 3.), 5.);
  float intensity = beam * grav * dens * uDiskBright * (1. + uDiskBoost + waveB * 2.2) * rim;
  vec3 col = blackbody(Tobs) * intensity * heat * 1.35;
  // мягкая компрессия пиков — иначе bloom заливает экран
  float lum = max(col.r, max(col.g, col.b));
  col *= 4.0 / (4.0 + lum);

  float alpha = clamp(dens * 1.7 * edgeOut, 0., 1.);
  return vec4(col, alpha);
}

// затенение объекта
vec3 shadeObject(int i, vec3 hitP, vec3 segDir){
  vec3 ce = uObjPos[i].xyz;
  vec3 n;
  if(i == uStretchIdx && uStretch.w > 1.001){
    // нормаль эллипсоида: n ∝ M²·(p−c), M = I + (1/K−1)·aaᵀ
    float ks = 1. / uStretch.w - 1.;
    vec3 q = hitP - ce;
    q += ks * dot(q, uStretch.xyz) * uStretch.xyz;
    q += ks * dot(q, uStretch.xyz) * uStretch.xyz;
    n = normalize(q);
  } else {
    n = normalize(hitP - ce);
  }
  vec3 base = uObjCol[i].rgb;
  float em = uObjCol[i].w;

  // свет от аккреционного диска: цвет плазмы, падение по 1/r²
  vec3 toBH = normalize(uBHPos[0] - hitP);
  float distL = max(length(hitP - uBHPos[0]) / uBHRs[0], 1.5);
  float lum = uDiskOn == 1 ? clamp(60. / (distL * distL), 0.03, 2.2) * uDiskBright : 0.06;
  vec3 lightCol = blackbody(uDiskTemp * 0.9);

  float diff = max(dot(n, toBH), 0.);
  // мягкий терминатор
  diff = pow(max(diff, 1e-4), 0.8);
  float fr0 = 1. - abs(dot(n, -segDir));
  float fres = fr0 * fr0 * fr0;
  vec3 lit = base * (0.05 + diff * lum * lightCol);
  lit += lightCol * fres * lum * 0.28;             // ободок рассеяния
  lit += base * vec3(0.05, 0.055, 0.07);           // звёздная засветка

  // пятна поверхности
  float spots = 0.72 + 0.55 * noise2(n.xy * 6. + n.z * 4. + float(i) * 3.7);
  lit *= spots;

  // светящиеся объекты: грануляция и лимбовое потемнение как у звёзд
  float limb = 0.55 + 0.45 * abs(dot(n, -segDir));
  float gran = 0.8 + 0.45 * noise2(n.xz * 9. + n.y * 5. + uTime * 0.4);
  vec3 emCol = base * em * 2.6 * limb * gran;
  // компрессия пиков — гигантские звёзды не выжигают экран
  float el = max(emCol.r, max(emCol.g, emCol.b));
  emCol *= 2.6 / (2.6 + el);
  // растянутая приливом звезда: кончик у ЧД раскалён, хвост тлеет —
  // градиент вместо ровного пересвеченного «цилиндра»
  if(i == uStretchIdx && uStretch.w > 1.001){
    float ax = clamp(dot(hitP - ce, uStretch.xyz) / max(uObjPos[i].w * uStretch.w, 1e-4), -1., 1.);
    emCol *= 0.40 + 0.60 * smoothstep(-1.1, 1., ax);
    float pk = max(emCol.r, max(emCol.g, emCol.b));
    if(pk > 1.35) emCol *= 1.35 / pk;   // сохраняем оттенок, гасим выжиг в белый
  }
  return lit * (1. - em) + emCol;
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2. - uRes) / uRes.y;
  vec3 rd = normalize(uCamMat * vec3(uv * tan(uFov * 0.5), 1.));

  // ---- падающий наблюдатель: релятивистские эффекты взгляда ----
  float dopp = 1.; // допплер-фактор δ для этого луча (1 = нет сдвига)
  float band = 1.; // приливное кольцо: усиление в плоскости, гашение вне её
  if(uFlat > 0.001){
    // приливная аберрация у сингулярности: направления взгляда прижимаются
    // к плоскости, перпендикулярной радиали, — небо сплющивается в кольцо
    float ax = dot(rd, uFallV.xyz);
    // полоса считается по исходному направлению взгляда наблюдателя
    band = exp(-ax * ax * uFlat * 22.);
    vec3 perp = rd - ax * uFallV.xyz;
    rd = normalize(uFallV.xyz * ax * (1. - 0.97 * uFlat) + perp);
  }
  if(uFallV.w > 0.001){
    // спец-рел. аберрация (наблюдатель -> статическая сетка): для падающего
    // звёзды толпятся вперёд вокруг сжавшейся тени, небо видно почти отовсюду
    float b = uFallV.w;
    float gm = inversesqrt(max(1. - b * b, 1e-4));
    float c0 = dot(rd, uFallV.xyz);
    vec3 perp = rd - c0 * uFallV.xyz;
    float pl = max(length(perp), 1e-6);
    float c1 = (c0 - b) / (1. - b * c0);
    rd = normalize(uFallV.xyz * c1 + perp * (sqrt(max(1. - c1 * c1, 0.)) / pl));
    // допплер-фактор по направлению взгляда: впереди синее и ярче, сзади краснее
    dopp = 1. / (gm * (1. - b * c0));
  }

  vec3 pos = uCamPos;
  vec3 vel = rd;

  vec3 col = vec3(0.);
  float trans = 1.;
  bool captured = false;
  bool hitObj = false;

  float rsMax = max(uBHRs[0], uNumBH > 1 ? uBHRs[1] : 0.);

  // затенение силуэтом ЧД: лучи с прицельным параметром < 3√3/2 rs падают в дыру,
  // свечение эргосферы на них гасим, чтобы тень оставалась чёрной
  float shOcc[2];
  for(int b = 0; b < 2; b++){
    shOcc[b] = 1.;
    if(b >= uNumBH) break;
    vec3 toB = uBHPos[b] - uCamPos;
    float tb = dot(toB, rd);
    if(tb > 0.){
      float bp = length(toB - rd * tb) / uBHRs[b];
      shOcc[b] = smoothstep(2.45, 2.8, bp);
    }
  }

  // джиттер первого шага: сдвиг фазы марширования на пиксель рассыпает
  // ступенчатые концентрические кольца (бандинг при малом числе шагов) в мелкий шум
  float jit = 0.4 + 0.6 * hash13(vec3(gl_FragCoord.xy, 3.7));

  for(int s = 0; s < 1024; s++){
    if(s >= uSteps) break;

    // адаптивный шаг
    float dmin = 1e9;
    for(int b = 0; b < 2; b++){
      if(b >= uNumBH) break;
      dmin = min(dmin, length(pos - uBHPos[b]) / uBHRs[b]);
    }
    float h = clamp(dmin * 0.22, 0.03, 2.2) * rsMax;
    if(s == 0) h *= jit;

    // отклонение фотона: a = -1.5 rs h² r̂/r⁵  (нуль-геодезика Шварцшильда)
    // + увлечение системы отсчёта (Лензе—Тирринг, приближение Керра):
    //   фотоны закручиваются вокруг оси спина ∝ a·rs³/r³ — тень становится асимметричной
    vec3 acc = vec3(0.);
    for(int b = 0; b < 2; b++){
      if(b >= uNumBH) break;
      vec3 rel = pos - uBHPos[b];
      float r2 = dot(rel, rel);
      vec3 Lv = cross(rel, vel);
      float h2 = dot(Lv, Lv);
      acc += -1.5 * uBHRs[b] * h2 * rel / (r2 * r2 * sqrt(r2));
      float rs2 = uBHRs[b] * uBHRs[b];
      float wfd = 0.5 * uBHSpin[b] * rs2 / max(r2 * sqrt(r2), rs2 * uBHRs[b] * 0.5);
      acc += cross(vec3(0., wfd, 0.), vel);
    }

    vec3 nvel = normalize(vel + acc * h);
    vec3 npos = pos + nvel * h;

    // горизонт + свечение фотонной сферы (r = 1.5 rs)
    for(int b = 0; b < 2; b++){
      if(b >= uNumBH) break;
      float rb = length(npos - uBHPos[b]);
      if(rb < uBHRs[b] * 1.01){ captured = true; }
      if(uDiskOn == 1){
        float dr = (rb - 1.5 * uBHRs[b]) / uBHRs[b];
        float ring = exp(-min(dr * dr * 60., 40.));
        // световое эхо: вспышка, обежавшая фотонную сферу, подсвечивает кольцо с задержкой
        float ringBoost = 1.;
        if(uEchoStr > 0.001 && b == 0){
          float dE = uEchoR - (length(uEchoPos - uBHPos[0]) + 1.5 * uBHRs[0]);
          ringBoost += uEchoStr * 3.0 * exp(-min(dE * dE * 1.6, 30.));
        }
        col += trans * blackbody(uDiskTemp * 1.4) * ring * ringBoost * h / rsMax * 0.012 * uDiskBright * (1. + uDiskBoost);
      }
      // эргосфера: «тыква» увлечения кадра — толще у экватора, тоньше у полюсов
      // r_E(θ) = rs·(1+√(1−χ²cos²θ))/(1+√(1−χ²)) — нормирована к нашему горизонту rs
      if(uErgo == 1 && uBHSpin[b] > 0.2){
        vec3 re = npos - uBHPos[b];
        float chi2 = uBHSpin[b] * uBHSpin[b];
        float ct2 = re.y * re.y / max(rb * rb, 1e-9);
        float rEg = uBHRs[b] * (1. + sqrt(max(1. - chi2 * ct2, 0.))) / (1. + sqrt(1. - chi2));
        float de = (rb - rEg) / uBHRs[b];
        float shell = exp(-min(de * de * 160., 30.));
        // прожилки, закрученные увлечением кадра
        float angE = atan(re.z, re.x) - uTime * (0.8 + uBHSpin[b]);
        float wisp = 0.55 + 0.45 * sin(angE * 7. + re.y / uBHRs[b] * 8.);
        col += trans * vec3(0.35, 0.5, 1.0) * shell * wisp * h / rsMax * 0.02 * uBHSpin[b] * shOcc[b];
      }
    }
    if(captured) break;

    // расширяющаяся сферическая оболочка светового эха
    if(uEchoStr > 0.001){
      float dsh = (length(npos - uEchoPos) - uEchoR) / rsMax;
      float shellE = exp(-min(dsh * dsh * 26., 30.));
      col += trans * vec3(1., 0.88, 0.7) * shellE * h / rsMax * 0.035 * uEchoStr;
    }

    // объекты: ищем ближайшее пересечение в сегменте (сфера или приливный эллипсоид)
    vec3 seg = npos - pos;
    float hitT = 1e9;
    int hitIdx = -1;
    for(int i = 0; i < MAXOBJ; i++){
      if(i >= uObjCount) break;
      vec3 oc = pos - uObjPos[i].xyz;
      vec3 sg = seg;
      if(i == uStretchIdx && uStretch.w > 1.001){
        // сжимаем пространство вдоль оси — сфера видится эллипсоидом
        float ks = 1. / uStretch.w - 1.;
        oc += ks * dot(oc, uStretch.xyz) * uStretch.xyz;
        sg += ks * dot(sg, uStretch.xyz) * uStretch.xyz;
      }
      float sgLen2 = dot(sg, sg);
      float ra = uObjPos[i].w;
      float bq = dot(oc, sg);
      float cq = dot(oc, oc) - ra * ra;
      float disc = bq * bq - sgLen2 * cq;
      if(disc > 0.){
        float t = (-bq - sqrt(disc)) / sgLen2;
        if(t > 0. && t < 1. && t < hitT){ hitT = t; hitIdx = i; }
      }
      // ореол светящихся объектов: непрерывное расстояние до сегмента (без колец)
      float em = uObjCol[i].w;
      if(em > 0.05){
        float raH = min(ra, 0.7);
        float tcl = clamp(-bq / sgLen2, 0., 1.);
        vec3 pc = oc + sg * tcl;
        float dd = max(dot(pc, pc), raH * raH * 0.25);
        col += trans * uObjCol[i].rgb * em * (raH * raH * 0.35 / dd) * 0.30;
      }
    }

    // пересечение диска (плоскость y = y_BH) — только до ближайшего объекта
    if(uDiskOn == 1){
      for(int b = 0; b < 2; b++){
        if(b >= uNumBH) break;
        float y0 = pos.y - uBHPos[b].y;
        float y1 = npos.y - uBHPos[b].y;
        if(y0 * y1 < 0.){
          float t = y0 / (y0 - y1);
          if(t < hitT){
            vec3 hit = mix(pos, npos, t);
            vec4 d = sampleDisk(hit, b, nvel);
            if(d.a > 0.001){
              col += trans * d.rgb * d.a;
              // непрозрачность: внутренняя часть плотная, внешняя — полупрозрачная дымка
              float rrO = length((hit - uBHPos[b]).xz) / uBHRs[b];
              float thick = 0.30 + 0.70 * clamp(uDiskIn * 2.5 / max(rrO, 1.), 0., 1.);
              float ca = clamp(d.a * (0.55 + 0.45 / max(abs(nvel.y), 0.30)), 0., 0.95);
              trans *= (1. - ca * 0.85 * thick);
            }
          }
        }
      }
    }

    if(hitIdx >= 0){
      vec3 hp = pos + seg * hitT;
      col += trans * shadeObject(hitIdx, hp, normalize(seg));
      trans = 0.;
      hitObj = true;
    }
    if(hitObj) break;

    pos = npos;
    vel = nvel;

    if(trans < 0.02) break;
    // луч ушёл далеко и наружу
    if(dmin > 70. && dot(normalize(pos - uBHPos[0]), vel) > 0.) break;
  }

  if(!captured && !hitObj && trans > 0.02){
    vec3 d = vel;
    // рябь гравитационных волн после слияния
    if(uRippleT >= 0.){
      float wav = sin(uRippleT * 14. - acos(clamp(dot(d, normalize(uBHPos[0] - uCamPos)), -1., 1.)) * 24.);
      float damp = exp(-uRippleT * 0.7) * 0.035;
      vec3 perp = normalize(cross(d, vec3(0., 1., 0.)) + 0.001);
      d = normalize(d + perp * wav * damp);
    }
    col += trans * background(d);
  }

  // вспышка слияния (без pow и ветвления — обход багов драйверов)
  {
    vec3 toC = normalize(uBHPos[0] - uCamPos);
    float ang = clamp(dot(rd, toC), 0., 1.);
    float a2 = ang * ang;
    float a6 = a2 * a2 * a2;
    float a30 = a6 * a6 * a6 * a6 * a6;
    col += uFlash * (vec3(1., 0.92, 0.8) * a30 * 6. + vec3(0.9, 0.85, 1.) * a6 * 0.9);
  }

  // ---- падающий наблюдатель: допплер-буст и приливное кольцо ----
  if(uFallV.w > 0.001){
    // релятивистское усиление δ³: впереди ярче/синее, сзади тусклее/краснее
    float boost = clamp(dopp * dopp * dopp, 0.06, 6.);
    col *= boost;
    float toBlue = clamp((dopp - 1.) * 1.3, 0., 1.);
    float toRed  = clamp((1. - dopp) * 1.6, 0., 1.);
    col *= mix(vec3(1.), vec3(0.62, 0.85, 1.5), toBlue);
    col *= mix(vec3(1.), vec3(1.45, 0.72, 0.38), toRed);
  }
  if(uFlat > 0.001){
    // вид у сингулярности: внешняя вселенная — узкое яркое кольцо в плоскости,
    // перпендикулярной падению; вне кольца свет краснеет и гаснет
    col *= mix(1., band * (1. + uFlat * 2.2), uFlat);
    col *= mix(vec3(1.), vec3(1.3, 0.55, 0.25), uFlat * (1. - band) * 0.8);
    // в самом конце гаснет и кольцо — свет рвётся приливом
    col *= 1. - smoothstep(0.86, 1., uFlat);
  }

  // линейный HDR — тонмаппинг в композитном проходе
  fragColor = vec4(col, 1.);
}
`;

// ============ GPU-частицы приливного разрушения ============
// Симуляция: ping-pong текстуры (pos.xyz + T, vel.xyz + life), MRT.
// Сцена в единицах rs главной ЧД (rs = 1), GM = 0.5 (Пачинский—Виита).

const PSIM_SRC = `#version 300 es
precision highp float;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uDt;        // шаг симуляции (сим-секунды)
uniform float uDtReal;    // реальные секунды (для жизни частиц)
uniform float uTime;
uniform vec3  uBHPosP;    // главная ЧД (сцена)
uniform float uDiskInR;   // внутренний край диска (в rs)
uniform vec4  uEmit;      // xyz — центр звезды, w — её видимый радиус
uniform vec3  uEmitDir;   // ось звезда -> ЧД
uniform vec3  uEmitVel;   // скорость звезды (сцена/сим-сек) — частицы летят вместе с ней
uniform float uEmitLen;   // полуось приливного эллипсоида (до кончика)
uniform float uEmitProb;  // вероятность возрождения мёртвой частицы за кадр
uniform float uEmitTemp;  // базовая температура, в 10^4 К
uniform float uJetProb;   // релятивистские джеты: вероятность рождения частицы

float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPosTex, ij, 0);
  vec4 V = texelFetch(uVelTex, ij, 0);
  float life = V.w;
  vec2 seed = gl_FragCoord.xy * 1.37 + fract(uTime * 0.731) * vec2(113.1, 71.7);

  if(life <= 0.){
    // релятивистский джет: горячая плазма вылетает вдоль оси спина
    if(uJetProb > 0. && hash(seed + 17.9) < uJetProb){
      vec3 rnd = vec3(hash(seed + 21.3), hash(seed + 23.7), hash(seed + 27.1)) - 0.5;
      float sgn = hash(seed + 31.7) < 0.5 ? 1. : -1.;
      vec3 p = uBHPosP + vec3(rnd.x * 0.35, sgn * (1.3 + hash(seed + 33.1) * 0.6), rnd.z * 0.35);
      // скорость выше скорости убегания — узкий конус вдоль оси
      float spd = 1.6 + 1.1 * hash(seed + 37.3);
      vec3 v = vec3(rnd.x * 0.22, sgn * spd, rnd.z * 0.22);
      oPos = vec4(p, 1.8 + 1.0 * hash(seed + 41.9));
      oVel = vec4(v, 6. + 9. * hash(seed + 43.1));
      return;
    }
    if(uEmitProb > 0. && hash(seed) < uEmitProb){
      // рождение на кончиках приливного эллипсоида: 75% — передний хвост (к ЧД),
      // 25% — задний; частица движется вместе со звездой, дальше её рвёт гравитация
      vec3 rnd = vec3(hash(seed + 1.3), hash(seed + 2.7), hash(seed + 4.1)) - 0.5;
      float sgn = hash(seed + 5.5) < 0.75 ? 1. : -1.;
      float along = 0.92 + 0.45 * hash(seed + 7.7);
      vec3 p = uEmit.xyz + uEmitDir * sgn * uEmitLen * along + rnd * uEmit.w * 0.22;
      // истечение с кончика + сонаправленность со звездой;
      // передний хвост стекает к ЧД заметно быстрее заднего
      float outSpd = sgn > 0. ? (0.05 + 0.10 * hash(seed + 8.3))
                              : (0.02 + 0.04 * hash(seed + 8.3));
      vec3 v = uEmitVel + uEmitDir * sgn * outSpd + rnd * 0.015;
      oPos = vec4(p, uEmitTemp);
      oVel = vec4(v, 10. + 20. * hash(seed + 9.2));
      return;
    }
    oPos = P;
    oVel = vec4(0.);
    return;
  }

  vec3 p = P.xyz;
  vec3 v = V.xyz;
  // два подшага для устойчивости у горизонта
  for(int k = 0; k < 2; k++){
    float hdt = uDt * 0.5;
    vec3 rel = p - uBHPosP;
    float r = length(rel);
    float rm = max(r - 1., 0.06);
    vec3 a = (-0.5 / (rm * rm)) * (rel / max(r, 0.01));
    // плазменное трение: сильнее у плоскости диска — спираль внутрь
    float drag = 0.006 + 0.035 * exp(-rel.y * rel.y * 5.);
    a -= v * drag;
    v += a * hdt;
    p += v * hdt;
    r = length(p - uBHPosP);
    if(r < 1.05){ life = 0.; break; }   // за горизонт
    // достигла внутренней области диска — растворяется
    if(r < uDiskInR * 1.05 && abs(p.y - uBHPosP.y) < 0.2) life = min(life, 0.8);
  }
  life -= uDtReal;

  // разогрев при приближении (приливное сжатие струи)
  float rr = length(p - uBHPosP);
  if(rr > 55.) life = 0.;  // джеты и беглецы гаснут вдали
  float target = uEmitTemp + (2.2 - uEmitTemp) * clamp(2.4 / max(rr - 0.6, 0.4) - 0.30, 0., 1.);
  float T = mix(P.w, max(target, P.w), clamp(uDt * 0.12, 0., 1.));

  oPos = vec4(p, T);
  oVel = vec4(v, life);
}
`;

const PVERT_SRC = `#version 300 es
precision highp float;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform ivec2 uTexSize;
uniform vec3  uCamPos;
uniform mat3  uCamMat;
uniform float uFov;
uniform vec2  uRes;
uniform vec3  uBHPosV;   // главная ЧД — для линзирования точек
out vec3 vCol;
out vec3 vWorld;
out float vFade;

vec3 blackbody(float T){
  T = clamp(T, 1000., 40000.);
  float t = T / 100.;
  vec3 c;
  c.r = t <= 66. ? 1. : clamp(1.2929 * pow(t - 60., -0.1332), 0., 1.);
  c.g = t <= 66. ? clamp(0.3900816 * log(t) - 0.6318414, 0., 1.)
                 : clamp(1.1298909 * pow(t - 60., -0.0755148), 0., 1.);
  c.b = t >= 66. ? 1. : (t <= 19. ? 0. : clamp(0.5432068 * log(t - 10.) - 1.19625408, 0., 1.));
  return c;
}

void main(){
  ivec2 ij = ivec2(gl_VertexID % uTexSize.x, gl_VertexID / uTexSize.x);
  vec4 P = texelFetch(uPosTex, ij, 0);
  vec4 V = texelFetch(uVelTex, ij, 0);
  if(V.w <= 0.){ gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }

  vec3 rel = P.xyz - uCamPos;
  vec3 pc = vec3(dot(rel, uCamMat[0]), dot(rel, uCamMat[1]), dot(rel, uCamMat[2]));
  if(pc.z < 0.05){ gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }

  float tf = tan(uFov * 0.5);
  vec2 ndc = vec2(pc.x / (pc.z * tf) * (uRes.y / uRes.x), pc.y / (pc.z * tf));

  // приближённое линзирование (точечная линза): частицы за ЧД
  // отталкиваются от её образа по уравнению th' = th/2 + sqrt(th²/4 + thE²)
  {
    vec3 relB = uBHPosV - uCamPos;
    vec3 bc = vec3(dot(relB, uCamMat[0]), dot(relB, uCamMat[1]), dot(relB, uCamMat[2]));
    float dl = length(relB);
    float ds = length(rel);
    if(bc.z > 0.05 && ds > dl + 0.2){
      vec2 bndc = vec2(bc.x / (bc.z * tf) * (uRes.y / uRes.x), bc.y / (bc.z * tf));
      vec2 dsc = ndc - bndc;
      float th = length(dsc) + 1e-5;
      // радиус Эйнштейна в тех же экранных единицах (rs = 1 сцены)
      float thE = sqrt(2. * max(ds - dl, 0.) / (dl * ds)) / tf;
      float thNew = 0.5 * th + sqrt(0.25 * th * th + thE * thE);
      ndc = bndc + dsc * (thNew / th);
    }
  }
  gl_Position = vec4(ndc, 0., 1.);
  gl_PointSize = clamp(0.042 / (pc.z * tf) * uRes.y, 1.2, 36.);

  // релятивистский Доплер: скорость в сим-единицах ~ доля c у горизонта
  float dopp = 1.;
  {
    vec3 vv = V.xyz;
    float sp = length(vv);
    float beta = clamp(sp * 0.45, 0., 0.72);
    if(sp > 1e-4){
      float cosA = dot(vv / sp, -rel / max(length(rel), 1e-4)); // к камере
      float gam = 1. / sqrt(1. - beta * beta);
      dopp = 1. / (gam * (1. - beta * cosA));
    }
  }
  float T = P.w * 10000. * dopp;
  float beam = clamp(dopp * dopp * dopp, 0.25, 3.2);
  vCol = blackbody(T) * (0.22 + 1.8 * clamp(T / 10000. - 0.12, 0., 1.6)) * beam;
  vFade = clamp(V.w * 0.9, 0., 1.);
  vWorld = P.xyz;
}
`;

const PFRAG_SRC = `#version 300 es
precision highp float;
in vec3 vCol;
in vec3 vWorld;
in float vFade;
out vec4 fragColor;
uniform vec3 uCamPos;
uniform vec3 uBHPosP;
uniform vec4 uOcc;   // заслоняющая звезда: xyz центр, w радиус (0 = нет)

void main(){
  vec2 q = gl_PointCoord * 2. - 1.;
  float d2 = dot(q, q);
  if(d2 > 1.) discard;
  // тень ЧД: скрываем только частицы непосредственно ЗА горизонтом
  // (образы дальних частиц линзирование уже вытолкнуло из тени в вершинном шейдере)
  vec3 d = vWorld - uCamPos;
  float len = length(d);
  d /= len;
  vec3 oc = uBHPosP - uCamPos;
  float tc = dot(oc, d);
  if(tc > 0. && tc < len && len < length(oc) + 3.){
    float b = length(oc - d * tc);
    if(b < 1.05) discard;
  }
  // заслонение телом звезды
  if(uOcc.w > 0.){
    vec3 os = uOcc.xyz - uCamPos;
    float ts = dot(os, d);
    if(ts > 0. && ts < len - uOcc.w * 0.3){
      float bs = length(os - d * ts);
      if(bs < uOcc.w * 0.92) discard;
    }
  }
  float a = exp(-3.0 * d2) * vFade;
  fragColor = vec4(vCol * a * 0.40, 1.);
}
`;

// ============ Постобработка ============

// яркостный проход для bloom
const BRIGHT_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uTex, uv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float w = smoothstep(1.05, 2.2, l);
  fragColor = vec4(c * w, 1.);
}
`;

// сепарабельное гауссово размытие
const BLUR_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;   // (1,0) или (0,1)
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = uDir / uRes;
  const float w[5] = float[5](0.227027, 0.194594, 0.121621, 0.054054, 0.016216);
  vec3 c = texture(uTex, uv).rgb * w[0];
  for(int i = 1; i < 5; i++){
    c += texture(uTex, uv + px * float(i)).rgb * w[i];
    c += texture(uTex, uv - px * float(i)).rgb * w[i];
  }
  fragColor = vec4(c, 1.);
}
`;

// финальный композит: bloom + ACES + виньетка + дизеринг
const COMPOSITE_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uHelmet;   // 0..1 — визор скафандра (режим погружения)
uniform float uEngulf;   // 0..1 — поглощение: мир сжимается в точку, вокруг чернота

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(){
  vec2 uv0 = gl_FragCoord.xy / uRes;
  vec2 uv = uv0;
  float engMask = 1.;
  if(uEngulf > 0.001){
    // видимая вселенная стягивается в сжимающееся окно и гаснет
    vec2 cc = uv0 - 0.5;
    float s = max(1. - uEngulf, 1e-4);
    // лёгкое гравитационное закручивание при сжатии
    float ang = uEngulf * uEngulf * 2.4;
    float ca = cos(ang), sa = sin(ang);
    cc = vec2(cc.x * ca - cc.y * sa, cc.x * sa + cc.y * ca);
    uv = clamp(0.5 + cc / s, 0., 1.);
    // маска — круг на экране (с поправкой на соотношение сторон)
    float rr = length((uv0 - 0.5) * vec2(uRes.x / uRes.y, 1.));
    engMask = 1. - smoothstep(0.36 * s, 0.5 * s, rr);
    // гарантированная полная чернота к концу
    engMask *= 1. - smoothstep(0.82, 0.985, uEngulf);
  }
  vec3 c;
  if(uHelmet > 0.002){
    // линза визора: бочкообразная дисторсия + хроматическая аберрация
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    float k = 0.30 * uHelmet;
    vec2 uvG = 0.5 + cc * (1. - k * r2);
    vec2 uvR = 0.5 + cc * (1. - k * r2 * 1.10);
    vec2 uvB = 0.5 + cc * (1. - k * r2 * 0.90);
    c = vec3(texture(uScene, uvR).r, texture(uScene, uvG).g, texture(uScene, uvB).b);
    c += texture(uBloom1, uvG).rgb * 0.5;
    c += texture(uBloom2, uvG).rgb * 0.35;
  } else {
    c = texture(uScene, uv).rgb;
    c += texture(uBloom1, uv).rgb * 0.5;
    c += texture(uBloom2, uv).rgb * 0.35;
  }

  // мягкая экспоненциальная кривая — сохраняет цвет в светах
  c = 1. - exp(-c * uExposure);
  c = pow(max(c, vec3(1e-5)), vec3(0.85));

  // мир сжимается в точку — всё вне окна поглощает чернота
  c *= engMask;

  // виньетка (+ овальный визор шлема в погружении) — по экранным координатам
  vec2 q = uv0 * 2. - 1.;
  float vig = 1. - 0.22 * dot(q * 0.72, q * 0.72);
  if(uHelmet > 0.002){
    float visor = smoothstep(0.55, 1.35, length(q * vec2(0.92, 1.12)));
    vig *= 1. - uHelmet * visor * 0.96;
    // лёгкое запотевание у кромки при дыхании
    float fog = smoothstep(0.75, 1.25, length(q * vec2(0.92, 1.12)))
              * (0.5 + 0.5 * sin(uTime * 1.4)) * (1. - uEngulf);
    c += uHelmet * fog * vec3(0.05, 0.06, 0.07);
  }
  c *= vig;

  // дизеринг против полос в градиентах (слабый, чтобы не читался как зерно)
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 100.) - 0.5) / 255. * 1.1;

  fragColor = vec4(c, 1.);
}
`;

// ============ следы орбит (розетка релятивистской прецессии) ============

const TRAILVERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPos;  // xyz — сцена (rs = 1), w — возраст 0..1 (1 = голова)
uniform vec3 uCamPos;
uniform mat3 uCamMat;
uniform float uFov;
uniform vec2 uRes;
out float vAge;
out vec3 vWorld;
void main(){
  vAge = aPos.w;
  vWorld = aPos.xyz;
  vec3 rel = aPos.xyz - uCamPos;
  vec3 pc = vec3(dot(rel, uCamMat[0]), dot(rel, uCamMat[1]), dot(rel, uCamMat[2]));
  if(pc.z < 0.05){ gl_Position = vec4(2., 2., 2., 1.); return; }
  float tf = tan(uFov * 0.5);
  gl_Position = vec4(pc.x / (pc.z * tf) * (uRes.y / uRes.x), pc.y / (pc.z * tf), 0., 1.);
}
`;

const TRAILFRAG_SRC = `#version 300 es
precision highp float;
in float vAge;
in vec3 vWorld;
uniform vec3 uCol;
uniform float uBright;
uniform vec3 uCamPos;
uniform vec3 uBHPosT;
out vec4 fragColor;
void main(){
  // затухание за тенью ЧД: край тени — прицельный параметр 3√3/2 ≈ 2.6 rs
  vec3 d = vWorld - uCamPos;
  float L = length(d);
  d /= L;
  vec3 toB = uBHPosT - uCamPos;
  float tb = dot(toB, d);
  float occ = 1.;
  // отбрасываем всё, что проецируется на силуэт тени, — включая куски линий
  // ПЕРЕД дырой (не совсем физично, но тень обязана оставаться чёрной)
  if(tb > 0. && L > tb * 0.3){
    float b = length(toB - d * tb);
    occ = smoothstep(2.6, 2.95, b);
    if(occ < 0.04) discard;
  }
  // гравитационное красное смещение: у горизонта свет линий гаснет,
  // из-под фотонной сферы почти ничего не выбирается
  float r3 = length(vWorld - uBHPosT);
  float g = sqrt(max(1. - 1. / max(r3, 1.001), 0.));
  occ *= g * g;
  float a = vAge * vAge;
  fragColor = vec4(uCol * a * uBright * occ, 1.);
}
`;
