export function createFluid(canvas, colours, onError) {
const WINDOW_K = 1.67;                            // window radius / body radius (body is 12% smaller than before, windows unchanged)
// ---- WebGL setup
const glc = canvas;
const gl = glc.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
let W = 0, H = 0, Gx = null, failed = false;
const Pr = {};   // programs, each { p, l: uniform locations }
const HDR = '#version 300 es\nprecision highp float;precision highp sampler2D;in vec2 v;out vec4 o;\n';
const VQ = '#version 300 es\nlayout(location=0) in vec2 a;out vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0,1);}';
const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { failed = true; onError(gl.getShaderInfoLog(s)); } return s; };
const mkP = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); return { p, l: {} }; };
if (!gl) { onError('WebGL2 is not available in this browser.'); return null; }
else if (!gl.getExtension('EXT_color_buffer_float')) { onError('Float render targets (EXT_color_buffer_float) are not available in this browser, so the fluid cannot be drawn.'); return null; }
else {
  const vq = gl.createVertexArray();
  gl.bindVertexArray(vq); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one triangle covers the target; stays bound
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  Gx = { res: [] };   // + dye, vel, pre, div, curl (see build)
}
const L = (P, n) => (P.l[n] ??= gl.getUniformLocation(P.p, n));   // cached uniform location
const TX = (P, n, i, t) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t.t); gl.uniform1i(L(P, n), i); };
const mk = (w, h) => {   // RGBA16F texture + framebuffer
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { failed = true; onError('Float render target is not supported by this GPU.'); }
  const o = { t, f, w, h }; Gx.res.push(o); return o;
};
const dbl = (w, h) => { let a = mk(w, h), b = mk(w, h); return { get r() { return a; }, get w() { return b; }, swap() { [a, b] = [b, a]; } }; };   // ping-pong pair: read r, write w
function build() {   // (re)create the dye simulation targets for the current aspect
  Gx.res.forEach((o) => { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); }); Gx.res = [];
  const dh = Math.max(8, Math.round(DYE_W * H / W)), vh = Math.max(8, Math.round(VEL_W * H / W));
  Gx.dye = dbl(DYE_W, dh); Gx.vel = dbl(VEL_W, vh); Gx.pre = dbl(VEL_W, vh); Gx.div = mk(VEL_W, vh); Gx.curl = mk(VEL_W, vh);
}
function resize(width, height, dpr) {
  W = width; H = height;
  glc.width = Math.round(W * dpr); glc.height = Math.round(H * dpr);
  if (!failed && W > 0 && H > 0 && glc.width && glc.height) build();
}
// full-screen pass into a target (null = canvas)
function pass(P, t, set) {
  gl.useProgram(P.p); set?.();
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.f : null); gl.viewport(0, 0, t ? t.w : glc.width, t ? t.h : glc.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- dye simulation: stable fluids (velocity + dye) that colours the merged window
const DYE_W = 640, VEL_W = 160, JACOBI = 16;   // dye texture width; velocity/pressure/divergence/curl width (heights follow the aspect); pressure iterations
const VORT = 20, PRESS_KEEP = .8;              // vorticity confinement strength; fraction of last frame's pressure kept as the solver's start
const VEL_DISS = .975, DYE_DISS = .9994, DYE_SPEED = .5;   // per-frame velocity and dye decay; dye advects at this fraction of velocity speed
const DYE_FS = {
  adv: HDR + 'uniform sampler2D uV,uS;uniform float uDt,uDiss,uAsp;void main(){vec2 p=v-uDt*texture(uV,v).xy*vec2(1./uAsp,1.);o=uDiss*texture(uS,p);}',
  curl: HDR + 'uniform sampler2D uV;uniform vec2 uT;void main(){float L=texture(uV,v-vec2(uT.x,0)).y,R=texture(uV,v+vec2(uT.x,0)).y,B=texture(uV,v-vec2(0,uT.y)).x,T=texture(uV,v+vec2(0,uT.y)).x;o=vec4(.5*(R-L-T+B),0,0,1);}',
  vort: HDR + 'uniform sampler2D uV,uC;uniform vec2 uT;uniform float uStr,uDt;void main(){float L=texture(uC,v-vec2(uT.x,0)).x,R=texture(uC,v+vec2(uT.x,0)).x,B=texture(uC,v-vec2(0,uT.y)).x,T=texture(uC,v+vec2(0,uT.y)).x,C=texture(uC,v).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+1e-4;f*=uStr*C;f.y*=-1.;o=vec4(texture(uV,v).xy+f*uDt,0,1);}',
  div: HDR + 'uniform sampler2D uV;uniform vec2 uT;void main(){float L=texture(uV,v-vec2(uT.x,0)).x,R=texture(uV,v+vec2(uT.x,0)).x,B=texture(uV,v-vec2(0,uT.y)).y,T=texture(uV,v+vec2(0,uT.y)).y;o=vec4(.5*(R-L+T-B),0,0,1);}',
  jac: HDR + 'uniform sampler2D uP,uD;uniform vec2 uT;void main(){float L=texture(uP,v-vec2(uT.x,0)).x,R=texture(uP,v+vec2(uT.x,0)).x,B=texture(uP,v-vec2(0,uT.y)).x,T=texture(uP,v+vec2(0,uT.y)).x;o=vec4((L+R+B+T-texture(uD,v).x)*.25,0,0,1);}',
  grad: HDR + 'uniform sampler2D uP,uV;uniform vec2 uT;void main(){float L=texture(uP,v-vec2(uT.x,0)).x,R=texture(uP,v+vec2(uT.x,0)).x,B=texture(uP,v-vec2(0,uT.y)).x,T=texture(uP,v+vec2(0,uT.y)).x;o=vec4(texture(uV,v).xy-.5*vec2(R-L,T-B),0,1);}',
  clr: HDR + 'uniform sampler2D uS;uniform float uK;void main(){o=uK*texture(uS,v);}',
  spl: HDR + `uniform vec2 uC,uPush;uniform float uR,uAsp,uA,uSw;uniform int uM;uniform vec3 uCol;
void main(){ vec2 d=(v-uC)*vec2(uAsp,1.); float g=exp(-dot(d,d)/(uR*uR));
  if(uM==0) o=vec4(uSw*g*vec2(-d.y,d.x)/uR+uPush*g,0,0); else o=vec4(uCol,uA*g); }`,
};
if (Gx) for (const k in DYE_FS) Pr[k] = mkP(VQ, DYE_FS[k]);
const shade = (c) => { const s = Math.random(); return c.map((v) => (s < .5 ? v * (.45 + s) : v + (1 - v) * (s - .5) * .7)); };   // lighter or darker take on a colour
// one gaussian injection: swirl/push impulse into velocity, colour mixed into dye
function splat(e) {
  const { vel, dye } = Gx, set = (m) => () => {
    gl.uniform2f(L(Pr.spl, 'uC'), e.x / W, 1 - e.y / H); gl.uniform1f(L(Pr.spl, 'uR'), e.rad / H); gl.uniform1f(L(Pr.spl, 'uAsp'), W / H);
    gl.uniform1i(L(Pr.spl, 'uM'), m); gl.uniform3fv(L(Pr.spl, 'uCol'), e.col || [0, 0, 0]); gl.uniform1f(L(Pr.spl, 'uA'), e.amt || 0);
    gl.uniform1f(L(Pr.spl, 'uSw'), e.sw || 0); gl.uniform2f(L(Pr.spl, 'uPush'), 0, 0);
  };
  gl.enable(gl.BLEND);
  if (e.sw) { gl.blendFunc(gl.ONE, gl.ONE); pass(Pr.spl, vel.r, set(0)); }
  if (e.amt) { gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); pass(Pr.spl, dye.r, set(1)); }
  gl.disable(gl.BLEND);
}
// stable fluids: vorticity confinement, pressure projection, advection
function solve(dt) {
  const { vel, dye, pre, div, curl } = Gx, T = [1 / vel.r.w, 1 / vel.r.h], t2 = (P) => gl.uniform2fv(L(P, 'uT'), T);
  pass(Pr.curl, curl, () => { TX(Pr.curl, 'uV', 0, vel.r); t2(Pr.curl); });
  pass(Pr.vort, vel.w, () => { TX(Pr.vort, 'uV', 0, vel.r); TX(Pr.vort, 'uC', 1, curl); t2(Pr.vort); gl.uniform1f(L(Pr.vort, 'uStr'), VORT); gl.uniform1f(L(Pr.vort, 'uDt'), dt); }); vel.swap();
  pass(Pr.div, div, () => { TX(Pr.div, 'uV', 0, vel.r); t2(Pr.div); });
  pass(Pr.clr, pre.w, () => { TX(Pr.clr, 'uS', 0, pre.r); gl.uniform1f(L(Pr.clr, 'uK'), PRESS_KEEP); }); pre.swap();
  for (let i = 0; i < JACOBI; i++) { pass(Pr.jac, pre.w, () => { TX(Pr.jac, 'uP', 0, pre.r); TX(Pr.jac, 'uD', 1, div); t2(Pr.jac); }); pre.swap(); }
  pass(Pr.grad, vel.w, () => { TX(Pr.grad, 'uP', 0, pre.r); TX(Pr.grad, 'uV', 1, vel.r); t2(Pr.grad); }); vel.swap();
  const adv = (src, tgt, diss, k) => pass(Pr.adv, tgt.w, () => { TX(Pr.adv, 'uV', 0, vel.r); TX(Pr.adv, 'uS', 1, src.r); gl.uniform1f(L(Pr.adv, 'uDt'), dt * k); gl.uniform1f(L(Pr.adv, 'uDiss'), diss); gl.uniform1f(L(Pr.adv, 'uAsp'), W / H); });
  adv(vel, vel, VEL_DISS, 1); vel.swap(); adv(dye, dye, DYE_DISS, DYE_SPEED); dye.swap();
}
// one frame of the merged window's dye: slow colours that drift and fold, a stir per beat, then the solve
function dyeStep(dt, rm, { big, cyB, RW, x: X, y: Y, bumps }) {
  const inj = [];
  for (let k = 0; k < 4; k++) { const a = k * 1.5708 + .785; inj.push({ x: X + Math.cos(a) * .45 * RW, y: Y + Math.sin(a) * .45 * RW, rad: .6 * RW, col: colours[k], amt: .05 }); }
  if (!rm) for (let k = 0; k < 4; k++) { const a = Math.random() * (Math.PI * 2), r = Math.sqrt(Math.random()) * .8 * RW; inj.push({ x: X + Math.cos(a) * r, y: Y + Math.sin(a) * r, rad: .045 * RW * (.5 + Math.random()), col: shade(colours[Math.random() * 4 | 0]), amt: .9, sw: (Math.random() - .5) * 1.4 }); }
  if (!rm) for (let k = 0; k < 2; k++) { const a = Math.random() * (Math.PI * 2), r = Math.sqrt(Math.random()) * .7 * RW; inj.push({ x: X + Math.cos(a) * r, y: Y + Math.sin(a) * r, rad: .16 * RW, sw: (Math.random() < .5 ? -1 : 1) * (.7 + Math.random()) }); }   // stirrers
  if (!rm && big > .5) bumps.forEach((bump, k) => { if (bump) inj.push({ x: X, y: cyB, rad: .26 * RW, col: shade(colours[k]), amt: .6, sw: (Math.random() < .5 ? -1 : 1) * .6 }); });   // a player's beat
  for (const e of inj) splat(e);
  if (!rm) solve(dt);
}

// ---- fluid shader: raymarched black-chrome spiked sphere in a backlit window; four small blobs + one merged blob in one pass
const RAY = `#version 300 es
precision highp float;
uniform float uT, uFade, uWr;   // time, fade, window radius / body radius
uniform vec2 uRes;
uniform sampler2D uDye;
uniform vec3 uB[5];     // x, y (px, y up), radius px. [0..3] small blobs, [4] the merged one (0 = hidden)
uniform vec3 uCol[4];
uniform vec4 uS[4];     // field F, lagged L, note ripple, presence
uniform float uLift[4];
uniform vec4 uFl;       // beat flash per player
const float PI = 3.14159265359, PHI = 1.61803398875, BOUND = 1.6;   // BOUND: march start radius in blob units (body 1 + spike height)
float gN, gW, gHs; bool gBig; vec4 gOne, fF, fL, fR; mat3 gRot;
float mS, mH; vec4 mWt;   // set by map(): spike profile, spike height, colour weights
out vec4 o;
// nearest point of an n-point Fibonacci sphere lattice: x = index, y = distance (Keinert et al.)
vec2 isf(vec3 p, float n) {
  float m = 1. - 1. / n, phi = min(atan(p.y, p.x), PI), ct = p.z;
  float k = max(2., floor(log(n * PI * sqrt(5.) * (1. - ct * ct)) / log(PHI + 1.)));
  float Fk = pow(PHI, k) / sqrt(5.);
  vec2 F = vec2(floor(Fk + .5), floor(Fk * PHI + .5));
  vec2 ka = 2. * F / n, kb = 2. * PI * (fract((F + 1.) * PHI) - (PHI - 1.));
  mat2 iB = mat2(ka.y, -ka.x, kb.y, -kb.x) / (ka.y * kb.x - ka.x * kb.y);
  vec2 c = floor(iB * vec2(phi, ct - m));
  float d = 8., j = 0.;
  for (int s = 0; s < 4; s++) {
    vec2 uv = vec2(float(s - 2 * (s / 2)), float(s / 2));
    float i = clamp(floor(dot(F, uv + c) + .5), 0., n - 1.);
    float ph = 2. * PI * fract(i * PHI), c2 = m - 2. * i / n, s2 = sqrt(max(0., 1. - c2 * c2));
    vec3 q = vec3(cos(ph) * s2, sin(ph) * s2, c2) - p;
    float dd = dot(q, q);
    if (dd < d) { d = dd; j = i; }
  }
  return vec2(j, sqrt(d));
}
float hash(float x) { return fract(sin(x * 12.9898 + 1.7) * 43758.5453); }
mat3 rot(float a, float b) {
  float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  return mat3(cb, 0, -sb, 0, 1, 0, sb, 0, cb) * mat3(1, 0, 0, 0, ca, sa, 0, -sa, ca);
}
vec4 weights(vec3 d) {   // merged blob: four colour regions that drift
  vec3 w = d + .34 * sin(2.3 * d.yzx + uT * .35) + .17 * sin(5.1 * d.zxy - uT * .27);
  vec4 a;
  for (int k = 0; k < 4; k++) {
    float an = float(k) * 1.5708 + uT * .12 + .6 * sin(uT * .21 + float(k));
    vec3 e = w - normalize(vec3(cos(an), sin(an), .6));
    a[k] = -7. * dot(e, e);
  }
  a = exp(5. * (a - max(max(a.x, a.y), max(a.z, a.w))));
  return a / (a.x + a.y + a.z + a.w);
}
float map(vec3 p) {
  float l = length(p); vec3 d0 = p / l;
  vec4 w = gBig ? weights(d0) : gOne;
  float F = max(dot(w, fF), 0.), L = max(dot(w, fL), 0.), R = dot(w, fR);
  vec2 sf = isf(gRot * d0, gN);
  float h1 = hash(sf.x), h2 = hash(sf.x + 37.);
  float H = gHs * mix(F, L, h1) * (.55 + .45 * h2);   // spikes rise at slightly different times and heights
  float s = max(0., 1. - sf.y / gW);
  float body = 1. - .12 * F + .018 * (sin(3. * d0.x + uT * 1.1) + sin(4. * d0.y - uT * 1.4) + sin(3.5 * d0.z + uT * .9))
    + .022 * R * sin(22. * acos(clamp(d0.y, -1., 1.)) - uT * 16.);   // notes: rings running down the surface
  mS = s; mH = H; mWt = w;
  return l - body - H * s * sqrt(s);
}
float env(vec3 r) {
  float top = smoothstep(.3, .55, r.y) * smoothstep(.75, .25, abs(r.x - .1));
  float strip = smoothstep(.1, 0., abs(r.x + .72) - .06) * smoothstep(.75, .2, abs(r.y + .05));
  float spot = smoothstep(.12, 0., length(r.xy - vec2(.55, -.5)) - .05);
  return 1.1 * top + .8 * strip + .6 * spot + .12 * smoothstep(-.3, -.9, r.y) + .04;
}
vec4 blob(vec2 q, float rpx, float Fm) {
  float l2 = dot(q, q);
  if (l2 > BOUND * BOUND) return vec4(0);
  float z = sqrt(BOUND * BOUND - l2), k = 1.5 * gHs * clamp(Fm, 0., 1.3) / gW, st = .95 / sqrt(1. + k * k);
  vec3 p = vec3(q, z), pc = p; float md = 1e3; bool hit = false;
  for (int i = 0; i < 72; i++) {
    float d = map(p);
    if (d < md) { md = d; pc = p; }
    if (d < .0015) { hit = true; break; }
    p.z -= max(d, .002) * st;
    if (p.z < -z) break;
  }
  float a = hit ? 1. : smoothstep(2.5 / rpx, 0., md);
  if (a <= 0.) return vec4(0);
  vec2 e = vec2(1, -1) * .003;
  vec3 n = normalize(e.xyy * map(pc + e.xyy) + e.yyx * map(pc + e.yyx) + e.yxy * map(pc + e.yxy) + e.xxx * map(pc + e.xxx));
  map(pc);
  vec3 c = vec3(0); float lift = 0.;
  for (int j = 0; j < 4; j++) { c += mWt[j] * mix(vec3(.17, .18, .2), uCol[j], uS[j].w); lift += mWt[j] * uLift[j]; }
  vec3 r = reflect(vec3(0, 0, -1), n);
  float fr = pow(1. - clamp(n.z, 0., 1.), 3.);
  float gl = .9 * pow(max(dot(r, normalize(vec3(-.4, .7, .6))), 0.), 40.) + .5 * pow(max(dot(r, normalize(vec3(.7, -.2, .5))), 0.), 60.);   // two narrow white glints
  vec3 col = vec3(.012) + env(r) * .9 * (.3 + .7 * fr) + mix(c, vec3(1), .35) * fr * fr * 1.3 + gl * 1.3;
  col *= 1. - .5 * clamp(mH * 2., 0., 1.) * (1. - mS) * (1. - mS);  // valleys between spikes sit in shadow
  return vec4(col * (1. + .6 * lift), 1) * a;
}
void main() {
  vec4 acc = vec4(0);
  vec2 uv = gl_FragCoord.xy / uRes;
  fF = vec4(uS[0].x, uS[1].x, uS[2].x, uS[3].x); fL = vec4(uS[0].y, uS[1].y, uS[2].y, uS[3].y); fR = vec4(uS[0].z, uS[1].z, uS[2].z, uS[3].z);
  for (int i = 0; i < 5; i++) {
    vec3 b = uB[i];
    if (b.z < 1.) continue;
    vec2 q = (gl_FragCoord.xy - b.xy) / b.z; float l = length(q);
    if (l > 2.8) continue;   // beyond window and spike reach
    gBig = i == 4;
    gOne = vec4(float(i == 0), float(i == 1), float(i == 2), float(i == 3));
    vec4 sel = gBig ? vec4(1) : gOne, f = max(fF, 0.) * sel;
    float Fm = max(max(f.x, f.y), max(f.z, f.w));
    if (gBig) { gN = 312.; gW = .16; gHs = .36; gRot = rot(.9, uT * .05); }   // spikes: count, width (lattice-distance), height scale (x body radius)
    else { gN = 132.; gW = .245; gHs = .5; gRot = rot(.8 + float(i), uT * .07 + float(i) * 2.); }
    {   // the backlit window behind the black body: a glowing disc, brighter with finger presence and the beat flash
      float qn = l / uWr, pres = gBig ? 1. : dot(gOne, vec4(uS[0].w, uS[1].w, uS[2].w, uS[3].w)), pu = gBig ? 0. : dot(gOne, uFl);
      if (qn < 1.3) {
        vec3 wc = gBig ? clamp(texture(uDye, uv).rgb * 1.7 + .07, 0., 1.1) : mix(vec3(.17, .18, .2), uCol[i], pres);   // merged window shows the dye
        float aa = 1.5 / (b.z * uWr), ins = smoothstep(1. + aa, 1. - aa, qn), mq = min(qn, 1.);
        float I = ins * mix(1., .62, mq * mq) + (1. - ins) * .62 * pow(max(1. - (qn - 1.) / .18, 0.), 2.);
        float br = (gBig ? 1.5 : 1.) * (.2 + .8 * pres) * (1. + .35 * pu);
        vec3 col = mix(wc, vec3(1.), (gBig ? .12 : .4) * pow(max(1. - qn, 0.), 2.)) * I * br;
        vec4 w = vec4(col, min(1., I * br * 1.1));
        acc = w + acc * (1. - w.a);
      }
    }
    vec4 bl = blob(q, b.z, Fm);
    acc = bl + acc * (1. - bl.a);
  }
  o = acc * uFade;
}`;
if (Gx) Pr.ray = mkP(VQ, RAY);
const COL4 = new Float32Array(colours.flat());
function drawFluid({ t, fade, rm, blobs, state, lift, flash }) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  pass(Pr.ray, null, () => {
    TX(Pr.ray, 'uDye', 0, Gx.dye.r);
    gl.uniform2f(L(Pr.ray, 'uRes'), glc.width, glc.height); gl.uniform1f(L(Pr.ray, 'uFade'), fade); gl.uniform1f(L(Pr.ray, 'uT'), rm ? 0 : t); gl.uniform1f(L(Pr.ray, 'uWr'), WINDOW_K);
    gl.uniform3fv(L(Pr.ray, 'uB'), blobs); gl.uniform3fv(L(Pr.ray, 'uCol'), COL4); gl.uniform4fv(L(Pr.ray, 'uS'), state); gl.uniform1fv(L(Pr.ray, 'uLift'), lift); gl.uniform4fv(L(Pr.ray, 'uFl'), flash);
  });
}
if (failed) return null;
return { resize, frame(s) {
  if (failed || W <= 0 || H <= 0 || !glc.width || !glc.height) return;
  if (s.dye) dyeStep(s.dt, s.rm, s.dye);
  drawFluid(s);
} };
}
