// Frame sources. Each calls onFrame([ir0, ir1, ir2, ir3]) ~50x/s.

export function parseLine(line) {
  const t = line.trim();
  return /^\d+,\d+,\d+,\d+$/.test(t) ? t.split(',').map(Number) : null;
}

export async function connectSerial(onFrame, onClose) {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });
  const decoder = new TextDecoderStream();
  const piped = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();

  (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) {
          const f = parseLine(l);
          if (f) onFrame(f); // bad lines are dropped
        }
      }
    } catch {
      // device unplugged
    }
    onClose();
  })();

  return async () => {
    await reader.cancel().catch(() => {});
    await piped;
    await port.close().catch(() => {});
  };
}

// Simulated IR: dips on each pulse, sitting on a ~100k DC level, plus sensor noise.
// The drum finger lands after 10 s (tests the no-drum default and the tempo lock),
// and the pad finger's rate swings +-6 BPM on a 4 s breathing cycle.
const SIM_BPMS = [72, 64, 88, 58];
function simSource(rate = 50) {
  const phase = [0, 0, 0, 0];
  let n = 0;
  return () => {
    const t = n++ / rate;
    return SIM_BPMS.map((b, ch) => {
      if (ch === 0 && t < 10) return 0;
      const bpm = ch === 3 ? b + 6 * Math.sin((2 * Math.PI * t) / 4) : b;
      phase[ch] += (2 * Math.PI * bpm) / 60 / rate;
      return Math.round(100000 - 400 * Math.sin(phase[ch]) + Math.random() * 40);
    });
  };
}

export function startSim(onFrame) {
  const next = simSource();
  const id = setInterval(() => onFrame(next()), 20);
  return () => clearInterval(id);
}

// Wrap a frame callback so channels whose sensor is missing (the firmware reports
// those as 0) get simulated pulses. Real channels pass through untouched.
export function simFill(onFrame) {
  const next = simSource();
  return (raws) => {
    const sim = next();
    onFrame(raws.map((r, ch) => (r === 0 ? sim[ch] : r)));
  };
}
