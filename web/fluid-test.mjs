import assert from 'node:assert/strict';
import { createFluid } from './ui/fluid.js';
const colours = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]], errors = [];
const error = (message) => errors.push(message);
assert.equal(createFluid({ getContext: () => null }, colours, error), null);
assert.equal(errors.pop(), 'WebGL2 is not available in this browser.');
assert.equal(createFluid({ getContext: () => ({ getExtension: () => null }) }, colours, error), null);
assert.equal(errors.pop(), 'Float render targets (EXT_color_buffer_float) are not available in this browser, so the fluid cannot be drawn.');
// Record the GL boundary: this checks module orchestration, not GPU rendering.
const calls = [];
const gl = new Proxy({
  getExtension: () => ({}), getShaderParameter: () => true,
  checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
  getUniformLocation: (p, name) => name,
}, { get: (target, name) => target[name] ?? (name.toUpperCase() === name ? name : (...args) => { calls.push([name, ...args]); return {}; }) });
const canvas = { width: 0, height: 0, getContext: (type, options) => { assert.equal(type, 'webgl2'); assert.deepEqual(options, { premultipliedAlpha: true, antialias: false }); return gl; } };
const fluid = createFluid(canvas, colours, error);
const s = { t: 5, dt: 1 / 60, fade: .8, rm: true, blobs: new Float32Array(15), state: new Float32Array(16), lift: new Float32Array(4), flash: new Float32Array(4), dye: null };
calls.length = 0; fluid.frame(s); assert.equal(calls.length, 0, 'no drawing before resize');
fluid.resize(800, 600, 2); assert.equal(canvas.width, 1600); assert.equal(canvas.height, 1200);
assert.ok(calls.some(([n, , , , w, h]) => n === 'texStorage2D' && w === 640 && h === 480), 'dye target aspect uses CSS size');
calls.length = 0; fluid.frame(s);
assert.equal(calls.filter(([n]) => n === 'drawArrays').length, 1);
assert.ok(calls.findIndex(([n]) => n === 'clear') < calls.findIndex(([n]) => n === 'drawArrays'), 'clear before draw');
assert.ok(calls.some(([n, location, value]) => n === 'uniform1f' && location === 'uT' && value === 0), 'reduced motion freezes shader time');
s.dye = { x: 200, y: 150, cyB: 300, RW: 100, big: 1, bumps: [true, false, false, false] };
calls.length = 0; fluid.frame(s);
assert.equal(calls.filter(([n]) => n === 'drawArrays').length, 5, 'reduced motion injects four colours then draws, without solving');
assert.ok(calls.some(([n, location, x, y]) => n === 'uniform2f' && location === 'uC' && Math.abs(x - .289790590140655) < 1e-12 && Math.abs(y - .6969881114170975) < 1e-12), 'injection uses supplied CSS window centre');
s.rm = false; calls.length = 0; const random = Math.random; Math.random = () => .25;
try { fluid.frame(s); } finally { Math.random = random; }
assert.equal(calls.filter(([n]) => n === 'drawArrays').length, 40, 'moving dye injects colours and stirs, solves, then draws');
fluid.resize(0, 0, 2); calls.length = 0; fluid.frame(s); assert.equal(calls.length, 0, 'zero-size canvas does not draw');
gl.getShaderParameter = () => false; gl.getShaderInfoLog = () => 'shader failed';
assert.equal(createFluid(canvas, colours, error), null); assert.equal(errors.pop(), 'shader failed');
gl.getShaderParameter = () => true; gl.checkFramebufferStatus = () => 'incomplete';
const unsupported = createFluid(canvas, colours, error); unsupported.resize(800, 600, 2);
assert.equal(errors.pop(), 'Float render target is not supported by this GPU.');
calls.length = 0; unsupported.frame(s); assert.equal(calls.length, 0, 'unsupported target stops drawing');
console.log('fluid contract self-check ok');
