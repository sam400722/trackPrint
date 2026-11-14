// trackPrint shared contract. web/audio and web/ui never import each other;
// they only talk through these events. Change this table only through a
// contract/* branch (see docs/superpowers/plans/2026-11-14-trackprint.md).
//
// event      from   detail
// frame      core   { raws: number[4], ch: {finger, ac, beat, bpm}[4] }   ~50 Hz
// status*    core   'idle' | 'running' | 'disconnected' | 'error: <message>'
// connect    ui     none. Emit inside the click handler (needs a user gesture).
// simulate   ui     none. Same rule.
// mode       ui     'beats' | 'bits'
// kit        ui     one of the names from 'kits'
// kits*      audio  string[]
// analyser*  audio  { wave, fft }, each with .getValue(): Float32Array
// note       audio  { voice, ...mapVoice params }, fired when the sound is heard
//
// * sticky: a late subscriber gets the last value immediately.
// Listeners ignore fields and values they don't know, so either side can add some.

export const VOICES = ['drums', 'bass', 'lead', 'pad']; // channel i -> VOICES[i]
const STICKY = new Set(['status', 'kits', 'analyser']);
const bus = new EventTarget();
const last = {};

export function emit(type, detail) {
  if (STICKY.has(type)) last[type] = detail;
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, fn) {
  if (type in last) fn(last[type]);
  bus.addEventListener(type, (e) => fn(e.detail));
}
