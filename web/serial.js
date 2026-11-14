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
const SIM_BPMS = [72, 64, 88, 58];
const simSample = (ch, t) =>
  Math.round(100000 - 400 * Math.sin((2 * Math.PI * SIM_BPMS[ch] * t) / 60) + Math.random() * 40);

export function startSim(onFrame) {
  let i = 0;
  const id = setInterval(() => {
    const t = i++ / 50;
    onFrame(SIM_BPMS.map((_, ch) => simSample(ch, t)));
  }, 20);
  return () => clearInterval(id);
}

// Wrap a frame callback so channels whose sensor is missing (the firmware reports
// those as 0) get simulated pulses. Real channels pass through untouched.
export function simFill(onFrame) {
  let i = 0;
  return (raws) => {
    const t = i++ / 50;
    onFrame(raws.map((r, ch) => (r === 0 ? simSample(ch, t) : r)));
  };
}
