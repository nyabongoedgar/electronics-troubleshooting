// Fault injection. The learner sees the healthy schematic; the simulator runs the faulty one.
//
// fault = { part, mode, ... }
//   open      the part has failed open (no current)
//   short     the part has failed short (≈ 1 mΩ)
//   drift     value changed:        { factor: 12 }  -> R × 12, battery V × 12
//   reversed  LED/diode/battery fitted the wrong way round
//   joint     bad solder joint/contact in series with one pin: { pin: 0|1, ohms: 3000 }
//   optional  visible: text shown when the part is inspected
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});

  const MODES = ['open', 'short', 'drift', 'reversed', 'joint'];
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // -> circuit JSON containing the faults (hidden parts carry `hidden: true`).
  // opts.power === false disconnects every battery (what “power off” means on a bench).
  function applyFaults(json, faults, opts = {}) {
    const parts = clone(json.parts || []);
    const extra = [];
    for (const f of faults || []) {
      const p = parts.find((q) => q.id === f.part);
      if (!p) continue;
      if (f.mode === 'open') p.open = true;
      else if (f.mode === 'short') p.shorted = true;
      else if (f.mode === 'drift') p.value = p.value * f.factor;
      else if (f.mode === 'reversed') p.pins.reverse();
      else if (f.mode === 'joint') {
        const node = `${p.id}~j${f.pin}`;
        extra.push({ id: node, type: 'resistor', value: f.ohms, watts: 1e9, pins: [p.pins[f.pin], node], hidden: true });
        p.pins[f.pin] = node;
      }
    }
    if (opts.power === false) parts.forEach((p) => { if (p.type === 'vsource') p.open = true; });
    return { ...json, parts: [...parts, ...extra] };
  }

  // Resistance between two nodes with the power off: the meter drives 0.2 V, which
  // is too low to turn on a diode, so LEDs read as open (like a real meter).
  // `json` should already be the faulty, powered-off circuit.
  function ohms(json, a, b) {
    if (a === b) return 0;
    const map = (n) => (n === b ? 'gnd' : n === 'gnd' ? '~g' : n);
    const parts = json.parts.map((p) => ({ ...p, pins: p.pins.map(map), open: p.type === 'vsource' ? true : p.open }));
    parts.push({ id: '~meter', type: 'vsource', value: 0.2, pins: [map(a), 'gnd'] });
    const r = EB.sim.solveDC({ parts });
    if (!r.ok) return Infinity;
    const i = r.current('~meter');
    return i < 1e-9 ? Infinity : 0.2 / i;
  }

  const MODE_TEXT = {
    open: (f) => `${f.part} had failed open.`,
    short: (f) => `${f.part} had failed short-circuit.`,
    drift: (f) => `${f.part}’s value had drifted to ${f.factor}× its marked value.`,
    reversed: (f) => `${f.part} was fitted the wrong way round.`,
    joint: (f) => `${f.part} had a bad solder joint on pin ${f.pin + 1} (about ${EB.units.format(f.ohms, 'Ω')} of extra resistance).`,
  };
  const describe = (f) => MODE_TEXT[f.mode](f);

  // What a careful look at the part shows.
  function inspectText(part, faults) {
    const mine = faults.filter((f) => f.part === part.id);
    const seen = mine.map((f) => f.visible || (f.mode === 'joint' ? `The solder joint on pin ${f.pin + 1} looks dull and cracked.` : f.mode === 'reversed' ? 'The polarity marking is the wrong way round.' : null)).filter(Boolean);
    return seen.length ? seen.join(' ') : `${part.id} looks normal: no discolouration, cracks or damage.`;
  }

  EB.faults = { MODES, applyFaults, ohms, describe, inspectText };
})();
