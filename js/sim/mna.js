// DC circuit solver: Modified Nodal Analysis + Newton-Raphson for diodes/LEDs.
//
// Circuit JSON: { parts: [{ id, type, value, pins: [nodeA, nodeB], ... }] }
// Node 'gnd' is the 0 V reference. Pin order matters:
//   vsource  pins[0] = + terminal          led/diode  pins[0] = anode
// Types: vsource, resistor, lamp, ldr, switch, led, diode.
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});
  const fmt = () => EB.units.format;

  const GND = 'gnd';
  const VT = 0.025852; // thermal voltage at 300 K
  const GMIN = 1e-12;
  const LED_VF = { red: 1.9, orange: 2.0, yellow: 2.0, green: 2.1, white: 3.0, blue: 3.1 };
  const LED_MAX_A = 0.03;
  const DEFAULT_RESISTOR_W = 0.25;
  const DEFAULT_LAMP_W = 1;
  const SHORT_A = 10;

  // Shockley diode with a small series resistance so a "dead short" stays finite.
  function diodeModel(p) {
    const isLed = p.type === 'led';
    const vf = isLed ? LED_VF[p.color] || 1.9 : 0.7; // forward voltage at If
    const n = isLed ? 2 : 1;
    const If = isLed ? 0.02 : 0.01;
    const rs = isLed ? 5 : 1;
    const nVt = n * VT;
    const Is = If / Math.exp((vf - If * rs) / nVt);
    return { Is, nVt, rs, vcrit: nVt * Math.log(nVt / (Math.SQRT2 * Is)) };
  }

  function pnjlim(vnew, vold, vt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) {
        const arg = (vnew - vold) / vt;
        vnew = arg > 0 ? vold + vt * (2 + Math.log(arg - 2)) : vold - vt * (2 + Math.log(2 - arg));
      } else {
        vnew = vt * Math.log(vnew / vt);
      }
    }
    return vnew;
  }

  function ldrOhms(p) {
    const light = Math.min(1, Math.max(0, p.light == null ? 0.5 : p.light));
    return (p.value || 200e3) / (1 + 99 * light);
  }

  // Resistance of a linear two-terminal part, or null when it conducts nothing.
  function resistanceOf(p) {
    if (p.open) return null; // fault: part has failed open
    if (p.shorted) return 1e-3; // fault: part has failed short
    switch (p.type) {
      case 'resistor':
      case 'lamp':
        return Math.max(p.value, 1e-3);
      case 'ldr':
        return ldrOhms(p);
      case 'switch':
        return p.closed ? 1e-3 : null;
      default:
        return null;
    }
  }

  function gauss(A, z) {
    const n = z.length;
    for (let c = 0; c < n; c++) {
      let p = c;
      let max = Math.abs(A[c][c]);
      for (let r = c + 1; r < n; r++) {
        const a = Math.abs(A[r][c]);
        if (a > max) { max = a; p = r; }
      }
      if (max < 1e-18) return null;
      if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; [z[c], z[p]] = [z[p], z[c]]; }
      const piv = A[c][c];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / piv;
        if (f === 0) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        z[r] -= f * z[c];
      }
    }
    const x = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = z[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  }

  function solveDC(json) {
    const f = fmt();
    const parts = ((json && json.parts) || []).map((p) => ({ ...p, pins: p.pins.map(String) }));
    const errors = [];
    const warnings = [];
    const infos = [];
    const byId = new Map(parts.map((p) => [p.id, p]));

    const nodeSet = new Set();
    parts.forEach((p) => p.pins.forEach((n) => nodeSet.add(n)));

    // ---- structural diagnostics, in plain English ----
    if (parts.length && !nodeSet.has(GND)) {
      errors.push('There is no ground. Use the Ground tool on a node (usually the battery’s − side) so every voltage has a 0 V reference.');
    }
    const vsources = parts.filter((p) => p.type === 'vsource' && !p.open); // an open source is disconnected (power off / dead)
    const uf = new Map();
    const find = (a) => { while (uf.get(a) !== a) { uf.set(a, uf.get(uf.get(a))); a = uf.get(a); } return a; };
    nodeSet.forEach((n) => uf.set(n, n));
    for (const s of vsources) {
      if (s.pins[0] === s.pins[1]) {
        errors.push(`${s.id} is shorted: both of its ends are on the same node, so the battery would be wired straight to itself.`);
        continue;
      }
      const a = find(s.pins[0]);
      const b = find(s.pins[1]);
      if (a === b) errors.push(`${s.id} is connected in a loop of batteries/wires with no resistance in between. Real batteries would be damaged; the simulator can’t solve it.`);
      else uf.set(a, b);
    }
    for (const p of parts) {
      if (p.type !== 'vsource' && p.pins[0] === p.pins[1]) {
        warnings.push(`${p.id} has both ends on the same node, so no current can go through it (it is bypassed by a wire).`);
      }
    }
    const degree = new Map();
    parts.forEach((p) => p.pins.forEach((n) => degree.set(n, (degree.get(n) || 0) + 1)));
    for (const p of parts) {
      for (const n of p.pins) {
        if (degree.get(n) === 1 && n !== GND && p.pins[0] !== p.pins[1]) {
          warnings.push(`${p.id} has a loose end (nothing else is connected to it), so current can’t flow through it.`);
          break;
        }
      }
    }
    if (nodeSet.has(GND)) {
      const adj = new Map();
      nodeSet.forEach((n) => adj.set(n, []));
      parts.forEach((p) => { adj.get(p.pins[0]).push(p.pins[1]); adj.get(p.pins[1]).push(p.pins[0]); });
      const seen = new Set([GND]);
      const q = [GND];
      while (q.length) for (const m of adj.get(q.pop())) if (!seen.has(m)) { seen.add(m); q.push(m); }
      const lost = parts.filter((p) => !seen.has(p.pins[0]));
      if (lost.length) warnings.push(`${lost.map((p) => p.id).join(', ')} ${lost.length > 1 ? 'are' : 'is'} not connected to the rest of the circuit (no path to ground), so ${lost.length > 1 ? 'their' : 'its'} voltages mean little.`);
    }

    const result = { ok: errors.length === 0, errors, warnings, infos, parts, burnt: [], overRated: [] };
    const nodeV = new Map();
    const partI = new Map();
    const partP = new Map();

    if (result.ok && parts.length) {
      // ---- unknown numbering: user nodes, diode internal nodes, then battery currents ----
      const names = [...nodeSet].filter((n) => n !== GND);
      const diodes = parts.filter((p) => (p.type === 'led' || p.type === 'diode') && !p.open && !p.shorted).map((p) => ({ p, m: diodeModel(p), x: p.id + '#' }));
      diodes.forEach((d) => names.push(d.x));
      const ix = new Map(names.map((n, i) => [n, i]));
      const n = names.length;
      const N = n + vsources.length;
      const idx = (name) => (ix.has(name) ? ix.get(name) : -1);

      const build = (scale, vdl) => {
        const A = Array.from({ length: N }, () => new Float64Array(N));
        const z = new Float64Array(N);
        const G = (a, b, g) => {
          const i = idx(a), j = idx(b);
          if (i >= 0) A[i][i] += g;
          if (j >= 0) A[j][j] += g;
          if (i >= 0 && j >= 0) { A[i][j] -= g; A[j][i] -= g; }
        };
        for (let i = 0; i < n; i++) A[i][i] += GMIN;
        for (const p of parts) {
          const r = resistanceOf(p);
          if (r) G(p.pins[0], p.pins[1], 1 / r);
        }
        vsources.forEach((s, k) => {
          const row = n + k, pi = idx(s.pins[0]), mi = idx(s.pins[1]);
          if (pi >= 0) { A[pi][row] += 1; A[row][pi] += 1; }
          if (mi >= 0) { A[mi][row] -= 1; A[row][mi] -= 1; }
          z[row] = s.value * scale;
        });
        diodes.forEach((d, k) => {
          G(d.p.pins[0], d.x, 1 / d.m.rs);
          const vd = vdl[k];
          const e = Math.exp(Math.min(vd / d.m.nVt, 80));
          const g = (d.m.Is / d.m.nVt) * e + GMIN;
          const ieq = d.m.Is * (e - 1) + GMIN * vd - g * vd;
          G(d.x, d.p.pins[1], g);
          const i = idx(d.x), j = idx(d.p.pins[1]);
          if (i >= 0) z[i] -= ieq;
          if (j >= 0) z[j] += ieq;
        });
        return { A, z };
      };

      const volt = (x, name) => { const i = idx(name); return i < 0 ? 0 : x[i]; };

      const newton = (scale, x0) => {
        let x = Float64Array.from(x0);
        const vdl = diodes.map((d) => volt(x, d.x) - volt(x, d.p.pins[1]));
        for (let it = 0; it < 200; it++) {
          const { A, z } = build(scale, vdl);
          const xn = gauss(A, z);
          if (!xn) return null;
          if (!diodes.length) return xn;
          let limited = false;
          diodes.forEach((d, k) => {
            const vnew = volt(xn, d.x) - volt(xn, d.p.pins[1]);
            const vlim = pnjlim(vnew, vdl[k], d.m.nVt, d.m.vcrit);
            if (Math.abs(vlim - vnew) > 1e-12) limited = true;
            vdl[k] = vlim;
          });
          let diff = 0, big = 0;
          for (let i = 0; i < N; i++) { diff = Math.max(diff, Math.abs(xn[i] - x[i])); big = Math.max(big, Math.abs(xn[i])); }
          x = xn;
          if (!limited && diff < 1e-9 + 1e-7 * big) return x;
        }
        return null;
      };

      let x = newton(1, new Float64Array(N));
      if (!x && diodes.length) {
        let guess = new Float64Array(N);
        for (let s = 1; s <= 20 && guess; s++) {
          const r = newton(s / 20, guess);
          guess = r;
          if (s === 20) x = r;
        }
      }
      if (!x) {
        result.ok = false;
        errors.push('The simulator could not find a stable answer for this circuit. Try simplifying it or checking part values.');
      } else {
        nodeV.set(GND, 0);
        for (const name of nodeSet) if (name !== GND) nodeV.set(name, x[idx(name)]);
        const V = (name) => (name === GND ? 0 : nodeV.get(name));
        const dmap = new Map(diodes.map((d) => [d.p.id, d]));
        vsources.forEach((s, k) => partI.set(s.id, -x[n + k]));
        parts.forEach((p) => { if (p.type === 'vsource' && p.open) partI.set(p.id, 0); });
        for (const p of parts) {
          if (p.type === 'vsource') continue;
          const dv = V(p.pins[0]) - V(p.pins[1]);
          const d = dmap.get(p.id);
          if (d) partI.set(p.id, (V(p.pins[0]) - volt(x, d.x)) / d.m.rs);
          else { const r = resistanceOf(p); partI.set(p.id, r ? dv / r : 0); }
        }
        for (const p of parts) {
          const dv = V(p.pins[0]) - V(p.pins[1]);
          partP.set(p.id, p.type === 'vsource' ? p.value * partI.get(p.id) : dv * partI.get(p.id));
        }

        // ---- ratings and beginner-friendly warnings ----
        for (const p of parts) {
          const I = Math.abs(partI.get(p.id));
          const P = partP.get(p.id);
          if (p.type === 'led' && (I > LED_MAX_A || V(p.pins[1]) - V(p.pins[0]) > 5)) {
            result.burnt.push(p.id);
            result.overRated.push(p.id);
            warnings.push(`${p.id} is overdriven: ${f(I, 'A')} is more than an LED can take (about 30 mA). Magic smoke! LEDs need a resistor in series to limit the current.`);
          } else if (p.type === 'diode' && I > 0.2) {
            result.burnt.push(p.id);
            result.overRated.push(p.id);
            warnings.push(`${p.id} carries ${f(I, 'A')}, more than a small signal diode can take.`);
          } else if ((p.type === 'resistor' || p.type === 'ldr') && P > (p.watts || DEFAULT_RESISTOR_W) * 1.001) {
            result.overRated.push(p.id);
            warnings.push(`${p.id} is dissipating ${f(P, 'W')} but is only rated for ${f(p.watts || DEFAULT_RESISTOR_W, 'W')}. It would overheat.`);
          } else if (p.type === 'lamp' && P > (p.watts || DEFAULT_LAMP_W) * 1.001) {
            result.overRated.push(p.id);
            warnings.push(`${p.id} is getting ${f(P, 'W')} but is rated for ${f(p.watts || DEFAULT_LAMP_W, 'W')}. The filament would burn out.`);
          } else if (p.type === 'vsource' && partI.get(p.id) > SHORT_A) {
            result.overRated.push(p.id);
            warnings.push(`${p.id} is supplying ${f(partI.get(p.id), 'A')}: that is a short circuit (a path with almost no resistance). Real batteries get dangerously hot.`);
          }
          if (p.type === 'led' && V(p.pins[1]) - V(p.pins[0]) > 0.5) {
            infos.push(`${p.id} is backwards: current can only flow from its anode (the triangle’s flat side) to its cathode (the bar).`);
          }
        }
        if (vsources.length && vsources.every((s) => Math.abs(partI.get(s.id)) < 1e-9) && parts.length > vsources.length) {
          infos.push('No current is flowing. A current needs a complete loop from the battery’s + back to its −: look for gaps or open switches.');
        }
      }
    }

    // ---- accessors ----
    const need = () => { if (!result.ok) throw new Error(errors[0] || 'This circuit can’t be solved yet.'); };
    const part = (id) => { const p = byId.get(id); if (!p) throw new Error(`There is no part called "${id}".`); return p; };
    result.nodes = [...nodeSet];
    result.v = (node) => {
      need();
      if (!nodeV.has(String(node))) throw new Error(`There is no node called "${node}".`);
      return nodeV.get(String(node));
    };
    // voltage from pin 0 to pin 1 of a part
    result.vAcross = (id) => { need(); const p = part(id); return result.v(p.pins[0]) - result.v(p.pins[1]); };
    // signed current: pin0 -> pin1 (for a battery: out of its + terminal)
    result.flow = (id) => { need(); part(id); return partI.get(id); };
    result.current = (id) => Math.abs(result.flow(id));
    result.power = (id) => { need(); part(id); return Math.abs(partP.get(id)); };
    return result;
  }

  EB.sim = { solveDC, ldrOhms, resistanceOf, LED_VF, GND };
})();
