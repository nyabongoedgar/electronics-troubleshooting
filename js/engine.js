// Exercise engine: wraps a circuit, runs learner-facing tests, checks typed answers.
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});
  const { format, parse } = EB.units;

  class Circuit {
    constructor(json) {
      this.json = json;
      this.parts = (json && json.parts) || [];
      this._dc = null;
    }
    dc() { return (this._dc = this._dc || EB.sim.solveDC(this.json)); }
    all(type) { return this.parts.filter((p) => p.type === type); }
    count(type) { return this.all(type).length; }
    has(type) { return this.count(type) > 0; }
    part(id) { return this.parts.find((p) => p.id === id); }
    // the first part of a type; explains what is missing instead of crashing
    first(type, label) {
      const p = this.all(type)[0];
      if (!p) throw new Error(`Your circuit needs ${/^[aeiou]/i.test(label || type) ? 'an' : 'a'} ${label || type}.`);
      return p;
    }
  }

  function fail(msg) { throw new Error(msg); }

  function expect(actual, unit = '') {
    const show = (x) => (typeof x === 'number' ? format(x, unit) : JSON.stringify(x));
    return {
      toBe(x) { if (actual !== x) fail(`Expected ${show(x)} but got ${show(actual)}.`); },
      toEqual(x) { if (JSON.stringify(actual) !== JSON.stringify(x)) fail(`Expected ${show(x)} but got ${show(actual)}.`); },
      toBeTruthy(msg) { if (!actual) fail(msg || 'That should be true, but it is not.'); },
      toBeCloseTo(target, tol = 0.05) {
        const ok = target === 0 ? Math.abs(actual) <= tol : Math.abs(actual - target) <= tol * Math.abs(target);
        if (!ok) fail(`Expected about ${show(target)} (±${Math.round(tol * 100)}%) but got ${show(actual)}.`);
      },
      toBeBetween(lo, hi) {
        if (!(actual >= lo && actual <= hi)) fail(`Expected between ${show(lo)} and ${show(hi)} but got ${show(actual)}.`);
      },
      toBeAtMost(x) { if (!(actual <= x)) fail(`Expected at most ${show(x)} but got ${show(actual)}.`); },
      toBeAtLeast(x) { if (!(actual >= x)) fail(`Expected at least ${show(x)} but got ${show(actual)}.`); },
    };
  }

  // T('name', (circuit, { expect }) => { ... })  -- throws (via expect) to fail
  const T = (name, fn) => ({ name, fn });

  function runTests(tests, circuitJson) {
    const c = new Circuit(circuitJson);
    return tests.map((t) => {
      try { t.fn(c, { expect }); return { name: t.name, pass: true }; }
      catch (e) { return { name: t.name, pass: false, msg: e.message }; }
    });
  }

  // ans: { value (base units), unit, tol, bare, abs }  bare = multiplier applied to a number typed without a unit
  function checkAnswer(ans, input) {
    const p = parse(input);
    if (!p) return { pass: false, msg: 'I couldn’t read that. Type a number and a unit, like 4.7 kΩ or 12 mA.' };
    let val = ans.abs ? Math.abs(p.value) : p.value;
    if (p.unit === null) val *= ans.bare || 1;
    else if (p.unit !== ans.unit) return { pass: false, msg: `That is a value in ${p.unit}, but the question asks for ${ans.unit}.` };
    const tol = ans.tol == null ? 0.02 : ans.tol;
    const ok = Math.abs(val - ans.value) <= tol * Math.abs(ans.value);
    return ok ? { pass: true } : { pass: false, msg: 'Not quite. Check your arithmetic and your prefixes (m, k, M, µ).' };
  }

  // Build a modified copy of a circuit: setPart(json, 'LDR1', {light: 0.9})
  function withPart(json, id, patch) {
    return { ...json, parts: json.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
  }

  function withSwitches(json, closed) {
    return { ...json, parts: json.parts.map((p) => (p.type === 'switch' ? { ...p, closed } : p)) };
  }

  EB.engine = { Circuit, T, expect, runTests, checkAnswer, withPart, withSwitches };
})();
