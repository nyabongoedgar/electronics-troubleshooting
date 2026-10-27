// npm test -> fault layer + scoring + course self-check (every expert script must actually solve its case).
const path = require('path');
const root = path.join(__dirname, '..');
['js/units.js', 'js/sim/mna.js', 'js/engine.js', 'js/faults.js', 'js/session.js', 'js/cases.js'].forEach((f) => require(path.join(root, f)));
const EB = globalThis.EB;
const { applyFaults, ohms, MODES } = EB.faults;
const { solveDC } = EB.sim;
const { runTests } = EB.engine;
const S = EB.session;

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}\n      ${e.message}`); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, w = '') => must(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-12), `${w} expected ${b}, got ${a}`);
const V = (id, value, a, b = 'gnd') => ({ id, type: 'vsource', value, pins: [a, b] });
const R = (id, value, a, b) => ({ id, type: 'resistor', value, pins: [a, b] });

// ---------------------------------------------------------------- fault injection in the solver
const div = { parts: [V('V1', 9, 'a'), R('R1', 10000, 'a', 'o'), R('R2', 5000, 'o', 'gnd')] };
check('faults: healthy baseline', () => near(solveDC(div).v('o'), 3, 1e-6));
check('faults: open resistor', () => near(solveDC(applyFaults(div, [{ part: 'R2', mode: 'open' }])).v('o'), 9, 1e-4));
check('faults: shorted resistor', () => near(solveDC(applyFaults(div, [{ part: 'R1', mode: 'short' }])).v('o'), 9, 1e-3));
check('faults: drift multiplies the value', () => near(solveDC(applyFaults(div, [{ part: 'R2', mode: 'drift', factor: 2 }])).v('o'), 4.5, 1e-6));
check('faults: cold joint adds series resistance on one pin', () => {
  const f = applyFaults(div, [{ part: 'R2', mode: 'joint', pin: 0, ohms: 5000 }]);
  near(solveDC(f).v('o'), 4.5, 1e-3, 'v(o): R2 leg is 5k + 5k joint');
  must(f.parts.some((p) => p.hidden), 'joint resistor is hidden');
});
check('faults: reversed LED blocks, shorted LED passes but has no drop, open LED passes nothing', () => {
  const led = { parts: [V('V1', 9, 'a'), R('R1', 470, 'a', 'b'), { id: 'D', type: 'led', color: 'red', pins: ['b', 'gnd'] }] };
  must(solveDC(applyFaults(led, [{ part: 'D', mode: 'reversed' }])).current('D') < 1e-9, 'reversed');
  const sh = solveDC(applyFaults(led, [{ part: 'D', mode: 'short' }]));
  must(sh.current('D') > 0.015 && Math.abs(sh.vAcross('D')) < 0.1, 'shorted');
  must(solveDC(applyFaults(led, [{ part: 'D', mode: 'open' }])).current('D') < 1e-9, 'open');
});
check('faults: power off disconnects every battery', () => {
  const r = solveDC(applyFaults(div, [], { power: false }));
  must(r.ok && Math.abs(r.v('o')) < 1e-9 && r.current('V1') === 0, 'no voltage, no current');
});
check('faults: applying faults never mutates the source circuit', () => {
  const before = JSON.stringify(div); applyFaults(div, [{ part: 'R1', mode: 'open' }, { part: 'R2', mode: 'joint', pin: 1, ohms: 1 }]);
  must(JSON.stringify(div) === before, 'mutated');
});

// ---------------------------------------------------------------- ohmmeter
check('ohmmeter: reads parts and series/parallel combinations with sources disconnected', () => {
  const j = applyFaults(div, [], { power: false });
  near(ohms(j, 'o', 'gnd'), 5000, 1e-3, 'R2'); near(ohms(j, 'a', 'o'), 10000, 1e-3, 'R1');
  near(ohms(j, 'a', 'gnd'), 15000, 1e-3, 'series');
  must(ohms(j, 'o', 'o') === 0, 'same node');
});
check('ohmmeter: open reads OL, an LED does not conduct at the meter voltage, parallel lowers reading', () => {
  must(ohms(applyFaults(div, [{ part: 'R2', mode: 'open' }], { power: false }), 'o', 'gnd') === Infinity, 'OL');
  const led = { parts: [V('V1', 9, 'a'), R('R1', 470, 'a', 'b'), { id: 'D', type: 'led', pins: ['b', 'gnd'] }] };
  must(ohms(applyFaults(led, [], { power: false }), 'b', 'gnd') > 2e7, 'LED OL');
  const par = { parts: [V('V1', 9, 'a'), R('R1', 1000, 'a', 'gnd'), R('R2', 1000, 'a', 'gnd')] };
  near(ohms(applyFaults(par, [], { power: false }), 'a', 'gnd'), 500, 1e-3);
});

// ---------------------------------------------------------------- course structure
const ids = new Set();
check('course: modules reference real cases; every case is reachable', () => {
  const ref = new Set();
  for (const m of EB.MODULES) {
    must(m.blocks.length >= 3 && m.quiz.length >= 3 && m.cases.length >= 1, `${m.id}: too thin`);
    m.quiz.forEach((q, i) => must(q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length && q.why, `${m.id} q${i + 1} malformed`));
    m.cases.forEach((c) => { must(EB.CASES[c], `${m.id}: unknown case ${c}`); ref.add(c); });
  }
  Object.keys(EB.CASES).forEach((k) => must(ref.has(k), `case ${k} is in no module`));
});

let variants = 0;
for (const c of Object.values(EB.CASES)) {
  check(`case ${c.id}: well formed`, () => {
    must(!ids.has(c.id), 'dup id'); ids.add(c.id);
    must(c.title && c.symptom && c.hint && c.par >= 1 && c.tests.length >= 1 && c.variants.length >= 1, 'missing fields');
    must(c.circuit.parts.every((p) => c.circuit.layout || p.bends), 'needs layout');
  });
  check(`case ${c.id}: healthy circuit passes every test`, () => {
    const bad = runTests(c.tests, c.circuit).filter((r) => !r.pass);
    must(bad.length === 0, bad.map((b) => `${b.name}: ${b.msg}`).join('; '));
  });
  c.variants.forEach((v, i) => {
    variants++;
    const tag = `case ${c.id} variant ${i + 1}`;
    check(`${tag}: faults are valid and produce the symptom`, () => {
      must(v.faults.length >= 1 && v.explanation && v.expert.length >= 2, 'missing fields');
      for (const f of v.faults) {
        must(MODES.includes(f.mode), 'mode ' + f.mode);
        must(c.circuit.parts.some((p) => p.id === f.part), 'no part ' + f.part);
        if (f.mode === 'joint') must([0, 1].includes(f.pin) && f.ohms > 0, 'joint needs pin and ohms');
        if (f.mode === 'drift') must(f.factor > 0, 'drift needs factor');
      }
      const res = runTests(c.tests, applyFaults(c.circuit, v.faults));
      must(res.some((r) => !r.pass), 'faulty circuit already passes: no symptom');
    });
    if (v.faults.length > 1) {
      check(`${tag}: every fault matters (removing any one still leaves the symptom)`, () => {
        v.faults.forEach((_, k) => {
          const rest = v.faults.filter((__, j) => j !== k);
          must(runTests(c.tests, applyFaults(c.circuit, rest)).some((r) => !r.pass), `removing fault ${k + 1} alone cures it`);
        });
      });
    }
    check(`${tag}: expert script solves it within par (${c.par}) and scores ≥ 85`, () => {
      const s = S.play(S.create(c, i), v.expert);
      must(s.solved, 'expert script did not fix the circuit; faults left: ' + JSON.stringify(s.faults));
      must(s.probeCount() <= c.par, `used ${s.probeCount()} probes, par ${c.par}`);
      must(s.score() >= 85, `score ${s.score()} (${s.notes().join('; ')})`);
      must(s.penalties.length === 0, 'expert was penalised: ' + s.notes().join('; '));
      must(v.expert.filter((st) => st.note).length >= 2, 'expert path needs explanatory notes');
    });
  });
}

// ---------------------------------------------------------------- scoring and the rules of the bench
const torch = EB.CASES['torch-dark'];
check('session: swapping a good part costs 15 and fixes nothing', () => {
  const s = S.create(torch, 0); const r = s.replace('R1');
  must(!r.ok && !s.solved && s.penalties[0].pts === 15, JSON.stringify(s.penalties));
});
check('session: replacing the right part blindly costs 10 for no evidence, but still fixes it', () => {
  const s = S.create(torch, 0); s.replace('SW1');
  must(s.solved && s.penalties.some((p) => p.pts === 10), JSON.stringify(s.penalties)); must(s.score() === 90, 'score ' + s.score());
});
check('session: resistance with power on is refused and penalised', () => {
  const s = S.create(torch, 0); const r = s.probeR('a', 'b');
  must(!r.ok && /power off/i.test(r.text) && s.penalties[0].pts === 5, JSON.stringify(r));
  s.setPower(false); must(s.probeR('a', 'b').ok, 'power-off reading works');
});
check('session: readings reveal the right physics (power on, off, ammeter, inspection)', () => {
  const s = S.create(torch, 1); // R1 open
  near(s.probeV('b').value, 4.5, 1e-3, 'v(b)'); must(Math.abs(s.probeV('c').value) < 1e-6, 'v(c)');
  must(s.probeA('R1').value === 0, 'no current'); must(/normal/.test(s.inspect('R1').text), 'open resistors look normal');
  s.setPower(false); must(Math.abs(s.probeV('b').value) < 1e-9, 'power off reads 0 V');
});
check('session: unknown nodes and parts are rejected without charge', () => {
  const s = S.create(torch, 0);
  must(!s.probeV('zzz').ok && !s.probeA('X9').ok && !s.inspect('X9').ok && s.log.length === 0, 'rejected');
});
check('session: hints cost 10; giving up reveals the faults', () => {
  const s = S.create(torch, 0); s.hint(); must(s.score() === 90, 'hint cost');
  must(s.reveal().length === 1 && s.gaveUp, 'reveal');
});
check('session: the faulty circuit is what the editor hook solves', () => {
  const s = S.create(torch, 3); // flat battery
  near(s.solve(s.base.parts).v('a'), 0.45, 1e-3);
});
check('session: capstone needs both repairs', () => {
  const c = EB.CASES['capstone-torch']; const s = S.create(c, 0);
  s.probeV('a'); s.replace('V1'); must(!s.solved, 'solved after one'); s.probeA('R1'); s.replace('R1'); must(s.solved, 'not solved after both');
});

console.log(`\n${passed} checks passed, ${failures.length} failed  (${Object.keys(EB.CASES).length} cases, ${variants} fault variants)`);
if (failures.length) { console.log('\nFAILURES:\n  - ' + failures.join('\n  - ')); process.exit(1); }
