// Course content: modules (teaching text + quiz) and cases (hidden-fault exercises).
//
// case     { id, title, symptom, circuit, tests[], par, hint, variants[] }
// variant  { faults[], symptom?, hint?, explanation, expert[] }
// expert   the model investigation. `npm test` replays it: it must fix the fault within `par` probes
//          and score ≥ 85. Steps: V a b · A part · R a b · C a b · inspect part · off · on · replace part · resolder part
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});
  const { T } = EB.engine;

  const V = (id, value, a, b = 'gnd') => ({ id, type: 'vsource', value, pins: [a, b] });
  const R = (id, value, a, b, x) => ({ id, type: 'resistor', value, pins: [a, b], ...x });
  const LED = (id, color, a, b, x) => ({ id, type: 'led', color, pins: [a, b], ...x });
  const SW = (id, closed, a, b) => ({ id, type: 'switch', closed, pins: [a, b] });
  const LAMP = (id, a, b) => ({ id, type: 'lamp', value: 40, watts: 1, pins: [a, b] });
  const TL = [160, 80], BL = [160, 320], TM = [380, 80], TR = [600, 80], BR = [600, 320];

  // steps
  const v = (a, b, note) => ({ do: 'V', a, b: b || 'gnd', note });
  const am = (part, note) => ({ do: 'A', part, note });
  const ohm = (a, b, note) => ({ do: 'R', a, b: b || 'gnd', note });
  const look = (part, note) => ({ do: 'inspect', part, note });
  const off = (note) => ({ do: 'off', note });
  const swap = (part, note) => ({ do: 'replace', part, note });
  const solder = (part, note) => ({ do: 'resolder', part, note });

  // reusable tests
  const ledAmps = (id, lo, hi) => T(`${id} current is ${lo * 1000}–${hi * 1000} mA`, (c, { expect }) => expect(c.dc().current(id), 'A').toBeBetween(lo, hi));
  const ledDrop = (id) => T(`${id} has its normal forward voltage`, (c, { expect }) => expect(c.dc().vAcross(id), 'V').toBeBetween(1.5, 3.3));

  // ---------------------------------------------------------------- circuits
  const torch = {
    parts: [V('V1', 4.5, 'a'), SW('SW1', true, 'a', 'b'), R('R1', 180, 'b', 'c'), LED('LED1', 'red', 'c', 'gnd', { bends: [BR], at: 0 })],
    layout: { a: TL, b: TM, c: TR, gnd: BL },
  };
  const lamps = {
    parts: [V('V1', 6, 'a'), LAMP('L1', 'a', 'gnd'), LAMP('L2', 'a', 'gnd')],
    layout: { a: [380, 80], gnd: [380, 320] },
  };
  const twoLeds = {
    parts: [
      V('V1', 9, 'a', 'gnd'), R('R1', 470, 'a', 'b'), LED('LED1', 'green', 'b', 'gnd', { bends: [[600, 340]], at: 0 }),
      R('R2', 470, 'a', 'c', { bends: [[160, 200]], at: 1 }), LED('LED2', 'red', 'c', 'gnd', { bends: [[380, 340]], at: 0 }),
    ],
    layout: { a: [160, 60], b: [600, 60], c: [380, 200], gnd: [160, 340] },
  };
  twoLeds.parts[0].bends = [[100, 60], [100, 340]]; twoLeds.parts[0].at = 1;
  const string = {
    parts: [V('V1', 12, 'A'), R('R1', 1000, 'A', 'B'), R('R2', 2000, 'B', 'C'), R('R3', 3000, 'C', 'gnd', { bends: [BR], at: 0 })],
    layout: { A: TL, B: TM, C: TR, gnd: BL },
  };
  const divider = {
    parts: [V('V1', 9, 'a'), R('R1', 10000, 'a', 'out'), R('R2', 5000, 'out', 'gnd', { bends: [[380, 320]], at: 0 })],
    layout: { a: TL, out: TM, gnd: BL },
  };

  const torchTests = (lo, hi) => [ledAmps('LED1', lo, hi), ledDrop('LED1')];

  // ---------------------------------------------------------------- cases
  const cases = {};

  cases['torch-dark'] = {
    id: 'torch-dark', title: 'The torch is dead', level: 1,
    symptom: 'You press the button on a battery torch (4.5 V battery pack, switch, resistor, red LED) and the LED stays completely dark.',
    circuit: torch, tests: torchTests(0.01, 0.02), par: 3,
    hint: 'Start with the supply. Is 4.5 V arriving at the switch? Then follow the voltage along the path until it disappears.',
    variants: [
      {
        faults: [{ part: 'SW1', mode: 'open' }],
        explanation: 'The switch contacts had failed open. Full battery voltage sat on one side with nothing past it.',
        expert: [v('a', 'gnd', 'Battery voltage is present (4.5 V).'), v('b', 'gnd', '0 V after the switch: the voltage is lost between a and b.'), swap('SW1', 'Only the switch sits between them.')],
      },
      {
        faults: [{ part: 'R1', mode: 'open' }],
        explanation: 'R1 had failed open (burnt through). Voltage reaches one end; no current flows, so 0 V appears after it.',
        expert: [v('b', 'gnd', '4.5 V is present before the resistor.'), v('c', 'gnd', '0 V after it: the loss is across R1.'), swap('R1', 'An open resistor blocks the current.')],
      },
      {
        faults: [{ part: 'LED1', mode: 'open' }],
        explanation: 'The LED had failed open. With no current, there is no drop across R1, so the full supply sits on the LED.',
        expert: [v('c', 'gnd', '4.5 V on the LED’s anode: the voltage arrives but nothing flows.'), look('LED1', 'Looks normal: it is not fitted the wrong way, nor is its joint bad.'), swap('LED1', 'Everything upstream is fine, so the LED is open.')],
      },
      {
        faults: [{ part: 'V1', mode: 'drift', factor: 0.1 }],
        explanation: 'The battery pack was nearly flat (about 0.45 V), far too low to switch on an LED.',
        expert: [v('a', 'gnd', 'Only about 0.45 V at the battery: it is flat.'), swap('V1', 'Replace the batteries.')],
      },
    ],
  };

  cases['lamps-one-dark'] = {
    id: 'lamps-one-dark', title: 'One lamp is dark', level: 2,
    symptom: 'Two lamps are wired in parallel to a 6 V supply. One shines normally; the other is dark.',
    circuit: lamps,
    tests: [T('L1 is lit (0.6–1 W)', (c, { expect }) => expect(c.dc().power('L1'), 'W').toBeBetween(0.6, 1.05)), T('L2 is lit (0.6–1 W)', (c, { expect }) => expect(c.dc().power('L2'), 'W').toBeBetween(0.6, 1.05))],
    par: 2, hint: 'One lamp works, so the supply must be fine. The fault is in the dark lamp’s own branch.',
    variants: [
      {
        symptom: 'Two lamps are wired in parallel to a 6 V supply. L1 is bright; L2 is dark.',
        faults: [{ part: 'L2', mode: 'open' }],
        explanation: 'L2’s filament was broken. Its branch carried no current while the other branch was unaffected.',
        expert: [v('a', 'gnd', 'The supply is a healthy 6 V, and L1 proves it works.'), look('L2', 'No cracked joint, so the filament itself has failed.'), swap('L2', 'Replace the lamp.')],
      },
      {
        symptom: 'Two lamps are wired in parallel to a 6 V supply. L1 is bright; L2 is dark.',
        faults: [{ part: 'L2', mode: 'joint', pin: 0, ohms: 50000 }],
        explanation: 'A cracked solder joint on L2 added tens of kilohms in series, so almost no current reached the lamp.',
        expert: [v('a', 'gnd', 'Supply is fine.'), look('L2', 'A dull, cracked joint: reflowing it is cheaper than replacing the lamp.'), solder('L2', 'Reflow the joint.')],
      },
      {
        symptom: 'Two lamps are wired in parallel to a 6 V supply. L1 is dark; L2 is bright.',
        faults: [{ part: 'L1', mode: 'open' }],
        explanation: 'L1’s filament was broken. The other branch kept working because parallel branches are independent.',
        expert: [v('a', 'gnd', 'The supply is a healthy 6 V, and L2 proves it works.'), look('L1', 'Nothing visibly wrong on the outside.'), swap('L1', 'An open filament.')],
      },
    ],
  };

  const twoLedTests = [ledAmps('LED1', 0.008, 0.025), ledDrop('LED1'), ledAmps('LED2', 0.008, 0.025), ledDrop('LED2')];
  cases['two-leds'] = {
    id: 'two-leds', title: 'Two LEDs, one dark', level: 2,
    symptom: 'A 9 V board has two LED branches, each with its own 470 Ω resistor. The green LED1 is fine; the red LED2 is dark.',
    circuit: twoLeds, tests: twoLedTests, par: 3,
    hint: 'The supply and LED1 work. Isolate the dark branch: is there a voltage on LED2’s anode, and is any current flowing?',
    variants: [
      {
        faults: [{ part: 'LED2', mode: 'open' }],
        explanation: 'LED2 had failed open. With no current, R2 dropped nothing and the full 9 V sat on LED2.',
        expert: [v('c', 'gnd', 'Almost 9 V at c: voltage arrives but nothing drops across R2.'), look('LED2', 'Normal polarity and joints.'), swap('LED2', 'An open LED.')],
      },
      {
        faults: [{ part: 'R2', mode: 'open' }],
        explanation: 'R2 had failed open: no path to LED2, so its anode sat at 0 V.',
        expert: [v('c', 'gnd', '0 V at c: either R2 is open or LED2 is shorted.'), am('R2', '0 A through R2, so it is open (a shorted LED would let 19 mA flow).'), swap('R2', 'Replace the resistor.')],
      },
      {
        faults: [{ part: 'LED2', mode: 'reversed' }],
        explanation: 'LED2 had been fitted backwards. LEDs only conduct one way, so it blocked the current.',
        expert: [v('c', 'gnd', 'About 9 V at c: voltage but no current.'), look('LED2', 'The polarity marking is backwards. A glance gives it away.'), swap('LED2', 'Refit it the right way round.')],
      },
      {
        faults: [{ part: 'LED2', mode: 'short' }],
        explanation: 'LED2 had failed short-circuit. Current flowed through R2 and the dead LED, but no light came out.',
        expert: [v('c', 'gnd', 'About 0 V at c: R2 open or LED2 shorted.'), am('R2', '19 mA flows, so R2 is intact and LED2 is a short.'), swap('LED2', 'A shorted LED passes current but gives no light.')],
      },
    ],
  };

  cases['torch-dim'] = {
    id: 'torch-dim', title: 'The torch is dim', level: 3,
    symptom: 'The same battery torch (4.5 V, 180 Ω, red LED) lights, but it is much dimmer than it should be. It should carry about 15 mA.',
    circuit: torch, tests: torchTests(0.01, 0.02), par: 3,
    hint: 'A voltage across a resistor depends on current, not on its value. To find a wrong value, measure the current, or measure the resistance with the power off.',
    variants: [
      {
        faults: [{ part: 'R1', mode: 'drift', factor: 12, visible: 'The body is darkened, as if it has been running hot.' }],
        explanation: 'R1 had overheated and drifted to about 2.2 kΩ, so only about 1.2 mA flowed.',
        expert: [v('a', 'gnd', 'Battery is fine (4.5 V).'), am('R1', 'About 1.2 mA instead of ~15 mA: the resistor is too large.'), look('R1', 'A darkened body confirms it ran hot.'), swap('R1', 'Replace with 180 Ω.')],
      },
      {
        faults: [{ part: 'V1', mode: 'drift', factor: 0.5 }],
        explanation: 'The batteries were half flat (about 2.25 V), leaving little voltage to drive current through the LED.',
        expert: [v('a', 'gnd', 'Only 2.25 V where 4.5 V is expected.'), swap('V1', 'Fit fresh batteries.')],
      },
      {
        faults: [{ part: 'R1', mode: 'joint', pin: 1, ohms: 3000 }],
        explanation: 'A cracked solder joint on R1 added about 3 kΩ in series: the same effect as a bigger resistor, but cured by resoldering.',
        expert: [v('a', 'gnd', 'Battery is fine.'), am('R1', 'About 1.2 mA instead of ~15 mA: extra resistance somewhere in this branch.'), look('R1', 'A dull, cracked joint is the cause.'), solder('R1', 'Reflow it.')],
      },
    ],
  };

  const stringTests = [T('the string draws 1.9–2.1 mA', (c, { expect }) => expect(c.dc().current('V1'), 'A').toBeBetween(0.0019, 0.0021))];
  cases['series-string'] = {
    id: 'series-string', title: 'The series string', level: 3,
    symptom: 'A 12 V supply drives 1 kΩ, 2 kΩ and 3 kΩ resistors in series. The string should draw 2 mA, but it does not.',
    circuit: string, tests: stringTests, par: 2,
    hint: 'In a series string the same current flows everywhere. A drop of 0 V across a resistor, or the whole supply across it, points straight at the culprit.',
    variants: [
      {
        faults: [{ part: 'R2', mode: 'open' }],
        explanation: 'R2 had failed open. No current flowed, so the whole 12 V appeared across it.',
        expert: [v('B', 'gnd', '12 V at B: R1 is carrying no current.'), v('C', 'gnd', '0 V at C: the break is between B and C.'), swap('R2', 'R2 is open.')],
      },
      {
        faults: [{ part: 'R1', mode: 'short' }],
        explanation: 'R1 had failed short, so only 5 kΩ remained and the string drew 2.4 mA.',
        expert: [v('A', 'B', '0 V across R1 although current is flowing: R1 is a short.'), swap('R1', 'Replace it.')],
      },
      {
        faults: [{ part: 'R3', mode: 'drift', factor: 10 }],
        explanation: 'R3 had drifted to 30 kΩ, so the string drew only 0.36 mA.',
        expert: [off(), ohm('C', 'gnd', '30 kΩ where 3 kΩ is marked: R3 has drifted.'), swap('R3', 'Replace it.')],
      },
    ],
  };

  cases['divider'] = {
    id: 'divider', title: 'Divider output is wrong', level: 4,
    symptom: 'A sensor board uses a 9 V supply, R1 = 10 kΩ on top and R2 = 5 kΩ to ground. OUT should read 3 V, but it does not.',
    circuit: divider, tests: [T('OUT is 3 V (±5%)', (c, { expect }) => expect(c.dc().v('out'), 'V').toBeBetween(2.85, 3.15))], par: 3,
    hint: 'Read OUT first. A value of 9 V or 0 V points at an open or a short; anything in between points at a changed value. Then split the circuit: measure each resistor on its own with the power off.',
    variants: [
      {
        faults: [{ part: 'R2', mode: 'open' }],
        explanation: 'R2 had failed open, so OUT floated up to the full 9 V.',
        expert: [v('out', 'gnd', '9 V at OUT: R2 open or R1 shorted.'), off('Power off before measuring resistance.'), ohm('out', 'gnd', 'OL: R2 is open (if R1 were shorted we would read 5 kΩ).'), swap('R2')],
      },
      {
        faults: [{ part: 'R1', mode: 'open' }],
        explanation: 'R1 had failed open, so R2 pulled OUT to 0 V.',
        expert: [v('out', 'gnd', '0 V at OUT: R1 open or R2 shorted.'), off(), ohm('a', 'out', 'OL across R1: it is open.'), swap('R1')],
      },
      {
        faults: [{ part: 'R2', mode: 'drift', factor: 2 }],
        explanation: 'R2 had drifted to 10 kΩ, giving 4.5 V instead of 3 V.',
        expert: [v('out', 'gnd', '4.5 V: somewhere between normal and 9 V, so a value has changed.'), off(), ohm('out', 'gnd', '10 kΩ where 5 kΩ is marked: R2 has drifted.'), swap('R2')],
      },
      {
        faults: [{ part: 'R1', mode: 'short' }],
        explanation: 'R1 had failed short, so OUT followed the full 9 V supply.',
        expert: [v('out', 'gnd', '9 V at OUT: R2 open or R1 shorted.'), off(), ohm('out', 'gnd', '5 kΩ: R2 is fine, so R1 must be the problem.'), ohm('a', 'out', 'About 0 Ω across R1: it is shorted.'), swap('R1')],
      },
    ],
  };

  cases['capstone-two-leds'] = {
    id: 'capstone-two-leds', title: 'Capstone: the failing board', level: 5,
    symptom: 'The two-LED board is misbehaving: green LED1 is dark and red LED2 is only faintly glowing. There is more than one fault.',
    circuit: twoLeds, tests: twoLedTests, par: 5,
    hint: 'Treat each branch separately. Fix one fault, then re-check the symptom: if it is not completely gone, there is another fault.',
    variants: [
      {
        faults: [{ part: 'LED1', mode: 'open' }, { part: 'R2', mode: 'drift', factor: 20 }],
        explanation: 'Two independent faults: LED1 had failed open, and R2 had drifted to about 9.4 kΩ (so LED2 got under 1 mA).',
        expert: [v('b', 'gnd', '9 V on LED1’s anode: voltage but no current.'), look('LED1', 'Normal: so it is probably open.'), swap('LED1', 'Fix one fault, then re-check the other branch.'), am('R2', 'Under 1 mA where about 15 mA is expected.'), off(), ohm('a', 'c', 'About 9.4 kΩ instead of 470 Ω.'), swap('R2')],
      },
    ],
  };

  cases['capstone-torch'] = {
    id: 'capstone-torch', title: 'Capstone: the weak torch', level: 5,
    symptom: 'The battery torch is very dim. After a quick fix it is still dim. Find everything that is wrong.',
    circuit: torch, tests: torchTests(0.01, 0.02), par: 4,
    hint: 'A resistor’s drop does not reveal its value, because the LED holds its own voltage steady. Measure current, or resistance with the power off.',
    variants: [
      {
        faults: [{ part: 'V1', mode: 'drift', factor: 0.6 }, { part: 'R1', mode: 'drift', factor: 6 }],
        explanation: 'Two faults at once: weak batteries (about 2.7 V) and R1 drifted to about 1.1 kΩ. Fixing either alone left the torch dim.',
        expert: [v('a', 'gnd', '2.7 V: the batteries are weak.'), swap('V1', 'Fit fresh batteries and re-check: still dim.'), am('R1', 'About 2.5 mA instead of ~15 mA: more resistance than expected.'), off(), ohm('b', 'c', 'About 1.1 kΩ where 180 Ω is marked.'), swap('R1')],
      },
    ],
  };

  // ---------------------------------------------------------------- modules
  const quiz = (q, options, answer, why) => ({ q, options, answer, why });
  const modules = [
    {
      id: 'method', title: 'The method',
      blocks: [
        { h: 'A repeatable method' },
        { list: [
          '**Observe.** Exactly what does the device do, and what should it do?',
          '**Check the obvious.** Power, switches, batteries, connections. Most faults live here.',
          '**Hypothesise.** List what could cause *this* symptom.',
          '**Test.** Choose the measurement that rules out the most possibilities.',
          '**Fix one thing**, then **re-test the symptom**. Did that really fix it?',
        ] },
        { tip: 'Half-split: measure in the middle of the signal path. If the voltage is right there, the fault is downstream; if not, it is upstream. One measurement halves the search.' },
        { h: 'How the cases work' },
        { p: 'You see the **schematic as designed**, but one or more parts have secretly failed. Use the **Power** switch and the **meter** (V, A, Ω, Beep) to investigate, **Inspect** a part to look at it closely, then **Replace** it or **Resolder** its joints. Each measurement costs a point, and replacing a good part or guessing without evidence costs more. The review at the end shows an efficient path.' },
        { p: 'Click a dot to place the red probe, and a second dot to move the black probe (it starts on ground). Press **Take reading** to record a measurement. For current, click a part: the meter is placed in series with it.' },
        { warn: 'Resistance and continuity must be measured with the power OFF. A live circuit gives false readings and can damage a real meter. This course only uses low-voltage batteries: never open or probe mains-powered equipment.' },
      ],
      quiz: [
        quiz('A device does not work. What is the best first step?', ['Replace the most expensive part', 'Observe the symptom and check the obvious: power and connections', 'Resolder every joint', 'Measure resistance with the power on'], 1, 'Most faults are simple, and cheap checks rule things out fast.'),
        quiz('A battery that should read 4.5 V reads 0.4 V. Most likely…', ['the LED is open', 'the batteries are flat', 'a resistor has drifted', 'the switch is closed'], 1, 'The supply itself is wrong, so everything downstream will fail too.'),
        quiz('Why change only one thing at a time?', ['It is quicker', 'So you know which change cured the fault', 'Parts can only be changed singly', 'It is cheaper'], 1, 'Changing several things leaves you not knowing the cause and may hide a second fault.'),
      ],
      cases: ['torch-dark'],
    },
    {
      id: 'opens-shorts', title: 'Opens and shorts',
      blocks: [
        { h: 'The two basic failures' },
        { table: { head: ['Failure', 'Current', 'Voltage across the part', 'Downstream'], rows: [
          ['Open', 'None', 'The full available voltage', 'Sits at 0 V (nothing is pushed through)'],
          ['Short', 'Too high', 'Near 0 V', 'Everything sees more voltage than expected'],
        ] } },
        { p: 'In a series path, find the place where the voltage **disappears**: that is where the break is. In parallel branches, the supply is shared, so a dark branch next to a working one points at that branch alone.' },
        { tip: 'An open part with the full supply across it and a short with 0 V across it look different on a voltmeter but can look the same at the *next* node. Add an ammeter reading or an inspection to tell them apart.' },
        { p: 'Look first. Cracked joints and backwards LEDs are visible; failed-open filaments and shorted LEDs are not.' },
      ],
      quiz: [
        quiz('A resistor in a series circuit has failed open. A voltmeter across it reads…', ['0 V', 'the full supply voltage', 'half the supply', 'nothing: meters cannot read it'], 1, 'No current flows, so no other part drops any voltage and the supply appears across the break.'),
        quiz('A failed-short part drops…', ['the full supply', 'almost no voltage', 'half the supply'], 1, 'A short is a wire: no voltage across it, and more current through everything else.'),
        quiz('A bulb is dark but the full supply is across it. The bulb is most likely…', ['shorted', 'open', 'fine'], 1, 'Voltage is present but no current flows: the filament is broken.'),
      ],
      cases: ['lamps-one-dark', 'two-leds'],
    },
    {
      id: 'values', title: 'Values, drift and joints',
      blocks: [
        { h: 'The faults that hide' },
        { p: 'Some faults do not break anything outright: a resistor drifts, a joint goes high-resistance, batteries sag. The circuit still works, just badly.' },
        { warn: 'You cannot read a resistor’s value from the voltage across it. That voltage depends on the *current*, and in an LED circuit the LED holds its own voltage steady, so the resistor’s drop barely changes with its value. Measure the **current**, or the **resistance with the power off**.' },
        { list: [
          '**Expected current** first: I = (supply − LED voltage) / R. For 4.5 V, 1.8 V and 180 Ω that is about 15 mA.',
          '**Power off** before reading resistance, and remember parallel paths can make an in-circuit reading lower than the marked value.',
          '**Inspect.** Darkened bodies mean heat; dull, cracked solder means a cold joint.',
        ] },
      ],
      quiz: [
        quiz('Why can’t the voltage across a resistor tell you its value?', ['It can: V = I × R is enough', 'You also need the current', 'Resistors have no voltage', 'Voltage is not measurable'], 1, 'One voltage fits many resistor values; the current is what tells them apart.'),
        quiz('Why switch the power off to measure resistance?', ['The meter gets hot', 'The circuit’s own voltage causes false readings and can damage the meter', 'Resistance changes with power', 'No reason'], 1, 'The meter supplies its own test current and assumes nothing else is driving the circuit.'),
        quiz('An in-circuit resistance reads lower than the marked value. A likely reason is…', ['another path through the circuit in parallel', 'the part is open', 'the meter is broken', 'a cold joint'], 0, 'Parallel paths always lower the reading. Isolate the part if you need an exact value.'),
      ],
      cases: ['torch-dim', 'series-string'],
    },
    {
      id: 'dividers', title: 'Dividers and half-split',
      blocks: [
        { h: 'Reading a divider' },
        { p: 'A divider’s output is a ratio, so its symptoms are easy to read: **0 V or the full supply** means an open or a short; **anything in between** means a changed value.' },
        { table: { head: ['OUT reads', 'Fits'], rows: [['Full supply', 'Bottom resistor open, or top resistor shorted'], ['0 V', 'Top resistor open, or bottom resistor shorted'], ['Wrong but between', 'A resistor has drifted']] } },
        { tip: 'Two faults can look identical on one meter. Split them with a second, different measurement: current, or resistance of one part with the power off.' },
      ],
      quiz: [
        quiz('“Half-split” means…', ['cutting a resistor in half', 'measuring in the middle of the path to decide which half holds the fault', 'halving the supply voltage', 'replacing half the parts'], 1, 'Each measurement should rule out half of what is left.'),
        quiz('A divider’s output reads the full supply voltage. Which pair of faults fits?', ['bottom resistor open, or top resistor shorted', 'top resistor open, or bottom resistor shorted', 'neither'], 0, 'Either the bottom leg has disappeared or the top leg has become a wire.'),
        quiz('A divider’s output reads 0 V. A fault that fits is…', ['top resistor open', 'bottom resistor open', 'battery too strong'], 0, 'With the top resistor open, the bottom resistor pulls OUT to ground.'),
      ],
      cases: ['divider'],
    },
    {
      id: 'capstone', title: 'Capstone: two faults',
      blocks: [
        { h: 'More than one fault' },
        { p: 'Real devices often have more than one problem: a failure that kills a component can stress its neighbours, or a second weakness was already hiding behind the first.' },
        { list: ['After each repair, **re-test the original symptom**.', 'If it is better but not gone, you are not finished.', 'Treat each branch or stage as its own problem.'] },
        { p: 'These capstone cases are scored the same way, but every fault you leave in place means you are not done.' },
      ],
      quiz: [
        quiz('You fix one fault and the symptom improves but remains. What next?', ['Decide the fix was wrong', 'Keep investigating: there is probably a second fault', 'Replace the whole board', 'Ignore it'], 1, 'An improvement that is not complete is a classic sign of a second fault.'),
        quiz('Which measurement best reveals a drifted series resistor in a powered LED circuit?', ['Voltage across the LED', 'Current through the resistor (or its resistance with power off)', 'Battery voltage', 'The LED’s colour'], 1, 'The LED’s voltage hardly changes, so only current or resistance exposes the resistor.'),
        quiz('After finding and fixing a fault, what is the next step?', ['Re-test the symptom', 'Assume it worked', 'Replace more parts'], 0, 'Verification closes the loop: the fault is only fixed when the symptom is gone.'),
      ],
      cases: ['capstone-two-leds', 'capstone-torch'],
    },
  ];

  EB.CASES = cases;
  EB.MODULES = modules;
})();
