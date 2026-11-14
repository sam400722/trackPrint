// Test log: every frame since the sensors started, saved as CSV to the browser's Downloads folder.
// One row per frame: arrival time, the four raw readings, and what the beat detector made of each.
// Replay a log with tools/analyze-log.mjs. A recording is saved by the Save log button, and
// automatically when it ends (disconnect, error, or a new Connect/Simulate) if it ran 5 s or more.
import { on, VOICES } from '../bus.js';

const MIN_MS = 5000;              // shorter recordings are not auto-saved
const CHUNK = 50 * 60 * 60 * 2;   // ponytail: ~2 h of frames per file (~45 MB); a longer run saves and carries on in a new file
const FIELDS = ['finger', 'held', 'beat', 'bpm', 'inst', 'amp', 'ac'];
const HEADER = ['t_ms', ...VOICES.map((_, i) => `raw${i + 1}`), ...VOICES.flatMap((_, i) => FIELDS.map((f) => `${f}${i + 1}`))].join(',');

let rec = null;                   // { rows: string[], t0: performance ms, started: Date, source, part }
let source = 'serial';
const params = () => globalThis.location?.search ?? '';

function begin(part = 1) {
  rec = { rows: [], t0: performance.now(), started: new Date(), source, part };
}

function csv(r) {
  const meta = [
    '# flatline test log',
    `# started ${r.started.toISOString()} (local ${r.started.toString()})`,
    `# source ${r.source}${params() ? `, page options ${params()}` : ''}${r.part > 1 ? `, part ${r.part}` : ''}`,
    '# sensors 1-4 = ' + VOICES.join(', ') + '. raw: sensor IR counts (0 = sensor missing, < 50000 = no finger)',
    '# held = bad read replaced by the filter; bpm/inst/amp/ac = beat detector output; t_ms = arrival in the browser',
  ];
  return [...meta, HEADER, ...r.rows].join('\n') + '\n';
}

function save(r = rec) {
  if (!r?.rows.length) return false;
  const p = (n) => String(n).padStart(2, '0'), d = r.started;
  const name = `flatline-log-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}${r.part > 1 ? `-part${r.part}` : ''}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv(r)], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

const long = () => rec && performance.now() - rec.t0 >= MIN_MS;
function end() { if (long()) save(); rec = null; }

on('connect', () => (source = 'serial'));
on('simulate', () => (source = 'simulator'));
on('status', (s) => {
  if (s === 'running') { end(); begin(); } else end(); // a new run, or the old one stopped
});
on('frame', ({ raws, ch }) => {
  if (!rec) return;
  let row = `${(performance.now() - rec.t0).toFixed(1)},${raws.join(',')}`;
  for (const c of ch) row += `,${+c.finger},${+!!c.held},${+c.beat},${c.bpm.toFixed(1)},${c.inst.toFixed(1)},${Math.round(c.amp)},${Math.round(c.ac)}`;
  rec.rows.push(row);
  if (rec.rows.length >= CHUNK) { const done = rec; save(done); begin(done.part + 1); rec.source = done.source; }
});

// Save log button: saves what has been recorded so far; recording carries on.
export function bindLogButton(button) {
  const label = button.textContent;
  button.onclick = () => save();
  setInterval(() => {
    const ms = rec ? performance.now() - rec.t0 : 0, m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
    button.disabled = !rec?.rows.length;
    button.textContent = rec?.rows.length ? `${label} ${m}:${String(s).padStart(2, '0')}` : label;
  }, 1000);
}
