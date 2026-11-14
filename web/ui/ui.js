// Stub UI: controls, status, four text meters. The visuals teammate replaces all of this.
import { emit, on, VOICES } from '../bus.js';

const $ = (id) => document.getElementById(id);
$('connect').onclick = () => emit('connect');
$('sim').onclick = () => emit('simulate');
$('mode').onchange = (e) => emit('mode', e.target.value);
$('kit').onchange = (e) => emit('kit', e.target.value);

on('status', (s) => ($('status').textContent = s));
on('kits', (names) => $('kit').replaceChildren(...names.map((n) => new Option(n))));

const meters = VOICES.map(() =>
  $('meters').appendChild(Object.assign(document.createElement('div'), { className: 'ch off' })));

on('frame', ({ ch }) => ch.forEach((s, i) => {
  meters[i].textContent = `${VOICES[i]}: ${s.finger ? `${Math.round(s.bpm)} bpm` : 'no finger'}`;
  meters[i].classList.toggle('off', !s.finger);
}));

on('note', ({ voice }) => {
  const m = meters[VOICES.indexOf(voice)];
  m.classList.add('beat');
  setTimeout(() => m.classList.remove('beat'), 100);
});
