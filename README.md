# Electronics Troubleshooting

A hands-on trainer for the *process* of finding faults. You get the schematic as designed, a symptom, and a simulated multimeter; the circuit secretly contains one or more faults. Investigate, repair, and prove the symptom is gone. Static site, vanilla JS, no build step.

This is the sibling of [electronics-bootcamp](../electronics-bootcamp). It reuses the Bootcamp's DC solver, schematic editor and unit parser (copied into `js/`, with small additions listed below).

## Status

| Piece | State |
|---|---|
| 5 modules (method, opens/shorts, values & drift, dividers & half-split, capstone) | Playable, each with teaching text and a 3-question quiz |
| 8 cases, 23 hidden-fault variants (random each play) | Playable |
| Meter: volts, amps (in series), ohms and continuity (power off only), inspect | Done |
| Repairs: replace part, resolder joints | Done |
| Process scoring and an expert-path review | Done |
| Scope/AC, transistor, digital and intermittent faults, case generator | Not built (need the Bootcamp's Phase 2–3 solvers) |

## Run

```bash
npm start     # http://localhost:8081
npm test      # fault layer, ohmmeter, scoring, and every expert path
```

## How a case plays

1. **Symptom** and the healthy schematic. Voltages, current dots and diagnostics are hidden. You only see what a technician sees (a lit or dark LED, part labels).
2. **Power** switch: batteries disconnect when off.
3. **Meter** modes: Volts (click two dots), Amps (click a part: placed in series), Ohms and Beep (power must be off, or you are refused and penalised). Press *Take reading* to record a measurement.
4. **Inspect** a part: cracked joints, backwards LEDs and heat-darkened bodies show; failed-open or drifted parts look normal.
5. **Replace part** or **Resolder joints**. A repair succeeds when the original symptom tests pass.
6. **Score** starts at 100: −1 per measurement or inspection; −15 for swapping a good part; −10 for repairing without examining the part first; −5 for resistance with power on; −10 per hint. The review lists your penalties and an efficient investigation.

## Design

```
js/faults.js     applyFaults(): open | short | drift | reversed | joint  ->  faulty circuit JSON
                 ohms(): in-circuit resistance with sources disconnected (0.2 V test, so LEDs read OL)
js/session.js    pure logic: meter, evidence, repairs, scoring (runs in the browser and in Node)
js/cases.js      modules + cases as data
js/app.js        home, module pages, case player
js/sim, engine, units, ui/schematic.js   shared with the Bootcamp
```

The learner's editor shows the **healthy** parts while the simulator solves the **faulty** circuit (`opts.solve`), so nothing leaks except what the learner chooses to measure.

Changes to the shared code relative to the Bootcamp: the solver understands `open` and `shorted` part flags (an open battery is disconnected); the editor gained `blind`, `solve` and `onPick` options, and an LED with less than 1 V across it does not glow (a shorted LED conducts but emits no light).

### Fault model

```js
{ part: 'R2', mode: 'open' }                        // failed open
{ part: 'R1', mode: 'short' }                       // failed short
{ part: 'R2', mode: 'drift', factor: 12 }           // value × 12 (battery: voltage × factor)
{ part: 'LED2', mode: 'reversed' }                  // fitted backwards
{ part: 'R1', mode: 'joint', pin: 1, ohms: 3000 }   // cold joint in series with a pin
// any fault may carry  visible: 'The body is darkened…'  (shown by Inspect)
```

## Authoring a case

Add an entry in `js/cases.js` and list it in a module:

```js
cases['my-case'] = {
  id, title, level, symptom, circuit: { parts, layout }, tests: [T(...)], par: 3, hint,
  variants: [{ faults: [...], explanation: '…', expert: [v('a'), look('R1'), swap('R1')] }],
};
```

`tests` describe the *healthy* behaviour. `expert` is the model investigation shown in the review, and `npm test` replays it.

## Self-check

`npm test` verifies, for every case and variant: the healthy circuit passes all tests; the faulty circuit fails at least one (so there is a symptom); every fault is valid; in multi-fault variants each fault matters on its own; and the **expert script fixes the circuit within par, with no penalties and a score ≥ 85**. It also checks fault injection, the ohmmeter, and the bench rules (wrong swaps, power-on resistance, unknown nodes, hints).

## Safety

Low-voltage batteries only. The course repeats the power-off rule for resistance and contains no mains-powered repair exercises.
