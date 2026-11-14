// Controls + status. The canvas (stage and notes lane) is drawn by B3/B4.
import { emit, on } from '../bus.js';

const $ = (id) => document.getElementById(id);
const buttons = [$('connect'), $('sim')];

// emit synchronously in the click: Web Serial and audio need the user gesture
function press(type) {
  buttons.forEach((b) => (b.disabled = true));
  emit(type);
}
$('connect').onclick = () => press('connect');
$('sim').onclick = () => press('simulate');
document.querySelectorAll('input[name=mode]').forEach((r) =>
  (r.onchange = () => r.checked && emit('mode', r.value)));
$('kit').onchange = (e) => emit('kit', e.target.value);

const LINES = {
  idle: 'Connect the sensors, or press Simulate.',
  running: 'Playing',
  disconnected: 'Sensors disconnected',
};
on('status', (s) => {
  const state = typeof s === 'string' && s.startsWith('error:') ? 'error' : s in LINES ? s : 'other';
  $('status').dataset.state = state;
  $('status').textContent = state === 'error' || state === 'other' ? String(s) : LINES[s];
  buttons.forEach((b) => (b.disabled = false));
});

on('kits', (names) => $('kit').replaceChildren(...names.map((n) => new Option(n))));
