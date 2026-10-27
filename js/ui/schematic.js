// Schematic editor + live simulation view (browser only).
//
// Model: nodes are dots, parts connect two nodes. Wires merge nodes.
// Parts keep their pin node names, so the same JSON feeds the solver and the tests.
// Editor options:
//   circuit      starting circuit JSON  { parts, layout? }
//   palette      part types the learner may add ([] = none)
//   tools        extra tools: 'wire', 'ground', 'delete'
//   editable     false = view/probe only (switches and sliders still work)
//   probe        show multimeter tool
//   showVolts    label node voltages
//   onChange(circuitJSON, op)
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});
  if (typeof document === 'undefined') return;
  const { format, parse } = EB.units;

  const W = 760, H = 400, GRID = 20, GND = 'gnd';
  const PREFIX = { resistor: 'R', vsource: 'V', led: 'LED', lamp: 'L', switch: 'SW', diode: 'D', ldr: 'LDR' };
  const LABELS = { resistor: 'Resistor', vsource: 'Battery', led: 'LED', lamp: 'Lamp', switch: 'Switch', diode: 'Diode', ldr: 'LDR' };
  const HINTS = {
    vsource: 'Click where the + end goes, then where the − end goes.',
    led: 'Click the anode (flat side of the triangle) first, then the cathode (bar).',
    diode: 'Click the anode first, then the cathode (bar).',
  };
  const DEFAULTS = {
    resistor: { value: 1000 },
    vsource: { value: 9 },
    led: { color: 'red' },
    lamp: { value: 90, watts: 1 },
    switch: { closed: true },
    diode: {},
    ldr: { value: 200000, light: 0.5 },
  };
  const LED_RGB = { red: '255,60,60', orange: '255,150,40', yellow: '255,225,60', green: '70,220,100', white: '255,255,235', blue: '90,140,255' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const snap = (v) => Math.round(v / GRID) * GRID;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function autoLayout(parts, layout) {
    const names = [];
    parts.forEach((p) => p.pins.forEach((n) => { if (!names.includes(n)) names.push(n); }));
    const missing = names.filter((n) => !layout[n]);
    if (!missing.length) return;
    const pos = {};
    const fixed = new Set();
    names.forEach((n) => { if (layout[n]) { pos[n] = [...layout[n]]; fixed.add(n); } });
    const free = missing.filter((n) => n !== GND || !layout[GND]);
    free.forEach((n, i) => {
      const a = (i / free.length) * Math.PI * 2 + 0.3;
      pos[n] = n === GND ? [W / 2, H - 60] : [W / 2 + Math.cos(a) * 200, H / 2 + Math.sin(a) * 120];
    });
    if (pos[GND] && !fixed.has(GND)) fixed.add(GND);
    for (let it = 0; it < 400; it++) {
      const f = {};
      names.forEach((n) => (f[n] = [0, 0]));
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const a = names[i], b = names[j];
          let dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1];
          const d2 = Math.max(dx * dx + dy * dy, 100);
          const k = 9000 / d2, d = Math.sqrt(d2);
          f[a][0] += (dx / d) * k; f[a][1] += (dy / d) * k;
          f[b][0] -= (dx / d) * k; f[b][1] -= (dy / d) * k;
        }
      }
      for (const p of parts) {
        const [a, b] = p.pins;
        if (a === b) continue;
        const dx = pos[b][0] - pos[a][0], dy = pos[b][1] - pos[a][1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const k = (d - 140) * 0.04;
        f[a][0] += (dx / d) * k; f[a][1] += (dy / d) * k;
        f[b][0] -= (dx / d) * k; f[b][1] -= (dy / d) * k;
      }
      for (const n of names) {
        if (fixed.has(n)) continue;
        f[n][0] += (W / 2 - pos[n][0]) * 0.004;
        f[n][1] += (H / 2 - 20 - pos[n][1]) * 0.004;
        pos[n][0] += Math.max(-8, Math.min(8, f[n][0]));
        pos[n][1] += Math.max(-8, Math.min(8, f[n][1]));
      }
    }
    for (const n of missing) {
      if (layout[n]) continue;
      layout[n] = [Math.max(40, Math.min(W - 40, snap(pos[n][0]))), Math.max(40, Math.min(H - 40, snap(pos[n][1])))];
    }
  }

  // ---------- part symbols, drawn along the x axis, length L ----------
  function symbol(p, L, st) {
    const h = L / 2;
    const I = st.I, on = st.on;
    switch (p.type) {
      case 'resistor':
      case 'ldr': {
        const pts = `${-h},0 ${-h * 0.7},0 ${-h * 0.55},-9 ${-h * 0.25},9 ${h * 0.05},-9 ${h * 0.35},9 ${h * 0.55},-9 ${h * 0.7},0 ${h},0`;
        const arrows = p.type === 'ldr' ? '<path d="M-14,-24 l8,8 m-3,-1 h3 v-3 M-2,-28 l8,8 m-3,-1 h3 v-3" class="thin"/>' : '';
        return `<polyline points="${pts}" class="sym"/>${arrows}`;
      }
      case 'vsource':
        return `<line x1="${-h}" y1="0" x2="-6" y2="0" class="sym"/><line x1="6" y1="0" x2="${h}" y2="0" class="sym"/>
          <line x1="-6" y1="-14" x2="-6" y2="14" class="sym thick"/><line x1="6" y1="-8" x2="6" y2="8" class="sym thick"/>
          <text x="-16" y="-10" class="plus">+</text><text x="12" y="-10" class="plus">−</text>`;
      case 'led':
      case 'diode': {
        const glow = p.type === 'led' && st.V > 1 ? Math.min(1, Math.max(0, I / 0.015)) : 0; // a shorted LED passes current but cannot emit light
        const rgb = LED_RGB[p.color || 'red'] || LED_RGB.red;
        const fill = p.type === 'led' ? `fill="rgba(${rgb},${0.12 + 0.88 * glow})"` : 'fill="none"';
        const halo = glow > 0.05 && !st.burnt ? `<circle r="${22 + 14 * glow}" fill="rgba(${rgb},${0.35 * glow})" stroke="none"/>` : '';
        const arrows = p.type === 'led' ? '<path d="M2,-12 l9,-9 m-4,0 h4 v4 M9,-6 l9,-9 m-4,0 h4 v4" class="thin"/>' : '';
        const smoke = st.burnt ? '<g class="smoke"><circle cx="-4" cy="-26" r="7"/><circle cx="6" cy="-38" r="9"/><circle cx="-2" cy="-52" r="11"/></g>' : '';
        return `${halo}<line x1="${-h}" y1="0" x2="-10" y2="0" class="sym"/><line x1="10" y1="0" x2="${h}" y2="0" class="sym"/>
          <polygon points="-10,-12 -10,12 10,0" class="sym" ${fill}/><line x1="10" y1="-12" x2="10" y2="12" class="sym thick"/>${arrows}${smoke}`;
      }
      case 'lamp': {
        const g = Math.min(1, Math.max(0, st.P / (p.watts || 1)));
        const halo = g > 0.03 ? `<circle r="${24 + 18 * g}" fill="rgba(255,220,80,${0.45 * g})" stroke="none"/>` : '';
        return `${halo}<line x1="${-h}" y1="0" x2="-14" y2="0" class="sym"/><line x1="14" y1="0" x2="${h}" y2="0" class="sym"/>
          <circle r="14" class="sym" fill="rgba(255,225,90,${0.1 + 0.9 * g})"/><path d="M-10,-10 L10,10 M10,-10 L-10,10" class="sym thin"/>
          ${st.burnt ? '<g class="smoke"><circle cx="0" cy="-26" r="8"/><circle cx="6" cy="-40" r="10"/></g>' : ''}`;
      }
      case 'switch':
        return p.closed
          ? `<line x1="${-h}" y1="0" x2="-14" y2="0" class="sym"/><line x1="-14" y1="0" x2="14" y2="0" class="sym thick"/><line x1="14" y1="0" x2="${h}" y2="0" class="sym"/><circle cx="-14" r="3" class="dot"/><circle cx="14" r="3" class="dot"/>`
          : `<line x1="${-h}" y1="0" x2="-14" y2="0" class="sym"/><line x1="-14" y1="0" x2="12" y2="-16" class="sym thick"/><line x1="14" y1="0" x2="${h}" y2="0" class="sym"/><circle cx="-14" r="3" class="dot"/><circle cx="14" r="3" class="dot"/>`;
      default:
        return `<line x1="${-h}" y1="0" x2="${h}" y2="0" class="sym"/>`;
    }
  }

  function valueLabel(p) {
    switch (p.type) {
      case 'resistor': return format(p.value, 'Ω');
      case 'ldr': return format(EB.sim.ldrOhms(p), 'Ω');
      case 'vsource': return format(p.value, 'V');
      case 'lamp': return `${format(p.value, 'Ω')}`;
      case 'led': return p.color || 'red';
      case 'switch': return p.closed ? 'closed' : 'open';
      default: return '';
    }
  }

  class Editor {
    constructor(host, opts = {}) {
      this.host = host;
      this.opts = Object.assign({ palette: [], tools: [], editable: true, probe: false, showVolts: true, showNames: true, caption: '', blind: false, solve: null, onPick: null }, opts);
      this.tool = opts.tool || 'select';
      this.pending = null;
      this.sel = null;
      this.probeState = { red: null, black: GND, part: null };
      this.cursor = null;
      this.drag = null;
      this.setCircuit(opts.circuit || { parts: [] }, false);
      this.build();
      this.refresh();
    }

    // ---------- model ----------
    setCircuit(json, redraw = true) {
      const c = clone(json);
      this.parts = c.parts || [];
      this.layout = c.layout || {};
      autoLayout(this.parts, this.layout);
      this.sel = null;
      this.pending = null;
      if (redraw) this.refresh();
    }
    getCircuit() {
      const used = new Set();
      this.parts.forEach((p) => p.pins.forEach((n) => used.add(n)));
      const layout = {};
      for (const n of Object.keys(this.layout)) if (used.has(n) || this.extra.has(n)) layout[n] = this.layout[n];
      return clone({ parts: this.parts, layout });
    }
    get extra() { return this._extra || (this._extra = new Set()); }
    nodeNames() { return Object.keys(this.layout).filter((n) => this.parts.some((p) => p.pins.includes(n)) || this.extra.has(n)); }
    nextId(type) {
      let i = 1;
      while (this.parts.some((p) => p.id === PREFIX[type] + i)) i++;
      return PREFIX[type] + i;
    }
    freshNode() {
      let i = 1;
      while (this.layout['n' + i]) i++;
      return 'n' + i;
    }
    renameNode(from, to) {
      if (from === to) return;
      this.parts.forEach((p) => (p.pins = p.pins.map((n) => (n === from ? to : n))));
      if (!this.layout[to]) this.layout[to] = this.layout[from];
      delete this.layout[from];
      this.extra.delete(from);
    }
    pruneNodes() {
      for (const n of Object.keys(this.layout)) {
        if (n !== GND && !this.parts.some((p) => p.pins.includes(n)) && !this.extra.has(n)) delete this.layout[n];
      }
    }

    // ---------- DOM ----------
    build() {
      const o = this.opts;
      const root = this.root = document.createElement('div');
      root.className = 'editor';
      const tools = [['select', 'Select']];
      (o.palette || []).forEach((t) => tools.push([t, LABELS[t]]));
      if (o.editable) {
        if (o.tools.includes('wire')) tools.push(['wire', 'Wire']);
        if (o.tools.includes('ground')) tools.push(['ground', 'Ground']);
        if (o.tools.includes('delete')) tools.push(['delete', 'Delete']);
      }
      if (o.probe) tools.push(['probe', o.blind ? 'Probe' : 'Multimeter']);
      root.innerHTML = `
        <div class="toolbar" role="toolbar" aria-label="Circuit tools">
          ${tools.map(([k, l]) => `<button type="button" class="tool" data-tool="${k}">${l}</button>`).join('')}
          <span class="spacer"></span>
          ${o.blind ? '' : `<label class="chk"><input type="checkbox" data-opt="volts" ${o.showVolts ? 'checked' : ''}> voltages</label>`}
        </div>
        <div class="canvas-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.caption || 'Circuit schematic')}" tabindex="0"></svg></div>
        <div class="status" aria-live="polite"></div>
        <div class="panel props"></div>
        <div class="panel meter" hidden></div>
        <ul class="diag"></ul>`;
      this.host.appendChild(root);
      this.svg = root.querySelector('svg');
      this.statusEl = root.querySelector('.status');
      this.propsEl = root.querySelector('.props');
      this.meterEl = root.querySelector('.meter');
      this.diagEl = root.querySelector('.diag');
      root.querySelector('.toolbar').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tool]');
        if (b) { this.tool = b.dataset.tool; this.pending = null; this.sel = null; this.refresh(); }
      });
      const vc = root.querySelector('[data-opt=volts]');
      if (vc) vc.addEventListener('change', (e) => { o.showVolts = e.target.checked; this.refresh(); });
      this.svg.addEventListener('pointerdown', (e) => this.onDown(e));
      this.svg.addEventListener('pointermove', (e) => this.onMove(e));
      this.svg.addEventListener('pointerup', (e) => this.onUp(e));
      this.svg.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && this.sel.part && this.opts.editable) { this.removePart(this.sel.part); }
        if (e.key === 'Escape') { this.pending = null; this.refresh(); }
      });
      this.propsEl.addEventListener('change', (e) => this.onProp(e));
      this.propsEl.addEventListener('input', (e) => { if (e.target.type === 'range') this.onProp(e); });
      this.propsEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]') && this.sel && this.sel.part) this.removePart(this.sel.part);
      });
    }
    destroy() { this.root.remove(); }

    point(e) {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const r = pt.matrixTransform(this.svg.getScreenCTM().inverse());
      return [r.x, r.y];
    }

    // ---------- interaction ----------
    hitNode(x, y) {
      let best = null, bd = 16;
      for (const n of this.nodeNames()) {
        const d = Math.hypot(this.layout[n][0] - x, this.layout[n][1] - y);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }
    onDown(e) {
      const [x, y] = this.point(e);
      const partEl = e.target.closest('[data-part]');
      const part = partEl ? this.parts.find((p) => p.id === partEl.dataset.part) : null;
      const node = this.hitNode(x, y);
      const t = this.tool;
      this.svg.focus({ preventScroll: true });

      if (PREFIX[t] && this.opts.editable) return this.addClick(node, x, y, t);
      if (t === 'wire' && node) {
        if (!this.pending) this.pending = { node };
        else { if (this.pending.node !== node) this.merge(this.pending.node, node); this.pending = null; }
        return this.refresh();
      }
      if (t === 'ground' && node) {
        if (node === GND) this.renameNode(GND, this.freshNode());
        else this.renameNode(node, GND);
        return this.changed();
      }
      if (t === 'delete') {
        if (part) return this.removePart(part.id);
        return;
      }
      if (t === 'probe' && this.opts.blind) {
        if (part || node) this.opts.onPick({ tool: 'probe', part: part ? part.id : null, node: part ? null : node });
        return;
      }
      if (t === 'probe') {
        if (part) { this.probeState.part = part.id; this.sel = { part: part.id }; return this.refresh(); }
        if (node) {
          if (!this.probeState.red || this.probeState.pickedBoth) { this.probeState = { red: node, black: GND, part: null }; }
          else { this.probeState.black = node; this.probeState.pickedBoth = true; }
          this.sel = { node };
          return this.refresh();
        }
        return;
      }
      // select tool
      if (part) {
        if (part.type === 'switch') { part.closed = !part.closed; this.sel = { part: part.id }; if (this.opts.onPick) this.opts.onPick({ tool: 'select', part: part.id, node: null }); return this.changed(); }
        this.sel = { part: part.id };
        if (this.opts.onPick) this.opts.onPick({ tool: 'select', part: part.id, node: null });
        return this.refresh();
      }
      if (node) {
        this.sel = { node };
        if (this.opts.editable) { this.drag = { node, moved: false }; this.svg.setPointerCapture(e.pointerId); }
        return this.refresh();
      }
      this.sel = null;
      this.refresh();
    }
    onMove(e) {
      const [x, y] = this.point(e);
      if (this.drag) {
        this.parts.forEach((p) => { if (p.pins.includes(this.drag.node)) delete p.bends; });
        this.layout[this.drag.node] = [Math.max(20, Math.min(W - 20, snap(x))), Math.max(20, Math.min(H - 20, snap(y)))];
        this.drag.moved = true;
        return this.draw();
      }
      if (this.pending) { this.cursor = [snap(x), snap(y)]; this.draw(); }
    }
    onUp(e) {
      if (this.drag) {
        try { this.svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        const moved = this.drag.moved;
        this.drag = null;
        if (moved) this.changed();
      }
    }
    addClick(node, x, y, type) {
      let n = node;
      if (!n) {
        n = this.freshNode();
        this.layout[n] = [Math.max(20, Math.min(W - 20, snap(x))), Math.max(20, Math.min(H - 20, snap(y)))];
        this.extra.add(n);
      }
      if (!this.pending) { this.pending = { node: n, type }; return this.refresh(); }
      if (this.pending.node === n) { this.pending = null; this.pruneNodes(); return this.refresh(); }
      const p = { id: this.nextId(type), type, ...clone(DEFAULTS[type]), pins: [this.pending.node, n] };
      this.parts.push(p);
      this.extra.delete(this.pending.node);
      this.extra.delete(n);
      this.pending = null;
      this.sel = { part: p.id };
      this.tool = 'select';
      this.changed();
    }
    merge(a, b) {
      // keep ground's name; otherwise keep a
      const keep = a === GND || b !== GND ? a : b;
      const drop = keep === a ? b : a;
      this.parts.forEach((p) => { if (p.pins.includes(drop)) { delete p.bends; p.pins = p.pins.map((n) => (n === drop ? keep : n)); } });
      delete this.layout[drop];
      this.extra.delete(drop);
      this.changed();
    }
    removePart(id) {
      this.parts = this.parts.filter((p) => p.id !== id);
      this.sel = null;
      this.pruneNodes();
      this.changed();
    }
    onProp(e) {
      const part = this.parts.find((p) => this.sel && p.id === this.sel.part);
      if (!part) return;
      const k = e.target.dataset.prop;
      if (k === 'value') {
        const r = parse(e.target.value);
        if (r && r.value > 0) part.value = r.value;
      } else if (k === 'closed') part.closed = e.target.checked;
      else if (k === 'color') part.color = e.target.value;
      else if (k === 'light') part.light = +e.target.value / 100;
      this.changed(e.target.type === 'range');
    }
    changed(keepProps) {
      this.refresh(keepProps);
      if (this.opts.onChange) this.opts.onChange(this.getCircuit(), this.op);
    }

    // ---------- drawing ----------
    refresh(keepProps) {
      this.op = this.opts.solve ? this.opts.solve(this.parts) : EB.sim.solveDC({ parts: this.parts });
      this.root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool)));
      this.draw();
      if (!keepProps) this.drawProps();
      this.drawMeter();
      this.drawDiag();
      const t = this.tool;
      this.statusEl.textContent = this.pending
        ? (HINTS[t] && this.pending.type ? 'Now click the other end.' : 'Now click the second point.')
        : PREFIX[t] ? (HINTS[t] || `Click two points to place the ${LABELS[t].toLowerCase()}. Click an empty spot to start a new point.`)
        : t === 'wire' ? 'Click one dot, then another dot, to join them with a wire.'
        : t === 'ground' ? 'Click a dot to make it ground (0 V). Click ground again to undo.'
        : t === 'delete' ? 'Click a part to delete it.'
        : t === 'probe' ? 'Click a dot for the red probe, another for the black probe (starts on ground). Click a part to read its current.'
        : this.opts.editable ? 'Drag dots to move them. Click a part to edit it. Click a switch to flip it.' : 'Click a switch or part to interact.';
    }

    draw() {
      const op = this.op;
      const solved = op.ok;
      const parts = this.parts;
      const g = [];
      const pos = (n) => this.layout[n];
      // group parallel parts so they fan out
      const groups = new Map();
      parts.filter((p) => !(p.bends && p.bends.length)).forEach((p) => {
        const k = [...p.pins].sort().join('|');
        (groups.get(k) || groups.set(k, []).get(k)).push(p);
      });
      let vmax = 0;
      if (solved) op.nodes.forEach((n) => { vmax = Math.max(vmax, Math.abs(op.v(n))); });

      for (const p of parts) {
        const [a, b] = p.pins.map(pos);
        if (!a || !b) continue;
        // geometry: a straight line, a fanned-out bracket for parallel parts, or an authored route with bends
        let pts, i0;
        if (p.bends && p.bends.length) {
          pts = [a, ...p.bends, b];
          i0 = p.at != null ? p.at : pts.slice(0, -1).reduce((best, q, i) => (Math.hypot(pts[i + 1][0] - q[0], pts[i + 1][1] - q[1]) > Math.hypot(pts[best + 1][0] - pts[best][0], pts[best + 1][1] - pts[best][1]) ? i : best), 0);
        } else {
          const grp = groups.get([...p.pins].sort().join('|'));
          const off = grp.length > 1 ? (grp.indexOf(p) - (grp.length - 1) / 2) * 70 * (p.pins[0] <= p.pins[1] ? 1 : -1) : 0;
          const dx0 = b[0] - a[0], dy0 = b[1] - a[1];
          const d0 = Math.hypot(dx0, dy0) || 1;
          const o = [(-dy0 / d0) * off, (dx0 / d0) * off];
          pts = off ? [a, [a[0] + o[0], a[1] + o[1]], [b[0] + o[0], b[1] + o[1]], b] : [a, b];
          i0 = off ? 1 : 0;
        }
        const s0 = pts[i0], s1 = pts[i0 + 1];
        const dx = s1[0] - s0[0], dy = s1[1] - s0[1];
        const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        const mx = (s0[0] + s1[0]) / 2, my = (s0[1] + s1[1]) / 2;
        const L = Math.max(24, Math.min(64, d * 0.8));
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const path = pts.map((q) => q.join(',')).join(' ');
        const I = solved ? op.flow(p.id) : 0;
        const st = { I: Math.abs(I), V: solved ? op.vAcross(p.id) : 0, P: solved ? op.power(p.id) : 0, burnt: op.burnt.includes(p.id), on: true };
        const sel = this.sel && this.sel.part === p.id;
        let flow = '';
        if (!this.opts.blind && solved && Math.abs(I) > 1e-6 && p.type !== 'switch' || (p.type === 'switch' && p.closed && Math.abs(I) > 1e-6)) {
          const dur = Math.max(0.12, 1.4 / (1 + Math.abs(I) * 220));
          const sign = p.type === 'vsource' ? -1 : 1; // battery flow is out of +, drawn from pin0 -> pin1 internally
          flow = `<polyline points="${path}" class="flow ${I * sign < 0 ? 'rev' : ''}" style="animation-duration:${dur}s"/>`;
        }
        const lblSide = ny > 0 ? -1 : 1;
        const gap = p.type === 'vsource' || p.type === 'led' || p.type === 'lamp' ? 44 : 30;
        const lx = mx + nx * gap * lblSide;
        const ly = my + ny * gap * lblSide - 2;
        g.push(`<g class="part ${sel ? 'sel' : ''} ${st.burnt ? 'burnt' : ''}" data-part="${esc(p.id)}">
          <polyline points="${path}" class="wire"/>${flow}
          <rect x="${-L / 2 - 4}" y="-20" width="${L + 8}" height="40" transform="translate(${mx},${my}) rotate(${ang})" class="hit"/>
          <g transform="translate(${mx},${my}) rotate(${ang})">${symbol(p, L, st)}</g>
          <text x="${lx}" y="${ly}" class="plabel" text-anchor="middle">${esc(p.id)} <tspan class="pval">${esc(valueLabel(p))}</tspan></text>
        </g>`);
      }

      for (const n of this.nodeNames()) {
        const [x, y] = pos(n);
        const v = solved && !this.opts.blind && op.nodes.includes(n) ? op.v(n) : null;
        const frac = v == null || !vmax ? 0 : Math.max(0, Math.min(1, v / vmax));
        const isG = n === GND;
        const sel = (this.sel && this.sel.node === n) || (this.pending && this.pending.node === n);
        const pr = this.probeState;
        const probeTag = this.tool === 'probe' && (pr.red === n ? 'red' : pr.black === n && pr.pickedBoth ? 'black' : '');
        const showName = this.opts.showNames && !/^n\d+$/.test(n) && !isG;
        g.push(`<g class="node ${sel ? 'sel' : ''}" data-node="${esc(n)}">
          ${isG ? `<path d="M${x - 12},${y + 10} h24 M${x - 8},${y + 15} h16 M${x - 4},${y + 20} h8 M${x},${y} v10" class="gndsym"/>` : ''}
          <circle cx="${x}" cy="${y}" r="${sel ? 7 : 5.5}" class="ndot" style="fill:${v == null ? 'var(--ink)' : `hsl(${215 - 215 * frac},75%,${48 + 6 * frac}%)`}"/>
          ${probeTag ? `<circle cx="${x}" cy="${y}" r="10" class="probe ${probeTag}"/>` : ''}
          ${showName ? `<text x="${x + 9}" y="${y - 9}" class="nname">${esc(n)}</text>` : ''}
          ${this.opts.showVolts && v != null ? `<text x="${x + (isG ? 18 : 9)}" y="${y + (showName ? 17 : 5)}" class="nvolt">${esc(format(v, 'V'))}</text>` : ''}
        </g>`);
      }
      if (this.pending && this.cursor && this.layout[this.pending.node]) {
        const [x, y] = this.layout[this.pending.node];
        g.push(`<line x1="${x}" y1="${y}" x2="${this.cursor[0]}" y2="${this.cursor[1]}" class="ghost"/>`);
      }
      if (!parts.length) g.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="empty">${this.opts.editable ? 'Empty. Pick a part from the toolbar.' : 'Nothing here'}</text>`);
      this.svg.innerHTML = g.join('');
    }

    drawProps() {
      const p = this.parts.find((q) => this.sel && q.id === this.sel.part);
      const el = this.propsEl;
      if (this.opts.blind) { el.hidden = true; el.innerHTML = ''; return; }
      if (!p) {
        if (this.sel && this.sel.node && this.op.ok && this.op.nodes.includes(this.sel.node)) {
          el.hidden = false;
          el.innerHTML = `<strong>Node ${esc(this.sel.node === GND ? 'ground' : this.sel.node)}</strong>: ${esc(format(this.op.v(this.sel.node), 'V'))} relative to ground`;
        } else { el.hidden = true; el.innerHTML = ''; }
        return;
      }
      el.hidden = false;
      const ed = this.opts.editable;
      const parts = [`<strong>${esc(p.id)}</strong> · ${LABELS[p.type]}`];
      if (this.op.ok) {
        const I = this.op.current(p.id);
        parts.push(`${esc(format(this.op.vAcross(p.id), 'V'))} across · ${esc(format(I, 'A'))} through · ${esc(format(this.op.power(p.id), 'W'))}`);
      }
      const ctl = [];
      if (['resistor', 'vsource', 'lamp'].includes(p.type) && ed) {
        const unit = p.type === 'vsource' ? 'V' : 'Ω';
        const list = p.type === 'resistor' ? `<datalist id="e12">${EB.units.e12Values(0, 6).map((v) => `<option value="${v}">`).join('')}</datalist>` : '';
        ctl.push(`<label>Value <input data-prop="value" ${p.type === 'resistor' ? 'list="e12"' : ''} value="${esc(format(p.value, '').trim())}" size="8" aria-label="Value in ${unit}"> ${unit}</label>${list}`);
      }
      if (p.type === 'led' && ed) ctl.push(`<label>Colour <select data-prop="color">${Object.keys(EB.sim.LED_VF).map((c) => `<option ${p.color === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`);
      if (p.type === 'switch') ctl.push(`<label><input type="checkbox" data-prop="closed" ${p.closed ? 'checked' : ''}> closed (on)</label>`);
      if (p.type === 'ldr') ctl.push(`<label>Light <input type="range" data-prop="light" min="0" max="100" value="${Math.round((p.light == null ? 0.5 : p.light) * 100)}"> </label>`);
      if (ed) ctl.push('<button type="button" data-del class="small danger">Delete</button>');
      el.innerHTML = `<div>${parts.join('<br>')}</div><div class="ctl">${ctl.join('')}</div>`;
    }

    drawMeter() {
      const el = this.meterEl;
      if (this.opts.blind || this.tool !== 'probe' || !this.op.ok) { el.hidden = true; return; }
      el.hidden = false;
      const pr = this.probeState;
      let html = '<strong>Multimeter</strong> ';
      if (pr.red && this.op.nodes.includes(pr.red) && this.op.nodes.includes(pr.black)) {
        html += `<span class="reading">${esc(format(this.op.v(pr.red) - this.op.v(pr.black), 'V'))}</span> <span class="muted">red on ${esc(pr.red)}, black on ${esc(pr.black === GND ? 'ground' : pr.black)}</span>`;
      } else html += '<span class="muted">Click a dot to place the red probe.</span>';
      if (pr.part && this.parts.some((p) => p.id === pr.part)) {
        html += `<br><span class="reading">${esc(format(this.op.current(pr.part), 'A'))}</span> <span class="muted">current through ${esc(pr.part)} (ammeter in series)</span>`;
      }
      el.innerHTML = html;
    }

    drawDiag() {
      const op = this.op;
      if (this.opts.blind) { this.diagEl.innerHTML = ''; return; }
      const items = [
        ...op.errors.map((m) => `<li class="err">${esc(m)}</li>`),
        ...op.warnings.map((m) => `<li class="warn">${esc(m)}</li>`),
        ...op.infos.map((m) => `<li class="info">${esc(m)}</li>`),
      ];
      this.diagEl.innerHTML = items.join('');
    }
  }

  EB.ui = EB.ui || {};
  EB.ui.Editor = Editor;
})();
