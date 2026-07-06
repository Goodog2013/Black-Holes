// ============================================================
// Состояние симуляции
// ============================================================
const state = {
  M: 4.297e6 * MSUN,       // масса главной ЧД, кг
  spin: 0.5,
  diskOn: true,
  diskIn: 1.9,             // в rs
  diskOut: 12,
  diskBright: 1.0,
  diskTempUser: 9000,      // К (базовая, пользовательская)
  diskBoost: 0,            // вспышка аккреции от съеденных объектов
  timeScale: 300,          // множитель времени
  paused: false,
  realScale: false,
  objects: [],             // { name, m, r, pos:[x,y,z] м, vel м/с, col, em, compact, gen }
  merger: {
    active: false, m2: 0, a: 0, a0: 0, phase: 0,
    T: 40, t: 0, done: false
  },
  flash: 0,
  rippleT: -1,
  simTime: 0,
  ergoOn: true,            // визуализация эргосферы
  trailsOn: true,          // следы орбит (розетка прецессии)
  fieldOn: true,           // магнитные силовые линии у полюсов
  hawkingOn: false,        // испарение Хокинга (заметно на крошечных ЧД + больших × времени)
  echo: { t: -1, pos: [0, 0, 0], str: 0 },  // световое эхо от вспышки
  accWaves: [],            // волны яркости по диску от точек аккреции
};

const cam = { theta: 0.35, phi: 1.75, dist: 26, fov: 60 * Math.PI / 180 };

const QUALITY = {
  // «💩»: 10 шагов геодезики, рендер в 10% разрешения — хуже уже физически некуда
  poop: { steps: 10, scale: 0.1 },
  potato: { steps: 48, scale: 0.35 },
  low: { steps: 96, scale: 0.55 },
  med: { steps: 170, scale: 0.75 },
  high: { steps: 300, scale: 1.0 },
  ultra: { steps: 460, scale: 1.3 },  // суперсэмплинг + плавное линзирование
  // «Абсурд»: 1000 шагов геодезики, суперсэмплинг ×1.6, тройной bloom, доп. детализация плазмы
  absurd: { steps: 1000, scale: 1.6, cap: 3.2, blur: 3, detail: 1 },
  // «Почему?...»: потолок цикла шейдера (1024 шага), суперсэмплинг до предела текстур
  // WebGL2, пятикратный bloom, полная детализация плазмы
  why: { steps: 1024, scale: 2.4, cap: 4.0, blur: 5, detail: 1 },
};
let quality = QUALITY.med;

const MAXOBJ = 24;
const ACC_TIME = 7; // характерное время поглощения звезды, с реального времени

function rs1() { return schwarzschildRadius(state.M); }

// ============================================================
// WebGL
// ============================================================
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) { alert(T('needWebgl')); throw new Error('no webgl2'); }

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function makeProgram(fragSrc, uniforms, vertSrc = VERT_SRC) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  uniforms.forEach(n => u[n] = gl.getUniformLocation(p, n));
  return { prog: p, u };
}

const HDR = !!gl.getExtension('EXT_color_buffer_float');

const mainP = makeProgram(FRAG_SRC, [
  'uRes','uTime','uCamPos','uCamMat','uFov','uNumBH','uDiskOn','uDiskIn','uDiskOut',
  'uDiskTemp','uDiskBright','uDiskBoost','uObjCount','uFlash','uRippleT','uSteps','uDetail',
  'uStretchIdx','uStretch','uErgo','uEchoPos','uEchoR','uEchoStr','uAccN','uFallV','uFlat',
  'uXR','uXRTan',
  'uBHPos[0]','uBHRs[0]','uBHSpin[0]','uObjPos[0]','uObjCol[0]','uAccWave[0]',
]);
const brightP = makeProgram(BRIGHT_SRC, ['uTex', 'uRes']);
const blurP = makeProgram(BLUR_SRC, ['uTex', 'uRes', 'uDir']);
const compP = makeProgram(COMPOSITE_SRC, ['uScene', 'uBloom1', 'uBloom2', 'uRes', 'uTime', 'uExposure', 'uHelmet', 'uEngulf', 'uVp', 'uXR']);
const psimP = HDR ? makeProgram(PSIM_SRC, [
  'uPosTex','uVelTex','uDt','uDtReal','uTime','uBHPosP','uDiskInR',
  'uEmit','uEmitDir','uEmitVel','uEmitLen','uEmitProb','uEmitTemp','uJetProb',
]) : null;
const pdrawP = HDR ? makeProgram(PFRAG_SRC, [
  'uPosTex','uVelTex','uTexSize','uCamPos','uCamMat','uFov','uRes','uBHPosP','uBHPosV','uOcc',
  'uXR','uXRTan',
], PVERT_SRC) : null;
const trailP = makeProgram(TRAILFRAG_SRC, [
  'uCamPos','uCamMat','uFov','uRes','uCol','uBright','uBHPosT','uXR','uXRTan',
], TRAILVERT_SRC);
const vrUiP = makeProgram(VRUI_FRAG_SRC, ['uProj', 'uView', 'uTex', 'uColor', 'uUseTex'], VRUI_VERT_SRC);

// геометрия VR-оверлеев: динамические квады (позиция + uv)
const vrUiVAO = gl.createVertexArray();
const vrUiVBO = gl.createBuffer();
gl.bindVertexArray(vrUiVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, vrUiVBO);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
gl.bindVertexArray(null);
const U = mainP.u;
U.uBHPos = U['uBHPos[0]'];
U.uBHRs = U['uBHRs[0]'];
U.uBHSpin = U['uBHSpin[0]'];
U.uObjPos = U['uObjPos[0]'];
U.uObjCol = U['uObjCol[0]'];
U.uAccWave = U['uAccWave[0]'];

// геометрия следов орбит
const trailVAO = gl.createVertexArray();
const trailVBO = gl.createBuffer();
gl.bindVertexArray(trailVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, trailVBO);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// рендер-цели
let RT = null;

// ---- состояние WebXR (VR-шлем): заполняется в xrFrame ----
const xr = { session: null, refSpace: null, layer: null, rt: null, savedQ: null, btn: {} };
let xrCam = null;                     // базис глаза на время рендера (подменяет камеру)
let xrTan = [0, 0, 0, 0];             // тангенсы фрустума глаза (left, right, bottom, top)
let xrEye = 0;                        // 0 — левый глаз (шагает симуляции), 1 — правый
const xrOut = { fb: null, vp: null }; // куда рисует финальный композит вместо канваса
function makeTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, HDR ? gl.RGBA16F : gl.RGBA8, w, h, 0,
    gl.RGBA, HDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
function destroyTarget(t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function makeRTSet(W, H) {
  const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
  const qw = Math.max(2, W >> 2), qh = Math.max(2, H >> 2);
  return {
    scene: makeTarget(W, H),
    halfA: makeTarget(hw, hh),
    halfB: makeTarget(hw, hh),
    quartA: makeTarget(qw, qh),
    quartB: makeTarget(qw, qh),
  };
}

function resize() {
  const dpr = Math.min(Math.min(window.devicePixelRatio || 1, 2) * quality.scale, quality.cap || 2.2);
  // не превышаем максимальный размер текстуры GPU (актуально для «Почему?...»)
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 8192;
  const fit = Math.min(1, maxTex / (Math.max(innerWidth, innerHeight) * dpr));
  canvas.width = Math.round(innerWidth * dpr * fit);
  canvas.height = Math.round(innerHeight * dpr * fit);
  if (RT) Object.values(RT).forEach(destroyTarget);
  RT = makeRTSet(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);

// ---- GPU-частицы приливного разрушения ----
const PT_W = 512, PT_H = 128, PT_N = PT_W * PT_H;
let PT = null;
function makePartTex() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PT_W, PT_H, 0, gl.RGBA, gl.FLOAT,
    new Float32Array(PT_N * 4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
function makePartPair() {
  const pos = makePartTex(), vel = makePartTex();
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, vel, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { pos, vel, fbo };
}
if (HDR && psimP) {
  PT = { a: makePartPair(), b: makePartPair() };
}
const PSPEED = 6.5; // сим-секунды на реальную секунду

// эмиттер: заполняется в render(), burst — при полном разрушении объекта
let emitter = null;
let pendingBurst = null;

function stepParticles(dtReal, bhScene, diskInR) {
  if (!PT) return;
  const src = PT.a, dst = PT.b;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, PT_W, PT_H);
  gl.useProgram(psimP.prog);
  const u = psimP.u;
  bindTex(0, src.pos, u.uPosTex);
  bindTex(1, src.vel, u.uVelTex);
  gl.uniform1f(u.uDt, Math.min(dtReal, 0.05) * PSPEED);
  gl.uniform1f(u.uDtReal, Math.min(dtReal, 0.05));
  gl.uniform1f(u.uTime, performance.now() / 1000);
  gl.uniform3f(u.uBHPosP, bhScene[0], bhScene[1], bhScene[2]);
  gl.uniform1f(u.uDiskInR, diskInR);
  if (emitter) {
    gl.uniform4f(u.uEmit, emitter.pos[0], emitter.pos[1], emitter.pos[2], emitter.r);
    gl.uniform3f(u.uEmitDir, emitter.dir[0], emitter.dir[1], emitter.dir[2]);
    gl.uniform3f(u.uEmitVel, emitter.vel[0], emitter.vel[1], emitter.vel[2]);
    gl.uniform1f(u.uEmitLen, emitter.len);
    gl.uniform1f(u.uEmitProb, emitter.prob);
    gl.uniform1f(u.uEmitTemp, emitter.temp);
  } else {
    gl.uniform1f(u.uEmitProb, 0);
  }
  // джеты: питаются аккрецией и спином (Бландфорд—Знаек)
  const jetPower = Math.min(1, state.diskBoost * 0.6 + (emitter ? 0.5 : 0)) * (0.25 + state.spin);
  gl.uniform1f(u.uJetProb, jetPower * 0.012);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  PT.a = dst; PT.b = src;
}

function drawParticles(cv, bhScene) {
  if (!PT) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.scene.fbo);
  gl.viewport(0, 0, RT.scene.w, RT.scene.h);
  gl.useProgram(pdrawP.prog);
  const u = pdrawP.u;
  bindTex(0, PT.a.pos, u.uPosTex);
  bindTex(1, PT.a.vel, u.uVelTex);
  gl.uniform2i(u.uTexSize, PT_W, PT_H);
  gl.uniform3f(u.uCamPos, cv.pos[0], cv.pos[1], cv.pos[2]);
  gl.uniformMatrix3fv(u.uCamMat, false, [
    cv.right[0], cv.right[1], cv.right[2],
    cv.up[0], cv.up[1], cv.up[2],
    cv.fwd[0], cv.fwd[1], cv.fwd[2],
  ]);
  gl.uniform1f(u.uFov, cam.fov);
  gl.uniform2f(u.uRes, RT.scene.w, RT.scene.h);
  gl.uniform1i(u.uXR, xrCam ? 1 : 0);
  gl.uniform4f(u.uXRTan, xrTan[0], xrTan[1], xrTan[2], xrTan[3]);
  gl.uniform3f(u.uBHPosP, bhScene[0], bhScene[1], bhScene[2]);
  gl.uniform3f(u.uBHPosV, bhScene[0], bhScene[1], bhScene[2]);
  if (emitter && emitter.prob < 0.3) {
    gl.uniform4f(u.uOcc, emitter.pos[0], emitter.pos[1], emitter.pos[2], emitter.r);
  } else {
    gl.uniform4f(u.uOcc, 0, 0, 0, 0);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.drawArrays(gl.POINTS, 0, PT_N);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// следы орбит: розетка релятивистской прецессии (Пачинский—Виита её честно даёт)
const TRAIL_PTS = 280;
function drawTrails(cv, bhScene) {
  if (!state.trailsOn) return;
  const S = 1 / rs1();
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.scene.fbo);
  gl.viewport(0, 0, RT.scene.w, RT.scene.h);
  gl.useProgram(trailP.prog);
  const u = trailP.u;
  gl.uniform3f(u.uCamPos, cv.pos[0], cv.pos[1], cv.pos[2]);
  gl.uniformMatrix3fv(u.uCamMat, false, [
    cv.right[0], cv.right[1], cv.right[2],
    cv.up[0], cv.up[1], cv.up[2],
    cv.fwd[0], cv.fwd[1], cv.fwd[2],
  ]);
  gl.uniform1f(u.uFov, cam.fov);
  gl.uniform2f(u.uRes, RT.scene.w, RT.scene.h);
  gl.uniform1i(u.uXR, xrCam ? 1 : 0);
  gl.uniform4f(u.uXRTan, xrTan[0], xrTan[1], xrTan[2], xrTan[3]);
  gl.uniform3f(u.uBHPosT, bhScene[0], bhScene[1], bhScene[2]);
  gl.bindVertexArray(trailVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailVBO);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  // следы только у отрисовываемых объектов (первые MAXOBJ)
  const shown = Math.min(state.objects.length, MAXOBJ);
  for (let oi = 0; oi < shown; oi++) {
    const o = state.objects[oi];
    const tr = o.trail;
    if (!tr || tr.length < 6) continue;
    const n = tr.length / 3;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = tr[i * 3] * S;
      data[i * 4 + 1] = tr[i * 3 + 1] * S;
      data[i * 4 + 2] = tr[i * 3 + 2] * S;
      data[i * 4 + 3] = (i + 1) / n;
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.uniform3f(u.uCol, o.col[0], o.col[1], o.col[2]);
    gl.uniform1f(u.uBright, 0.34 + o.em * 0.7);
    gl.drawArrays(gl.LINE_STRIP, 0, n);
  }
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// подготовка линейной программы (следы, магнитные линии, лучи пульсаров)
function beginLinePass(cv, bhScene) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.scene.fbo);
  gl.viewport(0, 0, RT.scene.w, RT.scene.h);
  gl.useProgram(trailP.prog);
  const u = trailP.u;
  gl.uniform3f(u.uCamPos, cv.pos[0], cv.pos[1], cv.pos[2]);
  gl.uniformMatrix3fv(u.uCamMat, false, [
    cv.right[0], cv.right[1], cv.right[2],
    cv.up[0], cv.up[1], cv.up[2],
    cv.fwd[0], cv.fwd[1], cv.fwd[2],
  ]);
  gl.uniform1f(u.uFov, cam.fov);
  gl.uniform2f(u.uRes, RT.scene.w, RT.scene.h);
  gl.uniform1i(u.uXR, xrCam ? 1 : 0);
  gl.uniform4f(u.uXRTan, xrTan[0], xrTan[1], xrTan[2], xrTan[3]);
  gl.uniform3f(u.uBHPosT, bhScene[0], bhScene[1], bhScene[2]);
  gl.bindVertexArray(trailVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailVBO);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  return u;
}
function endLinePass() {
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// магнитные силовые линии: параболоидные спирали над полюсами, вращаются
// с увлечением кадра и питают джет (стиль визуализаций EHT)
const FIELD_LINES = 6, FIELD_PTS = 40;
function drawFieldLines(cv, bhScene) {
  if (!state.fieldOn || !state.diskOn || state.spin < 0.05) return;
  const jetPower = Math.min(1, state.diskBoost * 0.6 + (emitter ? 0.5 : 0)) * (0.25 + state.spin);
  const bright = 0.13 + jetPower * 0.65;
  const u = beginLinePass(cv, bhScene);
  gl.uniform3f(u.uCol, 0.36, 0.55, 1.0);
  gl.uniform1f(u.uBright, bright);
  const data = new Float32Array(FIELD_PTS * 4);
  for (let hemi = -1; hemi <= 1; hemi += 2) {
    for (let i = 0; i < FIELD_LINES; i++) {
      const phi0 = (i / FIELD_LINES) * Math.PI * 2;
      for (let k = 0; k < FIELD_PTS; k++) {
        const t = k / (FIELD_PTS - 1);
        // параболоид: узкое горло у полюса, раскрывается вверх
        const y = hemi * (0.55 + t * t * 7.5);
        const R = 0.55 + t * t * 3.6;
        // закрутка вдоль линии + вращение с диском (увлечение кадра)
        const a = phi0 + t * 5.5 + visT * (0.9 + state.spin * 0.8) * hemi;
        data[k * 4] = bhScene[0] + R * Math.cos(a);
        data[k * 4 + 1] = bhScene[1] + y;
        data[k * 4 + 2] = bhScene[2] + R * Math.sin(a);
        data[k * 4 + 3] = 1 - t * 0.85; // гаснет к раструбу
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINE_STRIP, 0, FIELD_PTS);
    }
  }
  endLinePass();
}

// лучи пульсаров: маяк с двумя противоположными конусами света
const BEAM_PTS = 18;
function drawPulsarBeams(cv, bhScene) {
  let any = false;
  for (const o of state.objects) if (o.pulsar) { any = true; break; }
  if (!any) return;
  const S = 1 / rs1();
  const u = beginLinePass(cv, bhScene);
  gl.uniform3f(u.uCol, 0.62, 0.78, 1.0);
  const data = new Float32Array(BEAM_PTS * 4);
  for (const o of state.objects) {
    if (!o.pulsar) continue;
    const ps = [o.pos[0] * S, o.pos[1] * S, o.pos[2] * S];
    // магнитная ось прецессирует вокруг наклонённой оси вращения
    const sA = norm3([0.30, 1, 0.14]);
    const e1 = norm3(cross3(sA, [0, 0, 1]));
    const e2 = cross3(sA, e1);
    const wt = visT * 7 + o.beamPhase;
    const cm = Math.cos(0.9), sm = Math.sin(0.9); // наклон магнитной оси ~52°
    const bd = [
      sA[0] * cm + (e1[0] * Math.cos(wt) + e2[0] * Math.sin(wt)) * sm,
      sA[1] * cm + (e1[1] * Math.cos(wt) + e2[1] * Math.sin(wt)) * sm,
      sA[2] * cm + (e1[2] * Math.cos(wt) + e2[2] * Math.sin(wt)) * sm,
    ];
    const L = 7; // длина луча, rs
    gl.uniform1f(u.uBright, 1.8);
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      for (let k = 0; k < BEAM_PTS; k++) {
        const t = k / (BEAM_PTS - 1);
        data[k * 4] = ps[0] + bd[0] * sgn * t * L;
        data[k * 4 + 1] = ps[1] + bd[1] * sgn * t * L;
        data[k * 4 + 2] = ps[2] + bd[2] * sgn * t * L;
        data[k * 4 + 3] = 1 - t * 0.92;
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINE_STRIP, 0, BEAM_PTS);
    }
  }
  endLinePass();
}

// вспомогательный полноэкранный проход; без target рисует на экран
// либо (в VR) во вьюпорт глаза внутри XR-фреймбуфера
function pass(p, target, setup) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : xrOut.fb);
  let x = 0, y = 0, w, h;
  if (target) { w = target.w; h = target.h; }
  else if (xrOut.vp) { [x, y, w, h] = xrOut.vp; }
  else { w = canvas.width; h = canvas.height; }
  gl.viewport(x, y, w, h);
  gl.useProgram(p.prog);
  setup(p.u, w, h, x, y);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function bindTex(unit, tex, loc) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc, unit);
}

// ============================================================
// Камера (орбитальная)
// ============================================================
let dragging = false, lastX = 0, lastY = 0;
cam.distT = cam.dist;
const keys = {};
canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = (e.clientX - lastX) * 0.005, dy = (e.clientY - lastY) * 0.005;
  if (camMode.fly || camMode.imm) {
    flyCam.yaw -= dx;
    flyCam.pitch = Math.max(-1.5, Math.min(1.5, flyCam.pitch - dy));
  } else {
    cam.phi -= dx;
    cam.theta = Math.max(-1.5, Math.min(1.5, cam.theta + dy));
  }
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (camMode.fly) {
    flyCam.speed = Math.max(0.5, Math.min(60, flyCam.speed * Math.exp(-e.deltaY * 0.001)));
  } else {
    cam.distT = Math.max(2.2, Math.min(300, cam.distT * Math.exp(e.deltaY * 0.001)));
  }
}, { passive: false });

// замедление времени у горизонта (заполняется в updateCamera, применяется к visT)
let camTimeFactor = 1;
// поглощение: 0..1, мир сжимается в точку у горизонта (заполняется в updateCamera)
let engulfK = 0;
const ENG_R0 = 1.35;  // начало сжатия мира
const ENG_R1 = 0.92;  // полная чернота (полёт)
function updateCamera(dt) {
  camTimeFactor = 1;
  engulfK = 0;
  if (camMode.cine) {
    // медленный кинооблёт: вращение, дыхание зума и лёгкая волна по высоте
    cineT += dt;
    cam.phi += dt * 0.07;
    cam.theta = 0.18 + Math.sin(cineT * 0.09) * 0.25;
    cam.distT = 14 + Math.sin(cineT * 0.055) * 7;
  }
  if (camMode.fly) {
    const cv = cameraVectors();
    // гравитационное замедление времени для наблюдателя у горизонта
    const r0 = Math.hypot(flyCam.pos[0], flyCam.pos[1], flyCam.pos[2]);
    camTimeFactor = Math.sqrt(Math.max(1 - 1 / Math.max(r0, 1.02), 0.02));
    // у горизонта собственное движение вязнет (замедление времени) — финал растягивается,
    // но и выбраться, пока не настала чернота, всё ещё можно
    const crawl = Math.max(1 - 1 / Math.max(r0, 1.02), 0.03);
    const sp = flyCam.speed * (keys['ShiftLeft'] || keys['ShiftRight'] ? 3 : 1) * dt * crawl;
    const move = (v, k) => {
      flyCam.pos[0] += v[0] * k; flyCam.pos[1] += v[1] * k; flyCam.pos[2] += v[2] * k;
    };
    if (keys['KeyW']) move(cv.fwd, sp);
    if (keys['KeyS']) move(cv.fwd, -sp);
    if (keys['KeyD']) move(cv.right, sp);
    if (keys['KeyA']) move(cv.right, -sp);
    if (keys['KeyE']) move([0, 1, 0], sp);
    if (keys['KeyQ']) move([0, 1, 0], -sp);
    // мир сжимается в точку; пока не дошёл до полной черноты — можно вернуться
    const r = Math.hypot(flyCam.pos[0], flyCam.pos[1], flyCam.pos[2]);
    engulfK = Math.min(1, Math.max(0, (ENG_R0 - r) / (ENG_R0 - ENG_R1)));
    if (engulfK >= 1) enterHorizon();
  }
  if (camMode.imm) {
    stepImmersion(dt);
    // симуляция идёт по собственному времени падающего: внешний мир для него
    // НЕ замирает и не ускоряется бесконечно (блюшифт конечен) — фактор 1
    camTimeFactor = 1;
  }
  cam.dist += (cam.distT - cam.dist) * Math.min(1, dt * 9);
}
let cineT = 0;

function setCine(on) {
  camMode.cine = on;
  if (on) {
    camMode.fly = false;
    cam.distT = 18;
    if (!document.body.classList.contains('ui-hidden')) toggleUI();
  } else if (document.body.classList.contains('ui-hidden')) {
    toggleUI();
  }
  const btn = document.getElementById('cine-btn');
  if (btn) btn.classList.toggle('active', on);
}
function setFly(on) {
  camMode.fly = on;
  if (on) {
    camMode.cine = false;
    // стартуем из текущей орбитальной позиции
    const ct = Math.cos(cam.theta), st = Math.sin(cam.theta);
    const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
    flyCam.pos = [cam.dist * ct * cp, cam.dist * st, cam.dist * ct * sp];
    flyCam.yaw = Math.atan2(-flyCam.pos[0], -flyCam.pos[2]);
    const horiz = Math.hypot(flyCam.pos[0], flyCam.pos[2]);
    flyCam.pitch = Math.atan2(-flyCam.pos[1], horiz);
  }
  const btn = document.getElementById('fly-btn');
  if (btn) btn.classList.toggle('active', on);
  const bar = document.getElementById('hint-bar');
  if (bar) bar.textContent = on ? T('hintFly') : T('hintDefault');
}
function toggleUI() {
  const hidden = document.body.classList.toggle('ui-hidden');
  const btn = document.getElementById('ui-toggle');
  btn.textContent = hidden ? '🚫' : '👁';
  btn.title = hidden ? T('tUIShow') : T('tUIHide');
}
document.getElementById('ui-toggle').onclick = toggleUI;
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    state.paused = !state.paused;
    document.getElementById('pause-chk').checked = state.paused;
  }
  if (e.code === 'KeyH') toggleUI();
  if (e.code === 'KeyF' && !camMode.imm) setFly(!camMode.fly);
  if (e.code === 'KeyC' && !camMode.imm) setCine(!camMode.cine);
  if (e.code === 'KeyI' && !camMode.imm) openImmModal();
  if (e.code === 'Escape') {
    const modal = document.getElementById('imm-modal');
    if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    else if (camMode.imm && !horizonPlaying) exitImmersion();
  }
  if (e.code === 'KeyP') takeScreenshot();
  if (e.code === 'KeyR') toggleRecording();
  // 1–8 — пресеты качества: 💩 … Почему?...
  const qKeys = { Digit1: 'poop', Digit2: 'potato', Digit3: 'low', Digit4: 'med', Digit5: 'high', Digit6: 'ultra', Digit7: 'absurd', Digit8: 'why' };
  if (qKeys[e.code]) {
    quality = QUALITY[qKeys[e.code]];
    const sel = document.getElementById('quality-select');
    sel.value = qKeys[e.code];
    resize();
    scheduleSave();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
// ============================================================
// Погружение: свободное падение в чёрную дыру от первого лица
// ============================================================
// Точное радиальное падение Шварцшильда из покоя на r0 (rs = 1, c = 1):
// (dr/dτ)² = 1/r − 1/r0 — формула работает и под горизонтом, τ — собственное
// время падающего. Горизонт пересекается без каких-либо особенностей.
// Покой всегда на IMM_R0: выбранная дистанция — точка входа в уже идущее падение,
// скорость там равна набранной с 60 rs.
const IMM_R0 = 60;
const immersion = { active: false, r: 15, r0: IMM_R0, v: 0, speed: 1, dir: [1, 0, 0], rSpag: 0.02, tau: 0 };
// HUD скафандра: настройка живёт в localStorage
let suitHudOn = (function () {
  try { return localStorage.getItem('bh-suithud') !== '0'; } catch (e) { return true; }
})();
// дополнительные звуки погружения (сирена, потеря связи, отказ систем)
let extraSndOn = (function () {
  try { return localStorage.getItem('bh-extrasnd') !== '0'; } catch (e) { return true; }
})();
let helmetK = 0; // плавное появление визора

// скорость падения по собственному времени, ед. c
function immVel(r) {
  return Math.sqrt(Math.max(1 / Math.max(r, 1e-4) - 1 / immersion.r0, 0) + 1e-7);
}

// локальная скорость относительно статичного наблюдателя:
// β = √((rs/r − rs/r₀)/(1 − rs/r₀)) — ровно c на горизонте (внутри формально
// >1, статичных наблюдателей там нет — при использовании обрезаем)
function immBetaLocal() {
  const denom = Math.max(1 - 1 / immersion.r0, 1e-6);
  return Math.sqrt(Math.max(1 / Math.max(immersion.r, 1e-4) - 1 / immersion.r0, 0) / denom);
}

// радиус спагеттификации: прилив на теле ~2 м достигает ~400 м/с² (в метрах);
// для сверхмассивных ЧД — глубоко под горизонтом, для звёздных — снаружи
function spagRadius() {
  return Math.cbrt(4 * G * state.M / 400);
}

function immFallTime(rFrom, rEnd) {
  // собственное время τ = ∫ dr / v(r) от rFrom до rEnd (безразмерное, ед. rs/c);
  // скорость соответствует падению из покоя на IMM_R0
  const N = 4000;
  let t = 0;
  const dr = (rFrom - rEnd) / N;
  if (dr <= 0) return 0;
  for (let i = 0; i < N; i++) {
    const r = rFrom - (i + 0.5) * dr;
    t += dr / Math.sqrt(Math.max(1 / r - 1 / IMM_R0, 1e-9));
  }
  return t;
}

function startImmersion(r0, speed) {
  immersion.active = true;
  immersion.r = r0;
  immersion.r0 = IMM_R0; // покой на 60 rs — на точке входа скорость уже набрана
  immersion.v = immVel(r0);
  immersion.tau = 0;
  // точка гибели: физическая спагеттификация, но не раньше 60% пути
  immersion.rSpag = Math.min(Math.max(spagRadius() / rs1(), 0.012), r0 * 0.6);
  immersion.speed = speed;
  camMode.imm = true;
  camMode.fly = false;
  camMode.cine = false;
  if (state.paused) {
    state.paused = false;
    document.getElementById('pause-chk').checked = false;
  }
  // падаем с текущего направления орбитальной камеры, взгляд — на дыру
  immersion.dir = cameraVectorsOrbit();
  flyCam.yaw = Math.atan2(-immersion.dir[0], -immersion.dir[2]);
  flyCam.pitch = Math.atan2(-immersion.dir[1], Math.hypot(immersion.dir[0], immersion.dir[2]));
  gyro.yaw0 = null; gyro.yaw = 0; gyro.pitch = 0;
  if (!document.body.classList.contains('ui-hidden')) toggleUI();
  const bar = document.getElementById('hint-bar');
  if (bar) bar.textContent = T('hintImm');
  startBreathing();
  // разрешение на гироскоп (iOS)
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
}
function cameraVectorsOrbit() {
  const ct = Math.cos(cam.theta), st = Math.sin(cam.theta);
  const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
  return norm3([ct * cp, st, ct * sp]);
}

function exitImmersion() {
  if (!immersion.active) return;
  immersion.active = false;
  camMode.imm = false;
  const hud = document.getElementById('imm-hud');
  if (hud) hud.classList.remove('show');
  stopBreathing();
  if (document.body.classList.contains('ui-hidden')) toggleUI();
  setFly(false); // восстанавливает подсказку и кнопки
  cam.dist = cam.distT = Math.max(cam.distT, 20);
}

function stepImmersion(dt) {
  if (!immersion.active) return;
  // пауза симуляции ставит на паузу и звуки скафандра
  if (immSnd && !horizonPlaying) {
    const all = [immSnd.breath, immSnd.fear, immSnd.alarm, immSnd.failure].filter(Boolean);
    if (state.paused && !immSnd.breath.paused) {
      all.forEach(a => a.pause());
    } else if (!state.paused && immSnd.breath.paused) {
      all.forEach(a => a.play().catch(() => {}));
    }
  }
  if (!state.paused && !horizonPlaying) {
    immersion.tau += dt * immersion.speed;
    const wasOutside = immersion.r > 1;
    // реальные секунды -> собственное время τ в ед. rs/c (размер дыры = длительность)
    let remain = dt * immersion.speed * C / rs1();
    // предел итераций с запасом под большие множители (×100k–×1M)
    for (let i = 0; i < 2500 && remain > 0; i++) {
      if (immersion.r <= immersion.rSpag) break;
      immersion.v = immVel(immersion.r);
      const h = Math.min(remain, Math.max(immersion.r * 0.004 / immersion.v, 1e-5));
      immersion.r -= immersion.v * h;
      remain -= h;
    }
    flyCam.pos = [
      immersion.dir[0] * immersion.r,
      immersion.dir[1] * immersion.r,
      immersion.dir[2] * immersion.r,
    ];
    // гибель: приливные силы рвут наблюдателя — дальше только видео
    if (immersion.r <= immersion.rSpag) enterHorizon();
    // время до разрушения (реальные секунды у экрана)
    const tDeath = immFallTime(immersion.r, immersion.rSpag) * rs1() / C / immersion.speed;
    // fear.mp3 (30 с) запускаем так, чтобы он закончился ровно к разрушению
    if (immSnd && !immSnd.fearStarted && tDeath <= FEAR_LEN) playFear();
    // доп. звуки: сирена и потеря связи на горизонте, отказ систем за 10 с до гибели
    if (immSnd && extraSndOn) {
      if (wasOutside && immersion.r <= 1) {
        playExtra('signalLost', 'signal_lost.mp3', 0.9, false);
        playExtra('alarm', 'Alarm.mp3', 0.7, true);
      }
      if (!immSnd.failure && tDeath <= 10) playExtra('failure', 'Failure.wav', 0.9, false);
      // затухание сирены и отказа в последние 3 секунды
      const fade = Math.min(Math.max(tDeath / 3, 0), 1);
      if (immSnd.alarm) immSnd.alarm.volume = 0.7 * fade;
      if (immSnd.failure) immSnd.failure.volume = 0.9 * fade;
    }
  }
  updateImmHud();
}

// ---- попап запуска погружения ----
function openImmModal() {
  document.getElementById('imm-modal').classList.remove('hidden');
  updateImmEta();
}
function updateImmEta() {
  const r0 = +document.getElementById('imm-dist').value;
  const speed = +document.getElementById('imm-speed').value;
  document.getElementById('imm-dist-label').textContent = r0.toFixed(1);
  const tDim = immFallTime(r0, 1);        // собственное время до горизонта (ед. rs/c)
  const tReal = tDim * rs1() / C;         // реальное время падения, сек
  const tYou = tReal / speed;             // с учётом множителя
  document.getElementById('imm-eta').innerHTML =
    TF('etaFall', { t: fmtTime(tReal) }) +
    (speed !== 1 ? TF('etaYou', { t: fmtTime(tYou) }) : '');
}

// ---- HUD погружения: дистанция, скорость, отсчёт до горизонта/гибели ----
let immHudLast = 0;
function updateImmHud() {
  const hud = document.getElementById('imm-hud');
  const suit = document.getElementById('suit-hud');
  if (!hud) return;
  if (!immersion.active || horizonPlaying) {
    hud.classList.remove('show');
    if (suit) suit.classList.remove('show');
    return;
  }
  const now = performance.now();
  if (now - immHudLast < 150) return;
  immHudLast = now;
  hud.classList.add('show');
  if (suit) {
    suit.classList.toggle('show', suitHudOn);
    if (suitHudOn) updateSuitHud(suit);
  }
  const r = immersion.r;
  const beta = Math.min(immBetaLocal(), 0.999);
  let txt = `r = ${r.toFixed(2)} r<sub>s</sub> · v = ${(beta * 100).toFixed(0)}% c`;
  const tSpag = immFallTime(r, immersion.rSpag) * rs1() / C / immersion.speed;
  if (r > 1 && immersion.rSpag < 1) {
    // сверхмассивная ЧД: гибель под горизонтом, сначала показываем время до него
    const tHor = immFallTime(r, 1) * rs1() / C / immersion.speed;
    txt += ` · ${TF('hudHorizon', { t: fmtTime(Math.max(tHor, 0)) })}`;
  } else {
    // внутри горизонта — или звёздная ЧД, где приливы рвут ещё снаружи
    const inside = r <= 1 ? T('hudInside') + ' · ' : '';
    txt += ` · <span class="warn">${inside}${TF('hudDoom', { t: fmtTime(Math.max(tSpag, 0)) })}</span>`;
  }
  hud.innerHTML = txt;
}

// ---- HUD скафандра: телеметрия состояния (общая для DOM-визора и VR) ----
function suitTelemetry() {
  const r = immersion.r;
  const dM = r * rs1(); // дистанция до центра, м
  // приливное ускорение на теле ~2 м (разница голова—ноги), в g
  const tidalG = 2 * G * state.M * 2 / Math.pow(Math.max(dM, 1), 3) / 9.81;
  // связь: гравитационное красное смещение душит канал, под горизонтом — тишина
  const sig = r > 1 ? Math.sqrt(1 - 1 / r) * 100 : 0;
  // состояние астронавта: пульс растёт у дыры, кислород тает со временем миссии
  const pulse = Math.min(184, Math.round(68 + 70 * Math.pow(Math.min(3 / Math.max(r, 0.05), 1), 1.6) + (r < 1 ? 26 : 0)));
  const o2 = Math.max(3, 98 - immersion.tau / 90).toFixed(0);
  // целостность скафандра: страдает, когда прилив превышает ~1 g
  const integ = Math.max(0, Math.min(100, 100 - (tidalG - 1) * 8));
  const fmtG = tidalG < 0.01 ? tidalG.toExponential(1) : tidalG < 100 ? tidalG.toFixed(2) : fmtExp(tidalG);
  const tauMin = Math.floor(immersion.tau / 60);
  const tauStr = `${String(tauMin).padStart(2, '0')}:${String(Math.floor(immersion.tau % 60)).padStart(2, '0')}`;
  return { tidalG, sig, pulse, o2, integ, fmtG, tauStr };
}

function updateSuitHud(suit) {
  const { tidalG, sig, pulse, o2, integ, fmtG, tauStr } = suitTelemetry();
  const tl = suit.querySelector('.sh-tl'), tr = suit.querySelector('.sh-tr');
  tl.innerHTML =
    `${T('sTau')}: <span class="val">${tauStr}</span><br>` +
    `${T('sPulse')}: <span class="${pulse > 150 ? 'warn' : 'val'}">${pulse} bpm</span><br>` +
    `${T('sO2')}: <span class="${+o2 < 25 ? 'warn blink' : 'val'}">${o2}%</span>`;
  tr.innerHTML =
    (sig > 0
      ? `${T('sSignal')}: <span class="${sig < 35 ? 'warn' : 'val'}">${sig.toFixed(0)}%</span>`
      : `<span class="warn blink">${T('sNoSignal')}</span>`) + '<br>' +
    `${T('sIntegr')}: <span class="${integ < 70 ? 'warn blink' : 'val'}">${integ.toFixed(0)}%</span><br>` +
    `${T('sTidal')}: <span class="${tidalG > 1 ? 'warn' : 'val'}">${fmtG} g</span>`;
}

// гироскоп: осмотр на телефоне
window.addEventListener('deviceorientation', e => {
  if (!camMode.imm || e.alpha == null) return;
  const a = e.alpha * Math.PI / 180;
  const b = (e.beta == null ? 90 : e.beta) * Math.PI / 180;
  if (gyro.yaw0 === null) gyro.yaw0 = a;
  gyro.yaw = a - gyro.yaw0;
  gyro.pitch = Math.max(-1.4, Math.min(1.4, b - Math.PI / 2));
});

// ---- звуки погружения: дыхание в шлеме (цикл) и страх у горизонта ----
const FEAR_LEN = 30; // длина fear.mp3, сек
let immSnd = null;
function startBreathing() {
  const breath = new Audio('breath.mp3');
  breath.loop = true;
  breath.volume = 0.85;
  breath.play().catch(() => {});
  immSnd = { breath, fear: null, fearStarted: false };
}
function playFear() {
  if (!immSnd || immSnd.fearStarted) return;
  immSnd.fearStarted = true;
  const fear = new Audio('fear.mp3');
  fear.volume = 1.0;
  fear.play().catch(() => {});
  immSnd.fear = fear;
  // дыхание приглушаем, чтобы страх читался
  immSnd.breath.volume = 0.4;
}
function playExtra(key, file, vol, loop) {
  if (!immSnd || immSnd[key]) return;
  const a = new Audio(file);
  a.volume = vol;
  a.loop = loop;
  a.play().catch(() => {});
  immSnd[key] = a;
}
function stopBreathing() {
  if (!immSnd) return;
  [immSnd.breath, immSnd.fear, immSnd.alarm, immSnd.failure, immSnd.signalLost]
    .filter(Boolean).forEach(a => a.pause());
  immSnd = null;
}

// ---- пересечение горизонта событий: видео от первого лица ----
let horizonPlaying = false;
function enterHorizon() {
  if (horizonPlaying) return;
  horizonPlaying = true;
  // видео-финал двухмерный: VR-сессию завершаем, шлем покажет браузер
  if (xr.session) xr.session.end();
  stopBreathing(); // звуки скафандра умолкают — дальше говорит видео
  const vid = document.getElementById('horizon-video');
  const finish = () => {
    if (!horizonPlaying) return;
    horizonPlaying = false;
    vid.classList.remove('playing');
    vid.pause();
    vid.onended = vid.onerror = null;
    // возвращаемся в обычный орбитальный режим подальше от дыры
    exitImmersion();
    setFly(false);
    cam.dist = cam.distT = 26;
  };
  vid.onended = finish;
  vid.onerror = finish;
  vid.classList.add('playing');
  vid.currentTime = 0;
  vid.play().catch(() => {
    // автоплей со звуком запрещён — пробуем без звука
    vid.muted = true;
    vid.play().catch(finish);
  });
  // Esc — пропустить
  const esc = e => {
    if (e.code === 'Escape') { finish(); window.removeEventListener('keydown', esc); }
  };
  window.addEventListener('keydown', esc);
}

// ---- скриншот и запись видео ----
let wantShot = false;
function takeScreenshot() { wantShot = true; }
function saveShotIfNeeded() {
  if (!wantShot) return;
  wantShot = false;
  canvas.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `blackhole-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

let recorder = null, recChunks = [];
function toggleRecording() {
  const btn = document.getElementById('rec-btn');
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = canvas.captureStream(60);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 20e6 });
    recChunks = [];
    recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
      const b = new Blob(recChunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `blackhole-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      recorder = null;
      if (btn) btn.classList.remove('active');
    };
    recorder.start();
    if (btn) btn.classList.add('active');
  } catch (err) {
    console.warn('Запись не поддерживается:', err);
    recorder = null;
  }
}

// ---- кинорежим: автоспавн случайных объектов ----
let cineSpawnT = 8;
function cineAutoSpawn(dt) {
  if (!camMode.cine) return;
  cineSpawnT -= dt;
  if (cineSpawnT > 0 || state.objects.length > 5) return;
  cineSpawnT = 16 + Math.random() * 22;
  const pool = CATALOG.filter(c => !c.isBH && (c.em > 0.2 || Math.random() < 0.35));
  const entry = pool[Math.floor(Math.random() * pool.length)];
  const orbits = [1.0, 0.7, 0.35, 1.25];
  spawnObject(entry, 4 + Math.random() * 14, orbits[Math.floor(Math.random() * orbits.length)]);
}

// сенсор
canvas.addEventListener('touchstart', e => { dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (!dragging) return;
  const dx = (e.touches[0].clientX - lastX) * 0.005;
  const dy = (e.touches[0].clientY - lastY) * 0.005;
  if (camMode.fly || camMode.imm) {
    flyCam.yaw -= dx;
    flyCam.pitch = Math.max(-1.5, Math.min(1.5, flyCam.pitch - dy));
  } else {
    cam.phi -= dx;
    cam.theta = Math.max(-1.5, Math.min(1.5, cam.theta + dy));
  }
  lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
}, { passive: true });
canvas.addEventListener('touchend', () => dragging = false);

// режимы камеры: орбита | fly (свободный полёт) | imm (погружение) | кино поверх орбиты
const camMode = { fly: false, cine: false, imm: false };
const flyCam = { pos: [0, 6, 26], yaw: Math.PI, pitch: -0.2, speed: 6 };
// гироскоп (телефон): добавка к взгляду в погружении
const gyro = { yaw0: null, yaw: 0, pitch: 0 };

function cameraVectors() {
  // VR: на время рендера глаза базис задаёт поза шлема
  if (xrCam) return xrCam;
  if (camMode.fly || camMode.imm) {
    // в VR головой вертит сам шлем (поза XR) — гироскоп телефона не подмешиваем
    const useGyro = camMode.imm && !xr.session;
    const yaw = flyCam.yaw + (useGyro ? gyro.yaw : 0);
    const pitch = Math.max(-1.5, Math.min(1.5, flyCam.pitch + (useGyro ? gyro.pitch : 0)));
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwd = [cp * sy, sp, cp * cy];
    const right = norm3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);
    // рендерим не глубже r = 1.05: внутри горизонта сцену дорисовывает эффект поглощения
    let pos = flyCam.pos.slice();
    const rr = Math.hypot(pos[0], pos[1], pos[2]);
    if (rr < 1.05 && rr > 1e-6) {
      const k = 1.05 / rr;
      pos = [pos[0] * k, pos[1] * k, pos[2] * k];
    }
    return { pos, right, up, fwd };
  }
  const ct = Math.cos(cam.theta), st = Math.sin(cam.theta);
  const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
  const pos = [cam.dist * ct * cp, cam.dist * st, cam.dist * ct * sp];
  const fwd = norm3([-pos[0], -pos[1], -pos[2]]);
  const right = norm3(cross3(fwd, [0, 1, 0]));
  const up = cross3(right, fwd);
  return { pos, right, up, fwd };
}
function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function norm3(a) { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }

// ============================================================
// Объекты: спавн, физика, приливное разрушение
// ============================================================
// ---- газовые облака: тело-носитель на орбите, вещество — GPU-частицы ----
const gasClouds = [];
function spawnGasCloud(entry, distRs, orbitFactor) {
  const rs = rs1();
  const r = distRs * rs;
  const ang = Math.random() * Math.PI * 2;
  const tilt = (Math.random() - 0.5) * 0.25;
  const pos = [r * Math.cos(ang), r * Math.sin(tilt) * 0.3, r * Math.sin(ang)];
  const vCirc = circularVelocity(state.M + (state.merger.active ? state.merger.m2 : 0), r);
  const tangDir = norm3(cross3(pos, [0, 1, 0]));
  const v = vCirc * orbitFactor;
  gasClouds.push({
    name: entry.name, rM: entry.r, temp: entry.gasTemp || 0.3,
    pos, vel: [tangDir[0] * v, tangDir[1] * v, tangDir[2] * v],
  });
  if (gasClouds.length > 3) gasClouds.shift();
}

function stepGasClouds(dt) {
  if (!gasClouds.length) return;
  const bhs = bhList();
  const gone = [];
  for (const g of gasClouds) {
    let rMin = Infinity;
    for (const bh of bhs) rMin = Math.min(rMin, dist3(g.pos, bh.pos));
    const vNow = Math.hypot(g.vel[0], g.vel[1], g.vel[2]) || 1;
    const nSub = Math.min(200, Math.max(1, Math.ceil(vNow * dt / (rMin * 0.03))));
    const h = dt / nSub;
    let dead = false;
    for (let s = 0; s < nSub && !dead; s++) {
      let ax = 0, ay = 0, az = 0;
      for (const bh of bhs) {
        const dx = bh.pos[0] - g.pos[0], dy = bh.pos[1] - g.pos[1], dz = bh.pos[2] - g.pos[2];
        const r = Math.hypot(dx, dy, dz);
        if (r < bh.rs * 1.15) { dead = true; break; }
        const denom = Math.max(r - bh.rs, bh.rs * 0.05);
        const a = G * bh.M / (denom * denom);
        ax += a * dx / r; ay += a * dy / r; az += a * dz / r;
      }
      if (dead) break;
      g.vel[0] += ax * h; g.vel[1] += ay * h; g.vel[2] += az * h;
      g.pos[0] += g.vel[0] * h; g.pos[1] += g.vel[1] * h; g.pos[2] += g.vel[2] * h;
    }
    if (dead) {
      // ядро облака ушло за горизонт: вспышка и волна по диску
      state.diskBoost = Math.min(3, state.diskBoost + 0.5);
      addAccWave(g.pos, 0.9);
      gone.push(g);
    } else if (dist3(g.pos, [0, 0, 0]) > 400 * rs1()) {
      gone.push(g);
    }
  }
  if (gone.length) {
    for (const g of gone) gasClouds.splice(gasClouds.indexOf(g), 1);
  }
}

function spawnObject(entry, distRs, orbitFactor) {
  // газовое облако — не твёрдое тело, а сгусток GPU-частиц
  if (entry.gas) { spawnGasCloud(entry, distRs, orbitFactor); return null; }
  if (state.objects.length >= MAXOBJ) {
    // убираем самый старый фрагмент, либо самый старый объект
    let idx = state.objects.findIndex(o => o.gen > 0);
    if (idx < 0) idx = 0;
    state.objects.splice(idx, 1);
  }
  const rs = rs1();
  const r = distRs * rs;
  const ang = Math.random() * Math.PI * 2;
  const tilt = (Math.random() - 0.5) * 0.25;
  const pos = [r * Math.cos(ang), r * Math.sin(tilt) * 0.3, r * Math.sin(ang)];
  const vCirc = circularVelocity(state.M + (state.merger.active ? state.merger.m2 : 0), r);
  // прогрейд — в ту же сторону, что вращается диск
  const tangDir = norm3(cross3(pos, [0, 1, 0]));
  const v = vCirc * orbitFactor;
  const obj = {
    name: entry.name, m: entry.m, r: entry.r,
    col: entry.col.slice(), em: entry.em || 0,
    compact: !!entry.compact, isBH: !!entry.isBH,
    pulsar: !!entry.pulsar, beamPhase: Math.random() * Math.PI * 2,
    pos, vel: [tangDir[0]*v, tangDir[1]*v, tangDir[2]*v],
    gen: 0, born: performance.now(),
    id: Math.random().toString(36).slice(2),
  };
  state.objects.push(obj);
  refreshObjList();
  return obj;
}

// иерархический спавн: спутники обращаются вокруг родителя (двойные звёзды, планетные системы)
function spawnSatellite(parent, entry, sepM, phase) {
  const vOrb = Math.sqrt(G * parent.m / sepM);
  const ca = Math.cos(phase), sa = Math.sin(phase);
  const obj = {
    name: entry.name, m: entry.m, r: entry.r,
    col: entry.col.slice(), em: entry.em || 0,
    compact: !!entry.compact, isBH: !!entry.isBH,
    pos: [parent.pos[0] + sepM * ca, parent.pos[1], parent.pos[2] + sepM * sa],
    vel: [parent.vel[0] - vOrb * sa, parent.vel[1], parent.vel[2] + vOrb * ca],
    gen: 0, born: performance.now(),
    id: Math.random().toString(36).slice(2),
    parentId: parent.id,
  };
  state.objects.push(obj);
  return obj;
}

function spawnBinaryStar(distRs) {
  const s1 = CATALOG.find(c => c.name === 'Солнце');
  const s2 = CATALOG.find(c => c.name === 'Сириус A') || s1;
  const primary = spawnObject(s1, distRs, 1.0);
  if (!primary) return;
  spawnSatellite(primary, s2, s1.r * 14, Math.random() * Math.PI * 2);
  refreshObjList();
}

function spawnPlanetSystem(distRs) {
  const star = CATALOG.find(c => c.name === 'Солнце');
  const primary = spawnObject(star, distRs, 1.0);
  if (!primary) return;
  const planets = ['Земля', 'Юпитер', 'Сатурн', 'Нептун'];
  planets.forEach((nm, i) => {
    const p = CATALOG.find(c => c.name === nm);
    if (p) spawnSatellite(primary, p, star.r * (7 + i * 5), Math.random() * Math.PI * 2);
  });
  refreshObjList();
}

function bhList() {
  // возвращает [{pos м, M, rs, primary}]
  const list = [{ pos: bh1PosM(), M: state.M, rs: rs1(), primary: true }];
  if (state.merger.active && !state.merger.done) {
    list.push({ pos: bh2PosM(), M: state.merger.m2, rs: schwarzschildRadius(state.merger.m2), primary: false });
  }
  return list;
}

function bh1PosM() {
  if (!state.merger.active || state.merger.done) return [0, 0, 0];
  const mg = state.merger;
  const f = mg.m2 / (state.M + mg.m2);
  return [mg.a * f * Math.cos(mg.phase), 0, mg.a * f * Math.sin(mg.phase)];
}
function bh2PosM() {
  const mg = state.merger;
  const f = state.M / (state.M + mg.m2);
  return [-mg.a * f * Math.cos(mg.phase), 0, -mg.a * f * Math.sin(mg.phase)];
}

function stepObjects(dt) {
  const bhs = bhList();
  const removed = [];
  const trailStep = rs1() * 0.12;         // шаг записи следа
  const trailGap2 = (rs1() * 1.2) ** 2;   // больший скачок = разрыв следа (без хорд)

  for (const o of state.objects) {
    // подшаги для устойчивости
    let rMin = Infinity;
    for (const bh of bhs) rMin = Math.min(rMin, dist3(o.pos, bh.pos));
    const vNow = Math.hypot(o.vel[0], o.vel[1], o.vel[2]) || 1;
    let nSub = Math.min(400, Math.max(1, Math.ceil(vNow * dt / (rMin * 0.02))));
    const h = dt / nSub;

    // родитель в иерархической системе (двойная звезда, планеты)
    let parent = null;
    if (o.parentId) {
      parent = state.objects.find(p => p.id === o.parentId && !p.dead);
      if (!parent || parent.accreting) { o.parentId = null; parent = null; }
    }

    let eaten = false;
    for (let s = 0; s < nSub && !eaten; s++) {
      let ax = 0, ay = 0, az = 0;
      for (const bh of bhs) {
        const dx = bh.pos[0] - o.pos[0], dy = bh.pos[1] - o.pos[1], dz = bh.pos[2] - o.pos[2];
        const r = Math.hypot(dx, dy, dz);
        // потенциал Пачинского—Виита: a = GM/(r - rs)²
        const denom = Math.max(r - bh.rs, bh.rs * 0.05);
        const a = G * bh.M / (denom * denom);
        ax += a * dx / r; ay += a * dy / r; az += a * dz / r;
        if (r < bh.rs * 1.05) {
          eaten = true;
          consumeObject(o, bh);
          break;
        }
      }
      if (eaten) break;
      // притяжение родителя (ньютоновское)
      if (parent) {
        const dx = parent.pos[0] - o.pos[0], dy = parent.pos[1] - o.pos[1], dz = parent.pos[2] - o.pos[2];
        const r = Math.max(Math.hypot(dx, dy, dz), parent.r * 1.5);
        const a = G * parent.m / (r * r);
        ax += a * dx / r; ay += a * dy / r; az += a * dz / r;
      }
      o.vel[0] += ax * h; o.vel[1] += ay * h; o.vel[2] += az * h;
      o.pos[0] += o.vel[0] * h; o.pos[1] += o.vel[1] * h; o.pos[2] += o.vel[2] * h;

      // увлечение кадра (Лензе—Тирринг): Ω = χ·c·rs²/(2r³) — объект закручивается
      // вокруг оси спина; заметно только вблизи вращающейся ЧД
      if (state.spin > 0.01) {
        const bh = bhs[0];
        const dx = o.pos[0] - bh.pos[0], dz = o.pos[2] - bh.pos[2];
        const r = Math.hypot(dx, o.pos[1] - bh.pos[1], dz);
        if (r < bh.rs * 4) {
          const w = state.spin * C * bh.rs * bh.rs / (2 * r * r * r) * h;
          const cw = Math.cos(w), sw = Math.sin(w);
          o.pos[0] = bh.pos[0] + dx * cw - dz * sw;
          o.pos[2] = bh.pos[2] + dx * sw + dz * cw;
          const vx = o.vel[0], vz = o.vel[2];
          o.vel[0] = vx * cw - vz * sw;
          o.vel[2] = vx * sw + vz * cw;
        }
      }

      // след орбиты пишется внутри подшагов — кривая гладкая при любом
      // ускорении времени; слишком большой скачок обрывает след (без хорд)
      if (state.trailsOn) {
        if (!o.trail) o.trail = [];
        const tr = o.trail, tn = tr.length;
        if (tn === 0) {
          tr.push(o.pos[0], o.pos[1], o.pos[2]);
        } else {
          const dx = o.pos[0] - tr[tn - 3], dy = o.pos[1] - tr[tn - 2], dz = o.pos[2] - tr[tn - 1];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > trailGap2) {
            tr.length = 0;
            tr.push(o.pos[0], o.pos[1], o.pos[2]);
          } else if (d2 > trailStep * trailStep) {
            tr.push(o.pos[0], o.pos[1], o.pos[2]);
            if (tr.length > TRAIL_PTS * 3) tr.splice(0, tr.length - TRAIL_PTS * 3);
          }
        }
      }
    }
    if (eaten) { removed.push(o.id); continue; }

    // процесс Пенроуза: объект, вылетевший из эргосферы, уносит энергию вращения ЧД
    if (state.spin > 0.25) {
      const bh = bhs[0];
      const rel = [o.pos[0] - bh.pos[0], o.pos[1] - bh.pos[1], o.pos[2] - bh.pos[2]];
      const r = Math.hypot(rel[0], rel[1], rel[2]);
      const chi2 = state.spin * state.spin;
      const ct2 = rel[1] * rel[1] / (r * r);
      // r_E(θ), нормированная к нашему горизонту rs (у экватора толще, у полюсов — ноль)
      const rE = bh.rs * (1 + Math.sqrt(Math.max(1 - chi2 * ct2, 0))) / (1 + Math.sqrt(1 - chi2));
      const inside = r < rE;
      if (o._inErgo && !inside && !o._penrose) {
        const k = 1 + 0.22 * state.spin;
        o.vel[0] *= k; o.vel[1] *= k; o.vel[2] *= k;
        state.spin = Math.max(0, state.spin - 0.004);
        syncSpinUI();
        o._penrose = true;
        refreshObjList();
      }
      o._inErgo = inside;
    }

    // приливный захват: внутри радиуса Роша начинается медленное поглощение
    if (!o.compact && !o.accreting && performance.now() - o.born > 300) {
      for (const bh of bhs) {
        const r = dist3(o.pos, bh.pos);
        const rt = tidalRadius(bh.M, o.m, o.r);
        if (r < rt && r > bh.rs) {
          o.accreting = true;
          o.m0 = o.m; o.r0 = o.r;
          o.col0 = o.col.slice(); o.em0 = o.em;
          o.accT = 0;
          refreshObjList();
          break;
        }
      }
    }

    // улетел слишком далеко
    if (dist3(o.pos, [0, 0, 0]) > 600 * rs1()) removed.push(o.id);
  }

  if (removed.length) state.objects = state.objects.filter(o => !removed.includes(o.id));
}

// волна яркости по диску от точки входа вещества (позиция в метрах)
function addAccWave(posM, str) {
  const rs = rs1();
  const x = posM[0] / rs, z = posM[2] / rs;
  state.accWaves.push({
    phi: Math.atan2(z, x),
    r0: Math.max(Math.hypot(x, z), state.diskIn + 0.3),
    t: 0, str,
  });
  if (state.accWaves.length > 3) state.accWaves.shift();
}
// световое эхо от вспышки (позиция в сценических единицах)
function triggerEcho(posScene, str) {
  state.echo = { t: 0, pos: posScene.slice(), str };
}

function consumeObject(o, bh) {
  // рост массы ЧД и вспышка диска
  if (bh.primary) state.M += o.m;
  else if (state.merger.active) state.merger.m2 += o.m;
  const boost = Math.min(1.5, Math.max(0.05, (Math.log10(o.m) - 8) / 16));
  state.diskBoost = Math.min(3, state.diskBoost + boost);
  if (bh.primary) addAccWave(o.pos, Math.min(1.2, 0.4 + boost));
  // обновляем метки массы, не трогая пользовательский масштаб времени
  el('mass-slider').value = Math.log10(state.M / MSUN);
  el('mass-label').textContent = fmtMass(state.M);
  el('diam-input').value = fmtExp(2 * rs1() / 1e3);
  refreshObjList();
}

function dist3(a, b) { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }

// ============================================================
// Слияние ЧД
// ============================================================
const gwHistory = [];
function startMerger() {
  const mg = state.merger;
  mg.m2 = Math.pow(10, parseFloat(el('m2-slider').value)) * state.M;
  const rsSum = rs1() + schwarzschildRadius(mg.m2);
  mg.a0 = parseFloat(el('sep-slider').value) * rsSum;
  mg.a = mg.a0;
  mg.T = parseFloat(el('tmerge-slider').value);
  mg.t = 0; mg.phase = 0;
  mg.active = true; mg.done = false;
  state.rippleT = -1; state.flash = 0;
  gwHistory.length = 0;
  cam.distT = Math.max(cam.dist, (mg.a0 / rs1()) * 1.6);
}

function stopMerger() {
  state.merger.active = false;
  state.merger.done = false;
  state.rippleT = -1;
}

function stepMerger(dtReal) {
  const mg = state.merger;
  if (!mg.active || mg.done) return;
  mg.t += dtReal;
  const Mtot = state.M + mg.m2;
  const rsSum = rs1() + schwarzschildRadius(mg.m2);
  // форма решения Петерса: a(t) = a0 (1 - t/T)^(1/4)
  const frac = Math.max(0, 1 - mg.t / mg.T);
  mg.a = Math.max(rsSum * 0.9, mg.a0 * Math.pow(frac, 0.25));
  // кеплеровская угловая скорость (визуальный масштаб времени)
  const omega = Math.sqrt(G * Mtot / Math.pow(mg.a, 3));
  const omegaVis = omega * state.timeScale;
  mg.phase += Math.min(omegaVis, 12) * dtReal; // ограничение, чтобы глаз успевал

  // запись волны ГВ: h ∝ (Mω)^(2/3)/a … используем нормированную форму
  const amp = Math.pow(mg.a0 / mg.a, 1.0);
  gwHistory.push(amp * Math.cos(2 * mg.phase));
  if (gwHistory.length > 280) gwHistory.shift();

  if (mg.a <= rsSum || mg.t >= mg.T) {
    // Слияние! ~5% массы уносится гравитационными волнами
    const radiated = 0.05 * Math.min(state.M, mg.m2) / Math.max(state.M, mg.m2) * 4;
    const q = Math.min(state.M, mg.m2) / Math.max(state.M, mg.m2);
    const eta = state.M * mg.m2 / (Mtot * Mtot); // симметричное отношение масс
    state.M = Mtot * (1 - Math.min(radiated, 0.05));
    state.spin = Math.min(0.95, 0.68 + state.spin * 0.2);
    mg.done = true; mg.active = false;
    state.flash = 1;
    state.rippleT = 0;
    state.diskBoost = Math.min(3, state.diskBoost + 1.2);
    applyGWKick(eta, q, mg.phase);
    syncMassUI();
    syncSpinUI();
  }
}

// Гравитационная отдача (kick): асимметричное излучение ГВ даёт итоговой дыре
// импульс. В плоскости орбиты — формула Фитчетта (максимум ~175 км/с при q≈0.38,
// ноль при равных массах), вдоль оси орбиты — «суперкик» от спинов (до ~3000 км/с).
// Дыра в сцене закреплена в начале координат, поэтому отдачу видим в её системе
// покоя: все свободные объекты и облака получают -v_kick.
function applyGWKick(eta, q, phase) {
  const vPlane = 9.8e6 * eta * eta * Math.sqrt(Math.max(1 - 4 * eta, 0)); // м/с
  const vSuper = 2.5e6 * state.spin * eta * eta / 0.0625 * Math.sin(phase * 3.7); // фаза спинов ~случайна
  const ang = phase + Math.PI * 0.5;
  const kick = [
    vPlane * Math.cos(ang),
    vSuper,
    vPlane * Math.sin(ang),
  ];
  const vTot = Math.hypot(kick[0], kick[1], kick[2]);
  if (vTot < 1) return;
  for (const o of state.objects) {
    o.vel[0] -= kick[0]; o.vel[1] -= kick[1]; o.vel[2] -= kick[2];
  }
  for (const g of gasClouds) {
    g.vel[0] -= kick[0]; g.vel[1] -= kick[1]; g.vel[2] -= kick[2];
  }
  flashHint(TF('kickMsg', { v: (vTot / 1e3).toFixed(0) }));
}

// ---- испарение Хокинга: dM/dt = -ħc⁴/(15360π G² M²) ----
// M³ убывает линейно по времени — интегрируем аналитически, стабильно при любом dt.
// Для реальных дыр эффект ничтожен; смотреть на пресете «Первичная ЧД» с большим ×времени.
const HAWK_C = 3.96e15; // ħc⁴/(15360π G²), кг³/с
let hawkSyncT = 0;
function stepHawking(dtSim) {
  if (!state.hawkingOn || dtSim <= 0) return;
  const m3 = state.M * state.M * state.M - 3 * HAWK_C * dtSim;
  if (m3 <= 1e18) {
    // финал: последняя секунда уносит остаток в гамма-вспышке
    state.M = 1e6;
    state.hawkingOn = false;
    const chk = el('hawking-chk');
    if (chk) chk.checked = false;
    state.flash = 1;
    triggerEcho([0, 0, 0], 1.5);
    state.diskBoost = Math.min(3, state.diskBoost + 1.5);
    flashHint(T('hawkDone'));
    hawkSyncUI();
    return;
  }
  state.M = Math.cbrt(m3);
  const now = performance.now();
  if (now - hawkSyncT > 250) { hawkSyncT = now; hawkSyncUI(); }
}
// подписи массы без autoTimeScale: пользовательский ×времени не трогаем
function hawkSyncUI() {
  el('mass-slider').value = Math.log10(state.M / MSUN);
  el('mass-label').textContent = fmtMass(state.M);
  el('diam-input').value = fmtExp(2 * rs1() / 1e3);
}

// временное сообщение в строке подсказок
let hintTimer = null;
function flashHint(msg) {
  const bar = el('hint-bar');
  if (!bar) return;
  bar.textContent = msg;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    bar.textContent = camMode.fly ? T('hintFly') : camMode.imm ? T('hintImm') : T('hintDefault');
  }, 7000);
}

function drawGW() {
  const cnv = el('gw-canvas');
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  if (!gwHistory.length) return;
  const maxAmp = Math.max(...gwHistory.map(Math.abs), 1);
  ctx.strokeStyle = '#5ec8ff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < gwHistory.length; i++) {
    const x = i / 280 * cnv.width;
    const y = cnv.height / 2 - gwHistory[i] / maxAmp * cnv.height * 0.42;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ============================================================
// UI
// ============================================================
function el(id) { return document.getElementById(id); }

function syncMassUI() {
  el('mass-slider').value = Math.log10(state.M / MSUN);
  el('mass-label').textContent = fmtMass(state.M);
  el('diam-input').value = fmtExp(2 * rs1() / 1e3);
  autoTimeScale();
}
function syncSpinUI() {
  el('spin-slider').value = state.spin;
  el('spin-label').textContent = state.spin.toFixed(3);
}
// физическая кастомизация диска под текущие массу и спин: внутренний край — ISCO,
// видимая температура плазмы — T ∝ M^(-1/4) с якорем «Стрелец A* = 9000 К».
// Работает для любых ЧД: пресетных (включая выдуманные) и пользовательских.
function applyPhysicalDisk() {
  const setS = (id, v) => { el(id).value = v; el(id).dispatchEvent(new Event('input')); };
  setS('diskin-slider', Math.min(Math.max(iscoRadius(state.spin), 1.2), 6).toFixed(2));
  const t = 9000 * Math.pow(state.M / (4.297e6 * MSUN), -0.25);
  setS('disktemp-slider', Math.min(Math.max(Math.round(t / 100) * 100, 2000), 30000));
}

function autoTimeScale() {
  // по умолчанию ~30 световых пересечений rs в секунду
  const t = 30 * rs1() / C;
  state.timeScale = t;
  el('ts-slider').value = Math.log10(Math.max(t, 0.1));
  el('ts-label').textContent = '×' + fmtExp(t);
}

function objListLabel(o) {
  const d = dist3(o.pos, bh1PosM()) / rs1();
  let txt = `${objName(o.name)} — ${d.toFixed(1)} r<sub>s</sub>`;
  if (o.accreting) txt += ` · ${T('accreting')} (${Math.round(o.m / o.m0 * 100)}%)`;
  if (o._penrose) txt += ' · ' + T('penrose');
  return txt;
}

function refreshObjList() {
  const box = el('obj-list');
  box.innerHTML = '';
  const shown = state.objects.slice(0, 12);
  for (const o of shown) {
    const div = document.createElement('div');
    div.className = 'obj-item';
    div.innerHTML = `<span data-oid="${o.id}">${objListLabel(o)}</span>`;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕';
    del.onclick = () => { state.objects = state.objects.filter(x => x.id !== o.id); refreshObjList(); };
    div.appendChild(del);
    box.appendChild(div);
  }
  if (state.objects.length > shown.length) {
    const more = document.createElement('div');
    more.className = 'hint';
    more.textContent = TF('moreObj', { n: state.objects.length - shown.length });
    box.appendChild(more);
  }
}

function setupUI() {
  // пресеты
  const ps = el('preset-select');
  PRESETS.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = presetLabel(p);
    ps.appendChild(o);
  });
  const applyPreset = () => {
    const p = PRESETS[+ps.value];
    state.M = p.m; state.spin = p.spin;
    el('preset-desc').textContent = presetDesc(p);
    stopMerger();
    state.objects = [];
    refreshObjList();
    syncMassUI(); syncSpinUI();
    applyPhysicalDisk();
  };
  el('preset-apply').onclick = applyPreset;
  ps.onchange = () => el('preset-desc').textContent = presetDesc(PRESETS[+ps.value]);
  el('preset-desc').textContent = presetDesc(PRESETS[0]);

  // масса / диаметр / спин
  el('mass-slider').oninput = e => {
    state.M = Math.pow(10, +e.target.value) * MSUN;
    el('mass-label').textContent = fmtMass(state.M);
    el('diam-input').value = fmtExp(2 * rs1() / 1e3);
    autoTimeScale();
    applyPhysicalDisk();
  };
  el('diam-apply').onclick = () => {
    const km = parseFloat(el('diam-input').value.replace(/[^\d.eE+-]/g, ''));
    if (km > 0) {
      state.M = km * 1e3 / 2 * C * C / (2 * G);
      syncMassUI();
      applyPhysicalDisk();
    }
  };
  el('spin-slider').oninput = e => {
    state.spin = +e.target.value;
    el('spin-label').textContent = state.spin.toFixed(3);
    // внутренний край диска следует за ISCO текущего спина
    const din = el('diskin-slider');
    din.value = Math.min(Math.max(iscoRadius(state.spin), 1.2), 6).toFixed(2);
    din.dispatchEvent(new Event('input'));
  };

  // диск
  el('disk-on').onchange = e => state.diskOn = e.target.checked;
  const bindSlider = (id, key, labelId, fmt) => {
    el(id).oninput = e => {
      state[key] = +e.target.value;
      el(labelId).textContent = fmt(+e.target.value);
    };
    el(labelId).textContent = fmt(+el(id).value);
  };
  bindSlider('diskin-slider', 'diskIn', 'diskin-label', v => v.toFixed(2));
  bindSlider('diskout-slider', 'diskOut', 'diskout-label', v => v.toFixed(1));
  bindSlider('diskbr-slider', 'diskBright', 'diskbr-label', v => '×' + v.toFixed(2));
  bindSlider('disktemp-slider', 'diskTempUser', 'disktemp-label', v => v.toFixed(0) + ' ' + T('uK'));

  // пресеты плазмы диска
  const diskSel = el('disk-preset');
  DISK_PRESETS.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = diskLabel(p);
    diskSel.appendChild(o);
  });
  const setDiskSlider = (id, val) => {
    el(id).value = val;
    el(id).dispatchEvent(new Event('input'));
  };
  diskSel.onchange = () => {
    const p = DISK_PRESETS.find(x => x.id === diskSel.value);
    if (!p) return;
    setDiskSlider('diskin-slider', p.in);
    setDiskSlider('diskout-slider', p.out);
    setDiskSlider('diskbr-slider', p.bright);
    setDiskSlider('disktemp-slider', p.temp);
    el('disk-preset-desc').textContent = diskDesc(p);
    state.diskOn = true;
    el('disk-on').checked = true;
  };
  el('disk-preset-desc').textContent = diskDesc(DISK_PRESETS[0]);

  // каталог
  const cats = [...new Set(CATALOG.map(c => c.cat))];
  const catSel = el('cat-select'), objSel = el('obj-select');
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = catLabel(c);
    catSel.appendChild(o);
  });
  const fillObjects = () => {
    objSel.innerHTML = '';
    CATALOG.forEach((c, i) => {
      if (c.cat !== catSel.value) return;
      const o = document.createElement('option');
      o.value = i; o.textContent = objName(c.name);
      objSel.appendChild(o);
    });
    updateObjInfo();
  };
  const updateObjInfo = () => {
    const c = CATALOG[+objSel.value];
    if (!c) return;
    const rt = tidalRadius(state.M, c.m, c.r) / rs1();
    let txt = `${T('objMass')} ${fmtMass(c.m)} · ${T('objRadius')} ${fmtLength(c.r)}`;
    if (c.compact) {
      txt += ' · ' + T('noTidal');
    } else if (rt <= 1) {
      txt += ' · ' + T('tidalInside');
    } else {
      txt += ' · ' + TF('tidalAt', { r: rt.toFixed(1) });
      const spawnD = +el('spawnd-slider').value;
      if (spawnD < rt) txt += ' ' + T('tidalWarn');
    }
    el('obj-info').textContent = txt;
  };
  catSel.onchange = fillObjects;
  objSel.onchange = updateObjInfo;
  fillObjects();

  bindSlider('spawnd-slider', '_spawnd', 'spawnd-label', v => v.toFixed(1));
  el('spawnd-slider').addEventListener('input', updateObjInfo);
  el('mass-slider').addEventListener('input', updateObjInfo);
  el('spawn-btn').onclick = () => {
    const c = CATALOG[+objSel.value];
    if (c) spawnObject(c, +el('spawnd-slider').value, +el('orbit-select').value);
  };
  el('clear-btn').onclick = () => { state.objects = []; gasClouds.length = 0; refreshObjList(); };

  // слияние
  const m2lab = () => {
    const ratio = Math.pow(10, +el('m2-slider').value);
    el('m2-label').textContent = fmtMass(ratio * state.M) + ` (${(ratio).toFixed(2)}× M₁)`;
  };
  el('m2-slider').oninput = m2lab; m2lab();
  bindSlider('sep-slider', '_sep', 'sep-label', v => v.toFixed(1));
  bindSlider('tmerge-slider', '_tm', 'tmerge-label', v => v.toFixed(0));
  el('merge-start').onclick = startMerger;
  el('merge-stop').onclick = stopMerger;

  // симуляция
  el('ts-slider').oninput = e => {
    state.timeScale = Math.pow(10, +e.target.value);
    el('ts-label').textContent = '×' + fmtExp(state.timeScale);
  };
  el('pause-chk').onchange = e => state.paused = e.target.checked;
  el('quality-select').onchange = e => { quality = QUALITY[e.target.value]; resize(); };
  el('realscale-chk').onchange = e => state.realScale = e.target.checked;
  el('ergo-chk').onchange = e => state.ergoOn = e.target.checked;
  el('field-chk').onchange = e => state.fieldOn = e.target.checked;
  el('hawking-chk').onchange = e => state.hawkingOn = e.target.checked;
  el('trails-chk').onchange = e => {
    state.trailsOn = e.target.checked;
    if (!state.trailsOn) for (const o of state.objects) o.trail = null;
  };

  // системы объектов
  el('binary-btn').onclick = () => spawnBinaryStar(+el('spawnd-slider').value);
  el('system-btn').onclick = () => spawnPlanetSystem(+el('spawnd-slider').value);

  // режимы и захват кадра
  el('cine-btn').onclick = () => setCine(!camMode.cine);
  el('fly-btn').onclick = () => setFly(!camMode.fly);
  el('shot-btn').onclick = takeScreenshot;
  el('rec-btn').onclick = toggleRecording;

  // погружение
  el('imm-btn').onclick = openImmModal;
  el('imm-cancel').onclick = () => el('imm-modal').classList.add('hidden');
  el('imm-hud-chk').checked = suitHudOn;
  el('imm-hud-chk').onchange = e => {
    suitHudOn = e.target.checked;
    try { localStorage.setItem('bh-suithud', suitHudOn ? '1' : '0'); } catch (err) {}
  };
  el('imm-snd-chk').checked = extraSndOn;
  el('imm-snd-chk').onchange = e => {
    extraSndOn = e.target.checked;
    try { localStorage.setItem('bh-extrasnd', extraSndOn ? '1' : '0'); } catch (err) {}
  };
  el('imm-dist').oninput = updateImmEta;
  el('imm-speed').onchange = updateImmEta;
  el('imm-start').onclick = () => {
    el('imm-modal').classList.add('hidden');
    startImmersion(+el('imm-dist').value, +el('imm-speed').value);
  };

  // ссылка-сценарий
  el('share-btn').onclick = () => {
    location.hash = 's=' + encodeScene();
    navigator.clipboard?.writeText(location.href)
      .then(() => { el('share-hint').textContent = T('shareCopied'); })
      .catch(() => { el('share-hint').textContent = T('shareManual'); });
  };

  // переключатель языка
  el('lang-btn').onclick = () => setLang(LANG === 'ru' ? 'en' : 'ru');
  applyStaticLang();

  // VR (WebXR): кнопка появляется, только если шлем действительно доступен
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      if (ok) el('vr-btn').style.display = '';
    }).catch(() => {});
  }
  el('vr-btn').onclick = enterVR;

  // мобильная раскладка: секции настроек свёрнуты (панель — нижний лист),
  // карточка физики сворачивается тапом по заголовку и стартует свёрнутой
  if (window.matchMedia('(max-width: 760px)').matches) {
    document.querySelectorAll('#ui-left details[open]').forEach(d => d.removeAttribute('open'));
    const info = el('ui-info');
    info.classList.add('collapsed');
    info.querySelector('h2').addEventListener('click', () => info.classList.toggle('collapsed'));
  }

  // автосохранение настроек при любом взаимодействии с панелью
  const uiRoot = document.getElementById('ui-left');
  uiRoot.addEventListener('input', scheduleSave);
  uiRoot.addEventListener('change', scheduleSave);
  uiRoot.addEventListener('click', scheduleSave);

  syncMassUI(); syncSpinUI();
}

// ============================================================
// Сохранение настроек и обмен сценариями
// ============================================================
function snapshotSettings() {
  return {
    M: state.M, spin: state.spin,
    diskOn: state.diskOn, diskIn: state.diskIn, diskOut: state.diskOut,
    diskBright: state.diskBright, diskTempUser: state.diskTempUser,
    timeScale: state.timeScale, realScale: state.realScale,
    ergo: state.ergoOn, trails: state.trailsOn, field: state.fieldOn,
    quality: el('quality-select').value,
    cam: { theta: cam.theta, phi: cam.phi, dist: cam.distT },
  };
}
function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  if (s.M > 0) state.M = s.M;
  if (typeof s.spin === 'number') state.spin = Math.max(0, Math.min(0.998, s.spin));
  // syncMassUI вызывает autoTimeScale — поэтому сначала он, потом восстановление timeScale
  syncMassUI(); syncSpinUI();
  if (typeof s.diskOn === 'boolean') { state.diskOn = s.diskOn; el('disk-on').checked = s.diskOn; }
  const setSlider = (id, val, key) => {
    if (typeof val !== 'number' || !isFinite(val)) return;
    state[key] = val;
    el(id).value = val;
    el(id).dispatchEvent(new Event('input'));
  };
  setSlider('diskin-slider', s.diskIn, 'diskIn');
  setSlider('diskout-slider', s.diskOut, 'diskOut');
  setSlider('diskbr-slider', s.diskBright, 'diskBright');
  setSlider('disktemp-slider', s.diskTempUser, 'diskTempUser');
  if (s.timeScale > 0) {
    state.timeScale = s.timeScale;
    el('ts-slider').value = Math.log10(s.timeScale);
    el('ts-label').textContent = '×' + fmtExp(s.timeScale);
  }
  if (typeof s.realScale === 'boolean') { state.realScale = s.realScale; el('realscale-chk').checked = s.realScale; }
  if (typeof s.ergo === 'boolean') { state.ergoOn = s.ergo; el('ergo-chk').checked = s.ergo; }
  if (typeof s.trails === 'boolean') { state.trailsOn = s.trails; el('trails-chk').checked = s.trails; }
  if (typeof s.field === 'boolean') { state.fieldOn = s.field; el('field-chk').checked = s.field; }
  if (s.quality && QUALITY[s.quality]) {
    quality = QUALITY[s.quality];
    el('quality-select').value = s.quality;
    resize();
  }
  if (s.cam) {
    if (typeof s.cam.theta === 'number') cam.theta = s.cam.theta;
    if (typeof s.cam.phi === 'number') cam.phi = s.cam.phi;
    if (s.cam.dist > 0) { cam.dist = cam.distT = s.cam.dist; }
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('bh-settings', JSON.stringify(snapshotSettings())); } catch (e) {}
  }, 400);
}
function loadSavedSettings() {
  try {
    const raw = localStorage.getItem('bh-settings');
    if (raw) applySettings(JSON.parse(raw));
  } catch (e) {}
}

function encodeScene() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(snapshotSettings()))));
}
function loadSceneFromURL() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return false;
  try {
    applySettings(JSON.parse(decodeURIComponent(escape(atob(m[1])))));
    return true;
  } catch (e) { return false; }
}

// ============================================================
// Инфопанель
// ============================================================
function updateObjDistances() {
  document.querySelectorAll('#obj-list span[data-oid]').forEach(sp => {
    const o = state.objects.find(x => x.id === sp.dataset.oid);
    if (o) sp.innerHTML = objListLabel(o);
  });
}

let infoTimer = 0;
function updateInfo(dt) {
  infoTimer -= dt;
  if (infoTimer > 0) return;
  infoTimer = 0.35;
  updateObjDistances();
  const M = state.M, rs = rs1();
  const isco = iscoRadius(state.spin);
  const Th = hawkingTemp(M);
  const tev = evaporationTime(M);
  const dens = M / (4 / 3 * Math.PI * rs ** 3);
  const kappa = C ** 4 / (4 * G * M);
  const Tisco = 2 * Math.PI * Math.sqrt(Math.pow(isco * rs, 3) / (G * M));
  const tidal2m = 2 * G * M / rs ** 3 * 2; // Δa на теле 2 м у горизонта
  const rows = [
    [T('iMass'), fmtMass(M)],
    [T('iHorizon'), fmtLength(rs)],
    [T('iDiam'), fmtLength(2 * rs)],
    [T('iPhoton'), fmtLength(1.5 * rs) + ' (1.5 r<sub>s</sub>)'],
    [TF('iISCO', { s: state.spin.toFixed(2) }), isco.toFixed(2) + ' r<sub>s</sub>'],
    [T('iTisco'), fmtTime(Tisco)],
    [T('iHawking'), fmtTemp(Th)],
    [T('iEvap'), fmtTime(tev)],
    [T('iDens'), fmtExp(dens) + ' ' + T('uKgM3')],
    [T('iKappa'), fmtExp(kappa) + ' ' + T('uMS2')],
    [T('iTidal'), fmtExp(tidal2m) + ' ' + T('uMS2')],
    [T('iDilation'), '×' + (1 / Math.sqrt(0.5)).toFixed(2)],
    [T('iObjects'), String(state.objects.length)],
  ];
  if (state.merger.active) {
    rows.push([T('iMergerHdr'), '']);
    rows.push([T('iM2'), fmtMass(state.merger.m2)]);
    rows.push([T('iSep'), fmtLength(state.merger.a)]);
    const fgw = Math.sqrt(G * (M + state.merger.m2) / state.merger.a ** 3) / Math.PI;
    rows.push([T('iFgw'), fmtExp(fgw) + ' ' + T('uHz')]);
  }
  el('info-body').innerHTML = '<table>' +
    rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('') + '</table>';

  if (state.merger.active) {
    el('gw-label').textContent = T('gwChirp');
  } else if (state.merger.done) {
    el('gw-label').textContent = T('gwRingdown');
  } else el('gw-label').textContent = '';
}

// ============================================================
// Главный цикл
// ============================================================
let lastT = performance.now();
let visT = 0; // визуальное время: замирает на паузе (вращение диска, грануляция)
let frameN = 0; // счётчик кадров (чередование эмиттеров частиц)
// физика и состояние — один шаг на кадр (общий для обычного и VR-цикла)
function tick(now) {
  frameN++;
  // clamp снизу: у первого кадра rAF-таймстамп может быть меньше lastT
  const dtReal = Math.max(0, Math.min((now - lastT) / 1000, 0.05));
  lastT = now;
  // визуальное время течёт медленнее для наблюдателя у горизонта (полёт)
  if (!state.paused) visT += dtReal * camTimeFactor;
  state._dtReal = dtReal * camTimeFactor;
  cineAutoSpawn(dtReal);

  if (!state.paused) {
    // у горизонта время наблюдателя замедляется — вся симуляция тоже
    const dtSim = dtReal * camTimeFactor * state.timeScale;
    state.simTime += dtSim;
    stepObjects(dtSim);
    stepGasClouds(dtSim);
    stepMerger(dtReal * camTimeFactor);
    stepHawking(dtSim);
  }
  // медленное поглощение захваченных объектов
  if (!state.paused) {
    let anyGone = false;
    for (const o of state.objects) {
      if (!o.accreting) continue;
      o.accT += dtReal;
      // перетекание массы на ЧД (Рош-переполнение)
      const dm = o.m * Math.min(dtReal / ACC_TIME, 0.5);
      o.m -= dm;
      state.M += dm;
      const f = o.m / o.m0;
      o.r = o.r0 * Math.cbrt(f);
      // разогрев: ярче и белее по мере обдирания
      o.em = Math.min(1, o.em0 + (1 - f) * 0.9);
      const hot = [1.0, 0.92, 0.8];
      o.col = o.col0.map((c, k) => c + (hot[k] - c) * (1 - f) * 0.85);
      // потеря углового момента — плавная спираль внутрь
      const drag = Math.min(0.07 * dtReal, 0.5);
      o.vel[0] *= 1 - drag; o.vel[1] *= 1 - drag; o.vel[2] *= 1 - drag;
      state.diskBoost = Math.min(3, state.diskBoost + dtReal * 0.18);
      if (f < 0.04) {
        // остаток растворился в диске — разовый выброс частиц
        const S = 1 / rs1();
        const ps = [o.pos[0] * S, o.pos[1] * S, o.pos[2] * S];
        const rl = Math.hypot(ps[0], ps[1], ps[2]) || 1;
        const dir = [-ps[0] / rl, -ps[1] / rl, -ps[2] / rl];
        const sv = o._sv || [0, 0, 0];
        const rBurst = Math.min(Math.max(o.r * S, 0.06) * 2.5, 0.9);
        pendingBurst = {
          pos: ps, r: rBurst, dir,
          vel: [sv[0] / PSPEED, sv[1] / PSPEED, sv[2] / PSPEED],
          len: rBurst,
          prob: 0.35,
          temp: Math.min(1.2, 0.35 + o.em * 0.5 + 0.45),
        };
        state.M += o.m;
        state.diskBoost = Math.min(3, state.diskBoost + 0.4);
        // финальная вспышка: световое эхо + волна яркости по диску
        triggerEcho(ps, Math.min(1.5, 0.7 + o.em * 0.6));
        addAccWave(o.pos, 1.4);
        o.dead = true;
        anyGone = true;
      }
    }
    if (anyGone) {
      state.objects = state.objects.filter(o => !o.dead);
      refreshObjList();
    }
  }

  // затухания эффектов
  state.diskBoost = Math.max(0, state.diskBoost - dtReal * 0.25);
  state.flash = Math.max(0, state.flash - dtReal * 0.5);
  if (!state.paused) {
    const dtv = dtReal * camTimeFactor;
    for (const w of state.accWaves) w.t += dtv;
    state.accWaves = state.accWaves.filter(w => w.t < 14);
    if (state.echo.t >= 0) {
      state.echo.t += dtv;
      if (state.echo.t > 10) state.echo.t = -1;
    }
  }
  if (state.rippleT >= 0) {
    state.rippleT += dtReal;
    if (state.rippleT > 9) { state.rippleT = -1; state.merger.done = false; }
  }

  updateCamera(dtReal);
  return dtReal;
}

function frame(now) {
  if (xr.session) return; // кадры ведёт XR-сессия; вернёмся по её завершении
  const dtReal = tick(now);
  render(visT);
  saveShotIfNeeded();
  drawGW();
  updateInfo(dtReal);
  requestAnimationFrame(frame);
}

function render(t) {
  const rs = rs1();
  const S = 1 / rs; // метры -> сценические единицы (rs главной ЧД = 1)
  const cv = cameraVectors();

  // --- основной проход: рейтрейсинг в HDR-текстуру ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.scene.fbo);
  gl.viewport(0, 0, RT.scene.w, RT.scene.h);
  gl.useProgram(mainP.prog);

  gl.uniform2f(U.uRes, RT.scene.w, RT.scene.h);
  gl.uniform1f(U.uTime, t);
  gl.uniform3f(U.uCamPos, cv.pos[0], cv.pos[1], cv.pos[2]);
  gl.uniformMatrix3fv(U.uCamMat, false, [
    cv.right[0], cv.right[1], cv.right[2],
    cv.up[0], cv.up[1], cv.up[2],
    cv.fwd[0], cv.fwd[1], cv.fwd[2],
  ]);
  gl.uniform1f(U.uFov, cam.fov);
  gl.uniform1i(U.uXR, xrCam ? 1 : 0);
  gl.uniform4f(U.uXRTan, xrTan[0], xrTan[1], xrTan[2], xrTan[3]);
  gl.uniform1i(U.uSteps, quality.steps);
  gl.uniform1i(U.uDetail, quality.detail ? 1 : 0);

  // падающий наблюдатель: аберрация/допплер от скорости, приливное сплющивание внутри
  if (camMode.imm && immersion.active && !horizonPlaying) {
    const beta = Math.min(immBetaLocal(), 0.96);
    // движемся к дыре: направление полёта — минус радиаль
    gl.uniform4f(U.uFallV, -immersion.dir[0], -immersion.dir[1], -immersion.dir[2], beta);
    let flatK = 0;
    if (immersion.r < 1) {
      const depth = (1 - immersion.r) / Math.max(1 - immersion.rSpag, 1e-3);
      flatK = Math.pow(Math.min(depth, 1), 1.7);
    }
    gl.uniform1f(U.uFlat, flatK);
  } else {
    gl.uniform4f(U.uFallV, 0, 0, 1, 0);
    gl.uniform1f(U.uFlat, 0);
  }

  // ЧД
  const bhs = bhList();
  const bhPos = new Float32Array(6), bhRs = new Float32Array(2), bhSpin = new Float32Array(2);
  bhs.forEach((bh, i) => {
    bhPos[i*3] = bh.pos[0] * S; bhPos[i*3+1] = bh.pos[1] * S; bhPos[i*3+2] = bh.pos[2] * S;
    bhRs[i] = bh.rs * S;
    bhSpin[i] = state.spin;
  });
  gl.uniform1i(U.uNumBH, bhs.length);
  gl.uniform3fv(U.uBHPos, bhPos);
  gl.uniform1fv(U.uBHRs, bhRs);
  gl.uniform1fv(U.uBHSpin, bhSpin);

  // диск: температура автоматически зависит от массы (T ∝ M^-1/4) + пользовательская
  const autoT = Math.min(30000, Math.max(2500, diskTempEstimate(state.M) * 0.002 + state.diskTempUser));
  gl.uniform1i(U.uDiskOn, state.diskOn ? 1 : 0);
  gl.uniform1f(U.uDiskIn, Math.max(state.diskIn, iscoRadius(state.spin) * 0.75));
  gl.uniform1f(U.uDiskOut, state.diskOut);
  gl.uniform1f(U.uDiskTemp, autoT);
  gl.uniform1f(U.uDiskBright, state.diskBright);
  gl.uniform1f(U.uDiskBoost, state.diskBoost);

  // объекты
  const n = Math.min(state.objects.length, MAXOBJ);
  const opos = new Float32Array(MAXOBJ * 4), ocol = new Float32Array(MAXOBJ * 4);
  // самая массивная поглощаемая звезда — источник струи частиц и растяжения
  let streamObj = null;
  for (const o of state.objects) {
    if (o.accreting && (!streamObj || o.m > streamObj.m)) streamObj = o;
  }
  let stretchIdx = -1;
  const stretch = [1, 0, 0, 1];
  emitter = null;
  const bhScene = [bhPos[0], bhPos[1], bhPos[2]];
  for (let i = 0; i < n; i++) {
    const o = state.objects[i];
    opos[i*4] = o.pos[0] * S; opos[i*4+1] = o.pos[1] * S; opos[i*4+2] = o.pos[2] * S;
    let vr = o.r * S;
    if (!state.realScale) {
      // видимый минимум, чтобы объекты не исчезали на фоне гигантской ЧД
      const minVis = 0.012 * (1 + cam.dist * 0.02);
      vr = Math.max(vr, minVis);
      vr = Math.min(vr, 1.2);
    }
    // поглощаемая звезда тает
    if (o.accreting) vr *= Math.max(0.25, Math.cbrt(o.m / o.m0));
    opos[i*4+3] = vr;
    ocol[i*4] = o.col[0]; ocol[i*4+1] = o.col[1]; ocol[i*4+2] = o.col[2];
    ocol[i*4+3] = o.em;
    if (o === streamObj) {
      const f = o.m / o.m0;
      const ps = [opos[i*4], opos[i*4+1], opos[i*4+2]];
      // тянет к ближайшей ЧД (при слиянии их две)
      let bScene = bhScene;
      if (bhs.length > 1) {
        const d0 = Math.hypot(bhPos[0] - ps[0], bhPos[1] - ps[1], bhPos[2] - ps[2]);
        const d1 = Math.hypot(bhPos[3] - ps[0], bhPos[4] - ps[1], bhPos[5] - ps[2]);
        if (d1 < d0) bScene = [bhPos[3], bhPos[4], bhPos[5]];
      }
      const rel = [bScene[0] - ps[0], bScene[1] - ps[1], bScene[2] - ps[2]];
      const rl = Math.hypot(rel[0], rel[1], rel[2]) || 1;
      const dir = [rel[0] / rl, rel[1] / rl, rel[2] / rl];
      // фактическая экранная скорость звезды (сцена/с) — частицы должны лететь с ней
      const tNow = performance.now() / 1000;
      let sv = [0, 0, 0];
      if (o._pp && tNow - o._pt > 1e-4) {
        const idt = 1 / (tNow - o._pt);
        sv = [(ps[0] - o._pp[0]) * idt, (ps[1] - o._pp[1]) * idt, (ps[2] - o._pp[2]) * idt];
        const svm = Math.hypot(sv[0], sv[1], sv[2]);
        if (svm > 3) { sv[0] *= 3 / svm; sv[1] *= 3 / svm; sv[2] *= 3 / svm; }
      }
      o._pp = ps; o._pt = tNow; o._sv = sv;
      // приливное растяжение вдоль оси к ЧД
      stretchIdx = i;
      stretch[0] = dir[0]; stretch[1] = dir[1]; stretch[2] = dir[2];
      stretch[3] = Math.min(1 + Math.min(o.accT * 0.35, 1.0) + (1 - f) * 1.4, 2.8);
      // температура вещества — от цвета звезды (тёплые рвутся оранжевой струёй)
      const cTemp = 0.24 + 0.5 * (o.col[2] * 0.55 + o.col[1] * 0.30);
      emitter = {
        pos: ps, r: vr, dir,
        vel: [sv[0] / PSPEED, sv[1] / PSPEED, sv[2] / PSPEED],
        len: vr * stretch[3],
        prob: Math.min(0.07, 0.012 + o.accT * 0.02),
        temp: Math.min(1.1, cTemp + (1 - f) * 0.35),
      };
    }
  }
  // газовые облака: постоянное испарение вещества в частицы;
  // кадры делятся со струёй TDE, если обе активны
  if (gasClouds.length) {
    const gc = gasClouds[frameN % gasClouds.length];
    const ps = [gc.pos[0] * S, gc.pos[1] * S, gc.pos[2] * S];
    const tNow = performance.now() / 1000;
    let sv = [0, 0, 0];
    if (gc._pp && tNow - gc._pt > 1e-4) {
      const idt = 1 / (tNow - gc._pt);
      sv = [(ps[0] - gc._pp[0]) * idt, (ps[1] - gc._pp[1]) * idt, (ps[2] - gc._pp[2]) * idt];
      const svm = Math.hypot(sv[0], sv[1], sv[2]);
      if (svm > 3) { sv[0] *= 3 / svm; sv[1] *= 3 / svm; sv[2] *= 3 / svm; }
    }
    gc._pp = ps; gc._pt = tNow;
    const rl = Math.hypot(ps[0], ps[1], ps[2]) || 1;
    // uEmit.w задаёт разброс (×0.22 в шейдере) — надуваем до размера облака
    const spread = Math.min(Math.max(gc.rM * S * 0.8, 0.35), 1.6);
    const gEmit = {
      pos: ps, r: spread / 0.22,
      dir: [-ps[0] / rl, -ps[1] / rl, -ps[2] / rl],
      vel: [sv[0] / PSPEED, sv[1] / PSPEED, sv[2] / PSPEED],
      len: 0.02, prob: 0.035, temp: gc.temp,
    };
    if (!emitter || (frameN & 1)) emitter = gEmit;
  }
  // разовый выброс при полном разрушении объекта
  if (pendingBurst) {
    emitter = pendingBurst;
    pendingBurst = null;
  }
  gl.uniform1i(U.uObjCount, n);
  gl.uniform4fv(U.uObjPos, opos);
  gl.uniform4fv(U.uObjCol, ocol);
  gl.uniform1i(U.uStretchIdx, stretchIdx);
  gl.uniform4f(U.uStretch, stretch[0], stretch[1], stretch[2], stretch[3]);

  gl.uniform1f(U.uFlash, state.flash);
  gl.uniform1f(U.uRippleT, state.rippleT);

  // эргосфера, световое эхо, волны аккреции
  gl.uniform1i(U.uErgo, state.ergoOn ? 1 : 0);
  const ec = state.echo;
  const eStr = ec.t >= 0 ? ec.str * Math.exp(-ec.t * 0.30) : 0;
  gl.uniform3f(U.uEchoPos, ec.pos[0], ec.pos[1], ec.pos[2]);
  gl.uniform1f(U.uEchoR, Math.max(ec.t, 0) * 3.2);
  gl.uniform1f(U.uEchoStr, eStr);
  const nW = Math.min(state.accWaves.length, 3);
  const wArr = new Float32Array(12);
  for (let i = 0; i < nW; i++) {
    const w = state.accWaves[i];
    wArr[i * 4] = w.phi; wArr[i * 4 + 1] = w.r0;
    wArr[i * 4 + 2] = w.t; wArr[i * 4 + 3] = w.str;
  }
  gl.uniform1i(U.uAccN, nW);
  gl.uniform4fv(U.uAccWave, wArr);

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // --- частицы приливного разрушения: симуляция + рендер в сцену ---
  // (в VR кадр рисуется дважды — на второй глаз симуляцию не шагаем)
  if (!state.paused && xrEye === 0) {
    const diskInR = Math.max(state.diskIn, iscoRadius(state.spin) * 0.75);
    stepParticles(state._dtReal || 0.016, bhScene, diskInR);
  }
  drawParticles(cv, bhScene);
  drawTrails(cv, bhScene);
  drawFieldLines(cv, bhScene);
  drawPulsarBeams(cv, bhScene);

  // --- bloom: яркостный проход в полразрешения ---
  pass(brightP, RT.halfA, (u, w, h) => {
    gl.uniform2f(u.uRes, w, h);
    bindTex(0, RT.scene.tex, u.uTex);
  });
  // размытие half: A -> B -> A (на «Абсурде» — несколько итераций, шире и мягче)
  const nBlur = quality.blur || 1;
  for (let k = 0; k < nBlur; k++) {
    pass(blurP, RT.halfB, (u, w, h) => {
      gl.uniform2f(u.uRes, w, h);
      gl.uniform2f(u.uDir, 1, 0);
      bindTex(0, RT.halfA.tex, u.uTex);
    });
    pass(blurP, RT.halfA, (u, w, h) => {
      gl.uniform2f(u.uRes, w, h);
      gl.uniform2f(u.uDir, 0, 1);
      bindTex(0, RT.halfB.tex, u.uTex);
    });
  }
  // широкое размытие quarter: halfA -> quartA -> quartB -> quartA
  pass(blurP, RT.quartA, (u, w, h) => {
    gl.uniform2f(u.uRes, w, h);
    gl.uniform2f(u.uDir, 1, 0);
    bindTex(0, RT.halfA.tex, u.uTex);
  });
  for (let k = 0; k < nBlur; k++) {
    pass(blurP, RT.quartB, (u, w, h) => {
      gl.uniform2f(u.uRes, w, h);
      gl.uniform2f(u.uDir, 0, 1);
      bindTex(0, RT.quartA.tex, u.uTex);
    });
    pass(blurP, RT.quartA, (u, w, h) => {
      gl.uniform2f(u.uRes, w, h);
      gl.uniform2f(u.uDir, 1, 0);
      bindTex(0, RT.quartB.tex, u.uTex);
    });
  }

  // --- композит на экран (в VR — во вьюпорт глаза) ---
  pass(compP, null, (u, w, h, x, y) => {
    gl.uniform2f(u.uRes, w, h);
    gl.uniform4f(u.uVp, x, y, w, h);
    gl.uniform1i(u.uXR, xrCam ? 1 : 0);
    // дизеринг живёт на реальном времени, чтобы не «застывал» на паузе
    gl.uniform1f(u.uTime, performance.now() / 1000);
    gl.uniform1f(u.uExposure, 1.25);
    // плавное появление визора скафандра в погружении
    const helmetT = camMode.imm && !horizonPlaying ? 1 : 0;
    helmetK += (helmetT - helmetK) * 0.06;
    if (!helmetT && helmetK < 0.003) helmetK = 0;
    // в VR дисторсию визора не рисуем: оптика шлема — сама «визор»
    gl.uniform1f(u.uHelmet, xrCam ? 0 : helmetK);
    gl.uniform1f(u.uEngulf, engulfK);
    bindTex(0, RT.scene.tex, u.uScene);
    bindTex(1, RT.halfA.tex, u.uBloom1);
    bindTex(2, RT.quartA.tex, u.uBloom2);
  });
}

// ============================================================
// WebXR: стерео-рендер для VR-шлемов (Quest 2/3/3S, Meta Quest Browser)
// ============================================================
// Профили VR-качества.
// Автономный шлем (Adreno в Quest) не тянет рейтрейсинг — минимум шагов,
// а разрешение глаза подстраивается на лету (xrPerf). Через Link/SteamVR
// рендерит GPU ПК — берём текущий пресет пользователя (1–8 работают и в VR).
const XR_MOBILE = { steps: 28, blur: 1 };
// адаптивное разрешение: ema — сглаженное время кадра (мс), hold — пауза между шагами
const xrPerf = { scale: 0.5, min: 0.3, max: 0.85, ema: 13, last: 0, hold: 0 };

function xrMobileGPU() {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /adreno|mali|powervr|qualcomm|snapdragon|xclipse|immortalis/i.test(r);
  } catch (e) { return false; }
}

async function enterVR() {
  if (xr.session) { xr.session.end(); return; }
  if (!navigator.xr) return;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor'],
    });
    await gl.makeXRCompatible();
    const mobile = xrMobileGPU();
    xr.layer = new XRWebGLLayer(session, gl, {
      antialias: false,
      framebufferScaleFactor: mobile ? 0.85 : 1.0,
    });
    // фовеация: Quest сильно экономит на периферии кадра
    if ('fixedFoveation' in xr.layer) xr.layer.fixedFoveation = 1;
    session.updateRenderState({ baseLayer: xr.layer });
    xr.refSpace = await session.requestReferenceSpace('local');
    xr.session = session;
    xr.savedQ = quality;
    if (mobile) {
      quality = XR_MOBILE;
      xrPerf.scale = 0.5; xrPerf.min = 0.3; xrPerf.max = 0.85;
    } else {
      // ПК (Link/Air Link/SteamVR): шаги и bloom из пресета пользователя,
      // масштаб глаза адаптивный в комфортных пределах
      xrPerf.scale = Math.min(quality.scale || 1, 1);
      xrPerf.min = 0.45; xrPerf.max = 1.0;
    }
    xrPerf.ema = 13; xrPerf.last = 0; xrPerf.hold = 0;
    const btn = document.getElementById('vr-btn');
    if (btn) btn.classList.add('active');
    session.addEventListener('end', () => {
      xr.session = null;
      if (xr.rt) { Object.values(xr.rt).forEach(destroyTarget); xr.rt = null; }
      xrCam = null; xrEye = 0;
      xrOut.fb = null; xrOut.vp = null;
      vrUi.on = false; vrUi.toggleReq = false;
      vrUi.hover = null; vrUi.ray = null; vrUi.cursor = null;
      if (xr.savedQ) quality = xr.savedQ;
      if (btn) btn.classList.remove('active');
      resize();
      lastT = performance.now();
      requestAnimationFrame(frame); // возвращаем обычный цикл кадров
    });
    session.requestAnimationFrame(xrFrame);
  } catch (err) {
    console.warn('WebXR: VR-сессия не запустилась', err);
  }
}

// сколько сценических единиц (rs = 1) в одном метре реальной головы:
// задаёт стереобазу — в погружении дыра огромна, на орбите — «макет» неподалёку
function xrWorldScale() {
  if (camMode.imm || camMode.fly) return 0.02;
  return Math.max(0.01, cam.dist / 30);
}

// вектор из системы шлема в мир через риг симулятора: +x -> right, +y -> up, -z -> fwd
function xrRigVec(cv, v) {
  return [
    cv.right[0] * v[0] + cv.up[0] * v[1] - cv.fwd[0] * v[2],
    cv.right[1] * v[0] + cv.up[1] * v[1] - cv.fwd[1] * v[2],
    cv.right[2] * v[0] + cv.up[2] * v[1] - cv.fwd[2] * v[2],
  ];
}

function xrFrame(now, xrf) {
  const session = xr.session;
  if (!session) return;
  session.requestAnimationFrame(xrFrame);
  tick(now); // физика — один шаг на кадр, глаза делят состояние
  const layer = xr.layer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pose = xrf.getViewerPose(xr.refSpace);
  if (!pose) { pollXRInput(); return; }
  // VR-меню: запрос на показ/скрытие (X), указатель, фоновая вибрация
  if (vrUi.toggleReq) {
    vrUi.toggleReq = false;
    vrUi.on = !vrUi.on;
    if (vrUi.on) vrPlaceMenu(pose);
  }
  vrUpdatePointer(session, xrf);
  pollXRInput();
  xrHaptics();
  // адаптивное разрешение: если кадр не влезает в такт дисплея — уменьшаем
  // масштаб рендера глаза, если есть запас — понемногу возвращаем
  if (xrPerf.last) {
    const dtMs = Math.min(now - xrPerf.last, 100);
    xrPerf.ema += (dtMs - xrPerf.ema) * 0.08;
    if (--xrPerf.hold <= 0) {
      if (xrPerf.ema > 16.5 && xrPerf.scale > xrPerf.min) {
        xrPerf.scale = Math.max(xrPerf.min, xrPerf.scale - 0.06);
        xrPerf.hold = 45;   // ~полсекунды на стабилизацию после шага вниз
      } else if (xrPerf.ema < 12.2 && xrPerf.scale < xrPerf.max) {
        xrPerf.scale = Math.min(xrPerf.max, xrPerf.scale + 0.03);
        xrPerf.hold = 90;
      }
    }
  }
  xrPerf.last = now;
  const rig = cameraVectors(); // куда «смотрит» симулятор (орбита/полёт/погружение)
  const ws = xrWorldScale();
  const mainRT = RT;
  for (let i = 0; i < pose.views.length; i++) {
    const view = pose.views[i];
    const vp = layer.getViewport(view);
    if (!vp || !vp.width) continue;
    const rw = Math.max(2, Math.round(vp.width * xrPerf.scale));
    const rh = Math.max(2, Math.round(vp.height * xrPerf.scale));
    if (!xr.rt || xr.rt.scene.w !== rw || xr.rt.scene.h !== rh) {
      if (xr.rt) Object.values(xr.rt).forEach(destroyTarget);
      xr.rt = makeRTSet(rw, rh);
    }
    // асимметричный фрустум глаза: тангенсы из проекционной матрицы XRView
    const p = view.projectionMatrix;
    xrTan = [(p[8] - 1) / p[0], (p[8] + 1) / p[0], (p[9] - 1) / p[5], (p[9] + 1) / p[5]];
    // базис глаза = риг симулятора × поза шлема (столбцы rigid-матрицы)
    const m = view.transform.matrix;
    const off = xrRigVec(rig, [m[12], m[13], m[14]]);
    xrCam = {
      pos: [rig.pos[0] + off[0] * ws, rig.pos[1] + off[1] * ws, rig.pos[2] + off[2] * ws],
      right: xrRigVec(rig, [m[0], m[1], m[2]]),
      up: xrRigVec(rig, [m[4], m[5], m[6]]),
      fwd: xrRigVec(rig, [-m[8], -m[9], -m[10]]),
    };
    xrEye = i;
    RT = xr.rt; // весь конвейер (raymarch, частицы, bloom) рисует в цели глаза
    xrOut.fb = layer.framebuffer;
    xrOut.vp = [vp.x, vp.y, vp.width, vp.height];
    render(visT);
    drawVROverlay(view, vp); // меню, луч-указатель, HUD скафандра
  }
  RT = mainRT;
  xrCam = null; xrEye = 0;
  xrOut.fb = null; xrOut.vp = null;
}

// контроллеры Touch: правый стик — взгляд/орбита, левый — зум (в полёте — ход),
// курок — спавн (или клик по меню), squeeze — погружение, X — меню, A — пауза, B — выход
function pollXRInput() {
  if (!xr.session) return;
  for (const src of xr.session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const dz = v => (Math.abs(v || 0) > 0.15 ? v : 0);
    const sx = dz(gp.axes[2]), sy = dz(gp.axes[3]);
    if (src.handedness === 'right') {
      if (camMode.fly || camMode.imm) {
        flyCam.yaw -= sx * 0.04;
        flyCam.pitch = Math.max(-1.5, Math.min(1.5, flyCam.pitch - sy * 0.03));
      } else {
        cam.phi += sx * 0.04;
        cam.theta = Math.max(-1.35, Math.min(1.35, cam.theta + sy * 0.03));
      }
    } else if (src.handedness === 'left') {
      if (camMode.fly && sy) {
        const cv = cameraVectors();
        const sp = flyCam.speed * -sy / 72;
        flyCam.pos[0] += cv.fwd[0] * sp;
        flyCam.pos[1] += cv.fwd[1] * sp;
        flyCam.pos[2] += cv.fwd[2] * sp;
      } else if (!camMode.imm) {
        cam.distT = Math.max(2.2, Math.min(300, cam.distT * Math.exp(sy * 0.03)));
      }
    }
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const h = src.handedness;
    if (h === 'right') {
      // курок над меню — клик, иначе — спавн выбранного объекта
      xrBtnEdge('r-trig', b(0), () => {
        if (vrUi.on && vrUi.hover) { vrClickHover(); xrPulse('right', 0.4, 30); }
        else { el('spawn-btn').click(); xrPulse('right', 0.55, 60); }
      });
      xrBtnEdge('r-a', b(4), () => {
        state.paused = !state.paused;
        el('pause-chk').checked = state.paused;
        vrUi.dirty = true;
      });
    } else {
      xrBtnEdge('l-trig', b(0), () => { el('spawn-btn').click(); xrPulse('left', 0.55, 60); });
      xrBtnEdge('l-x', b(4), () => { vrUi.toggleReq = true; });
    }
    xrBtnEdge(h + 'sq', b(1), () => {
      if (immersion.active) exitImmersion();
      else startImmersion(+el('imm-dist').value, +el('imm-speed').value);
      vrUi.dirty = true;
    });
    xrBtnEdge(h + 'b', b(5), () => xr.session && xr.session.end());
  }
}
function xrBtnEdge(k, v, fn) {
  if (v && !xr.btn[k]) fn();
  xr.btn[k] = v;
}

// вибрация контроллеров: hand = 'left' | 'right' | null (обе)
function xrPulse(hand, val, ms) {
  if (!xr.session) return;
  for (const src of xr.session.inputSources) {
    if (hand && src.handedness !== hand) continue;
    const act = src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (act && act.pulse) act.pulse(Math.min(Math.max(val, 0), 1), ms);
  }
}

// фоновая гаптика: чирп слияния, удар коалесценции, приливы в погружении
function xrHaptics() {
  const mg = state.merger;
  if (mg.active && !mg.done && mg.a0 > 0) {
    const k = 1 - mg.a / mg.a0;
    if (k > 0.55) {
      const v = Math.min(1, (k - 0.55) * 2.2);
      xrPulse(null, v * v * 0.8, 40);
    }
  }
  if (state.rippleT >= 0 && state.rippleT < 0.25) xrPulse(null, 1, 250);
  if (camMode.imm && immersion.active && !horizonPlaying) {
    const t = suitTelemetry().tidalG;
    if (t > 0.2) xrPulse(null, Math.min(0.9, t / 40), 40);
  }
}

// ============================================================
// VR-меню (панель перед взглядом, X — показать/скрыть), луч-указатель
// правого контроллера и head-locked HUD скафандра в погружении
// ============================================================
const VRUI_W = 512, VRUI_H = 704;   // канвас панели меню
const VRHUD_W = 512, VRHUD_H = 224; // канвас HUD погружения
const vrUi = {
  on: false, toggleReq: false,
  pos: null, xAx: null, yAx: null, nrm: null, // панель в refSpace (метры)
  w: 0.40, h: 0.55,
  canvas: null, tex: null, dirty: true,
  hit: [],            // хитбоксы кнопок в px канваса
  hover: null,        // кнопка под лучом
  ray: null,          // { o, d } правого контроллера (refSpace)
  cursor: null,       // точка попадания луча в панель
  hudCanvas: null, hudTex: null, hudLast: 0,
};
const IDENT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function vrMakeTex(w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function vrUploadCanvas(tex, cnv) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cnv);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

// строки меню: циклические селекторы поверх обычных DOM-контролов,
// чтобы VR и 2D-интерфейс всегда были синхронны
function vrMenuRows() {
  const catSel = el('cat-select'), objSel = el('obj-select');
  const ps = el('preset-select'), ds = el('disk-preset');
  const cur = sel => (sel.options[sel.selectedIndex] || {}).textContent || '—';
  const cyc = (sel, d, after) => {
    const n = sel.options.length;
    if (!n) return;
    sel.selectedIndex = (sel.selectedIndex + d + n) % n;
    if (after) after();
  };
  return [
    { id: 'cat', label: T('vrCat'), val: () => cur(catSel), cyc: d => cyc(catSel, d, () => catSel.onchange()) },
    { id: 'obj', label: T('vrObj'), val: () => cur(objSel), cyc: d => cyc(objSel, d, () => objSel.onchange()) },
    { id: 'bh', label: T('vrBH'), val: () => cur(ps), cyc: d => cyc(ps, d, () => el('preset-apply').click()) },
    { id: 'plasma', label: T('vrPlasma'), val: () => cur(ds), cyc: d => cyc(ds, d, () => ds.onchange()) },
    { id: 'time', label: T('vrTime'), val: () => '×' + fmtExp(state.timeScale), cyc: d => {
      const s = el('ts-slider');
      s.value = Math.max(-1, Math.min(9, +s.value + d * 0.5));
      s.dispatchEvent(new Event('input'));
    } },
  ];
}
function vrMenuToggles() {
  return [
    { id: 'pause', label: T('vrPause'), on: () => state.paused, act: () => {
      state.paused = !state.paused;
      el('pause-chk').checked = state.paused;
    } },
    { id: 'disk', label: T('vrDisk'), on: () => state.diskOn, act: () => {
      const c = el('disk-on');
      c.checked = !c.checked;
      c.dispatchEvent(new Event('change'));
    } },
    { id: 'merge', label: T('vrMerge'), on: () => state.merger.active, act: () => {
      state.merger.active ? stopMerger() : startMerger();
    } },
    { id: 'imm', label: T('vrImm'), on: () => immersion.active, act: () => {
      if (immersion.active) exitImmersion();
      else startImmersion(+el('imm-dist').value, +el('imm-speed').value);
    } },
  ];
}

function vrDrawMenu() {
  if (!vrUi.canvas) {
    vrUi.canvas = document.createElement('canvas');
    vrUi.canvas.width = VRUI_W;
    vrUi.canvas.height = VRUI_H;
  }
  const ctx = vrUi.canvas.getContext('2d');
  const W = VRUI_W, H = VRUI_H;
  vrUi.hit = [];
  ctx.clearRect(0, 0, W, H);
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  rr(0, 0, W, H, 26);
  ctx.fillStyle = 'rgba(10, 12, 20, 0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 160, 60, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#ffb45e';
  ctx.font = '600 30px "Segoe UI", sans-serif';
  ctx.fillText(T('vrMenuTitle'), 26, 48);

  const btn = (x, y, w, h, id, act, label, active) => {
    rr(x, y, w, h, 12);
    ctx.fillStyle = active ? 'rgba(255, 120, 40, 0.4)'
      : vrUi.hover && vrUi.hover.id === id ? 'rgba(255, 180, 90, 0.28)'
      : 'rgba(255, 255, 255, 0.07)';
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(255, 160, 60, 0.9)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#eee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    vrUi.hit.push({ x, y, w, h, id, act });
  };

  let y = 74;
  const rowH = 88;
  for (const row of vrMenuRows()) {
    ctx.fillStyle = '#99a';
    ctx.font = '20px "Segoe UI", sans-serif';
    ctx.fillText(row.label, 26, y + 20);
    ctx.font = '600 24px "Segoe UI", sans-serif';
    btn(26, y + 30, 56, 48, row.id + '<', () => row.cyc(-1), '‹');
    btn(W - 82, y + 30, 56, 48, row.id + '>', () => row.cyc(1), '›');
    // значение по центру, с обрезкой длинных названий
    ctx.fillStyle = '#ffd9a0';
    ctx.font = '600 23px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    let v = row.val();
    while (ctx.measureText(v).width > W - 200 && v.length > 3) v = v.slice(0, -2);
    ctx.fillText(v, W / 2, y + 60);
    ctx.textAlign = 'left';
    y += rowH;
  }

  // тогглы 2×2
  y += 6;
  const toggles = vrMenuToggles();
  const bw = (W - 26 * 2 - 20) / 2, bh = 62;
  ctx.font = '600 23px "Segoe UI", sans-serif';
  toggles.forEach((t, i) => {
    const bx = 26 + (i % 2) * (bw + 20);
    const by = y + Math.floor(i / 2) * (bh + 14);
    btn(bx, by, bw, bh, t.id, t.act, t.label, t.on());
  });
  y += 2 * bh + 14;

  ctx.fillStyle = '#667';
  ctx.font = '17px "Segoe UI", sans-serif';
  ctx.fillText(T('vrFooter'), 26, H - 22);
}

function vrClickHover() {
  const hb = vrUi.hover;
  if (!hb) return;
  hb.act();
  vrUi.dirty = true;
}

// панель появляется в 60 см перед взглядом, вертикально, лицом к пользователю
function vrPlaceMenu(pose) {
  const hm = pose.transform.matrix;
  let f = [-hm[8], -hm[9], -hm[10]];
  const fl = Math.hypot(f[0], f[2]) || 1;
  f = [f[0] / fl, 0, f[2] / fl];
  vrUi.pos = [hm[12] + f[0] * 0.6, hm[13] - 0.02, hm[14] + f[2] * 0.6];
  vrUi.nrm = [-f[0], 0, -f[2]];
  vrUi.xAx = norm3(cross3(f, [0, 1, 0])); // «право» для смотрящего
  vrUi.yAx = [0, 1, 0];
  vrUi.dirty = true;
}

// луч правого контроллера: пересечение с плоскостью панели -> hover/курсор
function vrUpdatePointer(session, xrf) {
  vrUi.ray = null;
  vrUi.cursor = null;
  const prevHover = vrUi.hover;
  vrUi.hover = null;
  for (const src of session.inputSources) {
    if (src.handedness !== 'right' || !src.targetRaySpace) continue;
    const p = xrf.getPose(src.targetRaySpace, xr.refSpace);
    if (!p) continue;
    const m = p.transform.matrix;
    vrUi.ray = { o: [m[12], m[13], m[14]], d: norm3([-m[8], -m[9], -m[10]]) };
  }
  if (vrUi.on && vrUi.pos && vrUi.ray) {
    const { o, d } = vrUi.ray;
    const rel = [vrUi.pos[0] - o[0], vrUi.pos[1] - o[1], vrUi.pos[2] - o[2]];
    const denom = d[0] * vrUi.nrm[0] + d[1] * vrUi.nrm[1] + d[2] * vrUi.nrm[2];
    if (Math.abs(denom) > 1e-4) {
      const t = (rel[0] * vrUi.nrm[0] + rel[1] * vrUi.nrm[1] + rel[2] * vrUi.nrm[2]) / denom;
      if (t > 0.05 && t < 4) {
        const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
        const lp = [p[0] - vrUi.pos[0], p[1] - vrUi.pos[1], p[2] - vrUi.pos[2]];
        const lu = (lp[0] * vrUi.xAx[0] + lp[1] * vrUi.xAx[1] + lp[2] * vrUi.xAx[2]) / vrUi.w + 0.5;
        const lv = (lp[0] * vrUi.yAx[0] + lp[1] * vrUi.yAx[1] + lp[2] * vrUi.yAx[2]) / vrUi.h + 0.5;
        if (lu >= 0 && lu <= 1 && lv >= 0 && lv <= 1) {
          vrUi.cursor = p;
          const px = lu * VRUI_W, py = (1 - lv) * VRUI_H;
          vrUi.hover = vrUi.hit.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) || null;
        }
      }
    }
  }
  if ((prevHover && prevHover.id) !== (vrUi.hover && vrUi.hover.id)) vrUi.dirty = true;
}

// HUD погружения: телеметрия скафандра на полупрозрачной плашке ниже взгляда
function vrDrawHud() {
  if (!vrUi.hudCanvas) {
    vrUi.hudCanvas = document.createElement('canvas');
    vrUi.hudCanvas.width = VRHUD_W;
    vrUi.hudCanvas.height = VRHUD_H;
  }
  const ctx = vrUi.hudCanvas.getContext('2d');
  const W = VRHUD_W, H = VRHUD_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(6, 10, 18, 0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120, 210, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const s = suitTelemetry();
  const beta = Math.min(immBetaLocal(), 0.999);
  const cyan = 'rgba(150, 220, 255, 0.9)', warn = 'rgba(255, 130, 80, 0.95)';
  ctx.font = '600 34px Consolas, monospace';
  ctx.fillStyle = cyan;
  ctx.fillText(`r ${immersion.r.toFixed(2)} rs`, 24, 52);
  ctx.fillText(`v ${(beta * 100).toFixed(0)}% c`, 270, 52);

  // отсчёт: до горизонта снаружи, до гибели внутри
  ctx.font = '600 30px Consolas, monospace';
  if (immersion.r > 1 && immersion.rSpag < 1) {
    const tHor = immFallTime(immersion.r, 1) * rs1() / C / immersion.speed;
    ctx.fillStyle = cyan;
    ctx.fillText(TF('hudHorizon', { t: fmtTime(Math.max(tHor, 0)) }), 24, 104);
  } else {
    const tSpag = immFallTime(immersion.r, immersion.rSpag) * rs1() / C / immersion.speed;
    ctx.fillStyle = warn;
    const inside = immersion.r <= 1 ? T('hudInside') + ' · ' : '';
    ctx.fillText(inside + TF('hudDoom', { t: fmtTime(Math.max(tSpag, 0)) }), 24, 104);
  }

  // текстовые метки вместо эмодзи: канвас в Quest Browser может не иметь эмодзи-шрифта
  ctx.font = '22px Consolas, monospace';
  ctx.fillStyle = s.pulse > 150 ? warn : cyan;
  ctx.fillText(`${T('sPulse')} ${s.pulse}`, 24, 156);
  ctx.fillStyle = +s.o2 < 25 ? warn : cyan;
  ctx.fillText(`${T('sO2')} ${s.o2}%`, 210, 156);
  ctx.fillStyle = s.integ < 70 ? warn : cyan;
  ctx.fillText(`${T('sIntegr')} ${s.integ.toFixed(0)}%`, 330, 156);
  ctx.fillStyle = s.sig > 0 ? (s.sig < 35 ? warn : cyan) : warn;
  ctx.fillText(s.sig > 0 ? `${T('sSignal')} ${s.sig.toFixed(0)}%` : T('sNoSignal'), 24, 198);
  ctx.fillStyle = s.tidalG > 1 ? warn : cyan;
  ctx.fillText(`${T('sTidal')} ${s.fmtG} g`, 270, 198);
}

// сборка квада: центр c, полуоси ax/ay, uv 0..1 (v вверх)
function vrPushQuad(arr, c, ax, ay) {
  const v = [
    [c[0] - ax[0] - ay[0], c[1] - ax[1] - ay[1], c[2] - ax[2] - ay[2], 0, 0],
    [c[0] + ax[0] - ay[0], c[1] + ax[1] - ay[1], c[2] + ax[2] - ay[2], 1, 0],
    [c[0] + ax[0] + ay[0], c[1] + ax[1] + ay[1], c[2] + ax[2] + ay[2], 1, 1],
    [c[0] - ax[0] + ay[0], c[1] - ax[1] + ay[1], c[2] - ax[2] + ay[2], 0, 1],
  ];
  for (const i of [0, 1, 2, 0, 2, 3]) arr.push(...v[i]);
}

function drawVROverlay(view, vp) {
  const menuOn = vrUi.on && vrUi.pos;
  const hudOn = camMode.imm && immersion.active && !horizonPlaying;
  if (!menuOn && !hudOn) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, xr.layer.framebuffer);
  gl.viewport(vp.x, vp.y, vp.width, vp.height);
  gl.useProgram(vrUiP.prog);
  gl.uniformMatrix4fv(vrUiP.u.uProj, false, view.projectionMatrix);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // канвас загружен premultiplied
  gl.bindVertexArray(vrUiVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, vrUiVBO);
  const draw = (arr, tex, color) => {
    if (!arr.length) return;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    if (tex) bindTex(0, tex, vrUiP.u.uTex);
    gl.uniform1i(vrUiP.u.uUseTex, tex ? 1 : 0);
    gl.uniform4f(vrUiP.u.uColor, color[0], color[1], color[2], color[3]);
    gl.drawArrays(gl.TRIANGLES, 0, arr.length / 5);
  };

  if (menuOn) {
    gl.uniformMatrix4fv(vrUiP.u.uView, false, view.transform.inverse.matrix);
    if (vrUi.dirty) {
      vrDrawMenu();
      if (!vrUi.tex) vrUi.tex = vrMakeTex(VRUI_W, VRUI_H);
      vrUploadCanvas(vrUi.tex, vrUi.canvas);
      vrUi.dirty = false;
    }
    const panel = [];
    vrPushQuad(panel,
      vrUi.pos,
      [vrUi.xAx[0] * vrUi.w / 2, vrUi.xAx[1] * vrUi.w / 2, vrUi.xAx[2] * vrUi.w / 2],
      [vrUi.yAx[0] * vrUi.h / 2, vrUi.yAx[1] * vrUi.h / 2, vrUi.yAx[2] * vrUi.h / 2]);
    draw(panel, vrUi.tex, [1, 1, 1, 1]);
    // луч указателя и курсор
    if (vrUi.ray) {
      const { o, d } = vrUi.ray;
      const end = vrUi.cursor || [o[0] + d[0] * 1.4, o[1] + d[1] * 1.4, o[2] + d[2] * 1.4];
      const em = view.transform.matrix;
      const eye = [em[12], em[13], em[14]];
      const mid = [(o[0] + end[0]) / 2 - eye[0], (o[1] + end[1]) / 2 - eye[1], (o[2] + end[2]) / 2 - eye[2]];
      const side = norm3(cross3(d, mid));
      const hw = 0.0016;
      const ray = [];
      const p0 = [o[0] + d[0] * 0.04, o[1] + d[1] * 0.04, o[2] + d[2] * 0.04];
      ray.push(
        p0[0] - side[0] * hw, p0[1] - side[1] * hw, p0[2] - side[2] * hw, 0, 0,
        p0[0] + side[0] * hw, p0[1] + side[1] * hw, p0[2] + side[2] * hw, 1, 0,
        end[0] + side[0] * hw, end[1] + side[1] * hw, end[2] + side[2] * hw, 1, 1,
        p0[0] - side[0] * hw, p0[1] - side[1] * hw, p0[2] - side[2] * hw, 0, 0,
        end[0] + side[0] * hw, end[1] + side[1] * hw, end[2] + side[2] * hw, 1, 1,
        end[0] - side[0] * hw, end[1] - side[1] * hw, end[2] - side[2] * hw, 0, 1,
      );
      draw(ray, null, [1.0, 0.62, 0.24, 0.55]);
      if (vrUi.cursor) {
        const cpos = [
          vrUi.cursor[0] + vrUi.nrm[0] * 0.004,
          vrUi.cursor[1] + vrUi.nrm[1] * 0.004,
          vrUi.cursor[2] + vrUi.nrm[2] * 0.004,
        ];
        const cq = [];
        vrPushQuad(cq, cpos,
          [vrUi.xAx[0] * 0.008, vrUi.xAx[1] * 0.008, vrUi.xAx[2] * 0.008],
          [vrUi.yAx[0] * 0.008, vrUi.yAx[1] * 0.008, vrUi.yAx[2] * 0.008]);
        draw(cq, null, [1, 0.85, 0.5, 0.95]);
      }
    }
  }

  if (hudOn) {
    const now = performance.now();
    if (now - vrUi.hudLast > 250 || !vrUi.hudTex) {
      vrUi.hudLast = now;
      vrDrawHud();
      if (!vrUi.hudTex) vrUi.hudTex = vrMakeTex(VRHUD_W, VRHUD_H);
      vrUploadCanvas(vrUi.hudTex, vrUi.hudCanvas);
    }
    // head-locked: рисуем прямо в координатах глаза (uView = identity)
    gl.uniformMatrix4fv(vrUiP.u.uView, false, IDENT4);
    const hud = [];
    vrPushQuad(hud, [0, -0.245, -0.75], [0.21, 0, 0], [0, 0.092, 0]);
    draw(hud, vrUi.hudTex, [1, 1, 1, 0.92]);
  }

  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// ============================================================
setupUI();
// сценарий из ссылки приоритетнее сохранённых настроек
if (!loadSceneFromURL()) loadSavedSettings();
resize();
requestAnimationFrame(frame);

