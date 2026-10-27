// A troubleshooting session: hidden faults, the meter, repairs and scoring. Pure logic (no DOM)
// so the same code runs in the browser and in `npm test`.
//
// Scoring: start at 100. Every probe or inspection costs 1. Penalties:
//   swapping a good part −15 · swapping/resoldering without examining it first −10
//   measuring resistance with power on −5 · using a hint −10
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});
  const { format } = EB.units;
  const F = () => EB.faults;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const PART_FAULTS = ['open', 'short', 'drift', 'reversed'];
  const CONTINUITY_OHMS = 50;
  const OL = 2e7;

  function create(c, variantIndex) {
    const variant = c.variants[variantIndex];
    const s = {
      c, variant, variantIndex,
      base: clone(c.circuit),
      faults: clone(variant.faults),
      power: true,
      log: [], penalties: [], touched: new Set(), examined: new Set(),
      hintsUsed: 0, solved: false, gaveUp: false,
      symptom: variant.symptom || c.symptom,
    };

    const nodes = () => new Set(s.base.parts.flatMap((p) => p.pins));
    const partOf = (id) => s.base.parts.find((p) => p.id === id);
    const penalize = (why, pts) => s.penalties.push({ why, pts });
    const record = (kind, desc, reading) => { s.log.push({ n: s.log.length + 1, kind, desc, reading, power: s.power }); };

    s.json = (power = s.power) => F().applyFaults(s.base, s.faults, { power });
    // hook for the schematic editor: solve the faulty circuit for whatever parts it holds
    s.solve = (parts) => EB.sim.solveDC(F().applyFaults({ parts }, s.faults, { power: s.power }));
    s.op = () => EB.sim.solveDC(s.json());

    s.setPower = (on) => { s.power = !!on; };

    const needNodes = (a, b) => {
      const known = nodes();
      for (const n of [a, b]) if (!known.has(n)) return `There is no point called "${n}".`;
      return null;
    };
    const touch = (...ns) => ns.forEach((n) => s.touched.add(n));

    // ---- measurements ----
    s.probeV = (a, b = 'gnd') => {
      const bad = needNodes(a, b); if (bad) return { ok: false, text: bad };
      const op = s.op();
      const v = op.v(a) - op.v(b);
      touch(a, b);
      const text = format(v, 'V');
      record('V', `Voltage, red on ${a}, black on ${b}`, text);
      return { ok: true, value: v, text };
    };
    s.probeA = (id) => {
      const p = partOf(id); if (!p) return { ok: false, text: `There is no part called "${id}".` };
      const op = s.op();
      const i = op.current(id);
      s.examined.add(id); touch(...p.pins);
      const text = format(i, 'A');
      record('A', `Current through ${id} (meter in series)`, text);
      return { ok: true, value: i, text };
    };
    const twoPoint = (kind, label, a, b) => {
      const bad = needNodes(a, b); if (bad) return { ok: false, text: bad };
      if (s.power) {
        penalize('Measured resistance with the power on', 5);
        record(kind, `${label} ${a} to ${b}`, 'power was on');
        return { ok: false, penalty: true, text: 'Turn the power off first. A live circuit gives false readings and can damage the meter.' };
      }
      const r = F().ohms(s.json(false), a, b);
      touch(a, b);
      const over = !(r < OL);
      const text = kind === 'C' ? (r < CONTINUITY_OHMS ? 'Beep: continuous' : 'No beep') : over ? 'OL (open)' : format(r, 'Ω');
      record(kind, `${label} ${a} to ${b}`, text);
      return { ok: true, value: r, text, beep: r < CONTINUITY_OHMS };
    };
    s.probeR = (a, b) => twoPoint('R', 'Resistance', a, b);
    s.continuity = (a, b) => twoPoint('C', 'Continuity', a, b);

    s.inspect = (id) => {
      const p = partOf(id); if (!p) return { ok: false, text: `There is no part called "${id}".` };
      s.examined.add(id);
      const text = F().inspectText(p, s.faults);
      record('I', `Looked closely at ${id}`, text);
      return { ok: true, text };
    };

    // ---- repairs ----
    const hasEvidence = (p) => s.examined.has(p.id) || p.pins.some((n) => n !== 'gnd' && s.touched.has(n));
    const finish = () => { s.check(); };

    s.replace = (id) => {
      const p = partOf(id); if (!p) return { ok: false, text: `There is no part called "${id}".` };
      const hit = s.faults.filter((f) => f.part === id && PART_FAULTS.includes(f.mode));
      if (!hit.length) {
        penalize(`Swapped ${id}, which was good`, 15);
        return { ok: false, text: `You replaced ${id}, but nothing changed: it was fine.` };
      }
      if (!hasEvidence(p)) penalize(`Replaced ${id} without measuring or inspecting it first`, 10);
      s.faults = s.faults.filter((f) => !hit.includes(f));
      finish();
      return { ok: true, text: `${id} replaced.` };
    };
    s.resolder = (id) => {
      const p = partOf(id); if (!p) return { ok: false, text: `There is no part called "${id}".` };
      const hit = s.faults.filter((f) => f.part === id && f.mode === 'joint');
      if (!hit.length) {
        penalize(`Resoldered ${id}, whose joints were fine`, 10);
        return { ok: false, text: `You reflowed the joints on ${id}, but they were already good.` };
      }
      if (!hasEvidence(p)) penalize(`Resoldered ${id} without examining it first`, 10);
      s.faults = s.faults.filter((f) => !hit.includes(f));
      finish();
      return { ok: true, text: `Joints on ${id} resoldered.` };
    };

    s.hint = () => {
      s.hintsUsed++;
      penalize('Used a hint', 10);
      return s.variant.hint || s.c.hint || 'Start with the supply: is the voltage reaching the circuit at all?';
    };

    // ---- outcome ----
    s.check = () => {
      // a switch left off is the learner's own doing, not a fault: test with switches closed
      const json = s.json(true);
      const res = EB.engine.runTests(s.c.tests, EB.engine.withSwitches(json, true));
      s.solved = s.faults.length === 0 || res.every((r) => r.pass);
      return s.solved;
    };
    s.reveal = () => { s.gaveUp = true; return s.faults.map(F().describe); };
    s.probeCount = () => s.log.length;
    s.score = () => Math.max(0, 100 - s.log.length - s.penalties.reduce((a, p) => a + p.pts, 0));
    s.rating = () => { const x = s.score(); return x >= 85 ? 'Expert' : x >= 65 ? 'Competent' : 'Persistent'; };
    s.notes = () => {
      const out = s.penalties.map((p) => `−${p.pts}: ${p.why}`);
      if (s.log.length > s.c.par * 2) out.push(`You took ${s.log.length} measurements; a good path needs about ${s.c.par}. Try splitting the circuit in half with each one.`);
      return out;
    };
    return s;
  }

  // Play an expert script: [{do:'V',a,b} {do:'A',part} {do:'R',a,b} {do:'C',a,b} {do:'inspect',part}
  //                         {do:'off'} {do:'on'} {do:'replace',part} {do:'resolder',part}]
  function play(s, steps) {
    for (const st of steps) {
      switch (st.do) {
        case 'V': s.probeV(st.a, st.b || 'gnd'); break;
        case 'A': s.probeA(st.part); break;
        case 'R': s.probeR(st.a, st.b || 'gnd'); break;
        case 'C': s.continuity(st.a, st.b || 'gnd'); break;
        case 'inspect': s.inspect(st.part); break;
        case 'off': s.setPower(false); break;
        case 'on': s.setPower(true); break;
        case 'replace': s.replace(st.part); break;
        case 'resolder': s.resolder(st.part); break;
        default: throw new Error('unknown step ' + st.do);
      }
    }
    return s;
  }

  EB.session = { create, play };
})();
