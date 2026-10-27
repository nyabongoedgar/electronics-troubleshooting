// App shell: home, module pages, and the case player.
(function () {
  const EB = globalThis.EB;
  const { format } = EB.units;
  const app = document.getElementById('app');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // ---------- progress ----------
  const KEY = 'et-progress-v1';
  let memory = {};
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return memory; } },
    save(p) { memory = p; try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) { /* ignore */ } },
    best(id) { return this.load()[`case:${id}`] || 0; },
    setBest(id, score) { const p = this.load(); p[`case:${id}`] = Math.max(p[`case:${id}`] || 0, score); this.save(p); },
    quiz(id) { return !!this.load()[`quiz:${id}`]; },
    markQuiz(id) { const p = this.load(); p[`quiz:${id}`] = true; this.save(p); },
    reset() { this.save({}); },
  };

  // ---------- routing ----------
  let editor = null;
  function route() {
    if (editor) { try { editor.destroy(); } catch (_) { /* gone */ } editor = null; }
    const [, kind, a, b] = (location.hash || '#/').split('/');
    if (kind === 'module' && EB.MODULES.find((m) => m.id === a)) renderModule(EB.MODULES.find((m) => m.id === a));
    else if (kind === 'case' && EB.CASES[a]) renderCase(EB.CASES[a], b === undefined ? undefined : +b);
    else renderHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ---------- home ----------
  const stars = (n) => (n >= 85 ? '★★★' : n >= 65 ? '★★☆' : n > 0 ? '★☆☆' : '☆☆☆');

  function renderHome() {
    document.title = 'Electronics Troubleshooting';
    const total = Object.keys(EB.CASES).length;
    const done = Object.keys(EB.CASES).filter((k) => store.best(k) > 0).length;
    app.innerHTML = `
      <h1>Find the fault</h1>
      <p class="lede">A device has stopped working. You get the schematic, a multimeter and a symptom. Work out what has failed, fix it, and prove it. Every case has several hidden faults that change each time you play, so you cannot memorise answers.</p>
      <p class="muted">${done} of ${total} cases solved · <button class="small danger" id="reset" type="button">Reset progress</button></p>
      ${EB.MODULES.map((m, i) => `<section class="card" style="margin:14px 0">
        <h3 style="margin-top:0"><a href="#/module/${m.id}">${i + 1}. ${esc(m.title)}</a></h3>
        <div class="cards">${m.cases.map((k) => { const c = EB.CASES[k]; const b = store.best(k);
          return `<article class="card"><span class="lvl">Level ${c.level} · ${c.variants.length} fault variant${c.variants.length > 1 ? 's' : ''}</span>
            <h3 style="margin:4px 0">${esc(c.title)}</h3>
            <p class="${b ? 'best' : 'muted'}">${b ? `${stars(b)} best ${b}` : 'Not solved yet'}</p>
            <a class="btn small" href="#/case/${k}">${b ? 'Play again' : 'Start'}</a></article>`; }).join('')}</div>
      </section>`).join('')}
      <p class="muted">New here? Start with module 1: <a href="#/module/method">The method</a>.</p>`;
    document.getElementById('reset').onclick = () => { if (confirm('Erase all saved progress in this browser?')) { store.reset(); route(); } };
  }

  // ---------- module page ----------
  function renderBlock(b) {
    if (b.h) return `<h2>${inline(b.h)}</h2>`;
    if (b.p) return `<p>${inline(b.p)}</p>`;
    if (b.list) return `<ul>${b.list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`;
    if (b.tip) return `<div class="block-tip"><strong>Tip.</strong> ${inline(b.tip)}</div>`;
    if (b.warn) return `<div class="block-warn"><strong>Careful.</strong> ${inline(b.warn)}</div>`;
    if (b.table) return `<div style="overflow-x:auto"><table class="data"><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return '';
  }

  function renderModule(m) {
    document.title = `${m.title} · Electronics Troubleshooting`;
    const idx = EB.MODULES.indexOf(m);
    const next = EB.MODULES[idx + 1];
    app.innerHTML = `<p><a href="#/">← All cases</a></p><p class="muted">Module ${idx + 1} of ${EB.MODULES.length}</p><h1>${esc(m.title)}</h1>
      ${m.blocks.map(renderBlock).join('')}
      <h2>Quick check</h2><div id="quiz"></div>
      <h2>Cases</h2><div class="cards">${m.cases.map((k) => { const c = EB.CASES[k]; const b = store.best(k);
        return `<article class="card"><span class="lvl">Level ${c.level}</span><h3 style="margin:4px 0">${esc(c.title)}</h3><p>${esc(c.symptom)}</p><p class="${b ? 'best' : 'muted'}">${b ? `${stars(b)} best ${b}` : 'Not solved yet'}</p><a class="btn small" href="#/case/${k}">${b ? 'Play again' : 'Start'}</a></article>`; }).join('')}</div>
      <p style="margin-top:28px">${next ? `<a class="btn secondary" href="#/module/${next.id}">Next: ${esc(next.title)} →</a>` : ''}</p>`;
    m.quiz.forEach((q, i) => {
      const host = app.querySelector('#quiz');
      const el = document.createElement('div');
      el.className = 'quiz';
      const key = `${m.id}:${i}`;
      el.innerHTML = `<p class="q"><strong>${i + 1}.</strong> ${inline(q.q)}</p>${q.options.map((o, j) => `<label><input type="radio" name="q-${key}" value="${j}"> ${inline(o)}</label>`).join('')}<p class="why" aria-live="polite"></p>`;
      host.appendChild(el);
      const labels = el.querySelectorAll('label');
      if (store.quiz(key)) { labels[q.answer].classList.add('right'); el.querySelector('.why').textContent = q.why; }
      el.addEventListener('change', (e) => {
        const j = +e.target.value;
        labels.forEach((l) => l.classList.remove('right', 'wrong'));
        if (j === q.answer) { labels[j].classList.add('right'); el.querySelector('.why').textContent = 'Correct. ' + q.why; store.markQuiz(key); }
        else { labels[j].classList.add('wrong'); el.querySelector('.why').textContent = 'Not quite. Have another go.'; }
      });
    });
  }

  // ---------- case player ----------
  const MODES = [['V', 'Volts'], ['A', 'Amps'], ['R', 'Ohms'], ['C', 'Beep']];

  function renderCase(c, forcedVariant) {
    document.title = `${c.title} · Electronics Troubleshooting`;
    const vi = forcedVariant >= 0 && forcedVariant < c.variants.length ? forcedVariant : Math.floor(Math.random() * c.variants.length);
    const s = EB.session.create(c, vi);
    let mode = 'V';
    const probes = { red: null, black: 'gnd', both: false };
    let part = null;
    let reading = null;
    let finished = false;

    app.innerHTML = `
      <p><a href="#/">← All cases</a> <span class="lvl">· Level ${c.level}</span></p>
      <h1>${esc(c.title)}</h1>
      <div class="symptom"><strong>Symptom.</strong> ${esc(s.symptom)}</div>
      <div class="benchbar">
        <button type="button" class="pwr" id="pwr" aria-pressed="true">Power: ON</button>
        <span class="lbl">Meter</span>
        <span class="seg" role="group" aria-label="Meter mode">${MODES.map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${k === mode}">${l}</button>`).join('')}</span>
      </div>
      <div id="ed"></div>
      <div class="meterbox"><div id="meterinfo" class="muted" aria-live="polite"></div><div style="display:flex;gap:10px;align-items:center"><span class="lcd idle" id="lcd" role="status">- - -</span><button type="button" class="btn small" id="take">Take reading</button></div></div>
      <div class="partbox"><div id="partinfo" class="muted">Select a part (Select tool) to inspect or repair it.</div>
        <div class="actions" style="margin:0"><button type="button" id="inspect" disabled>Inspect</button><button type="button" id="replace" disabled>Replace part</button><button type="button" id="resolder" disabled>Resolder joints</button></div></div>
      <div class="notes"><p class="note-line" id="notes" aria-live="polite">Bench notes appear here.</p></div>
      <div class="scorebar"><span>Score <strong id="score">100</strong></span><span>Measurements <strong id="probes">0</strong> (par ${c.par})</span><span id="pen"></span></div>
      <div class="actions"><button type="button" id="hint">Hint (−10)</button><button type="button" id="giveup">Give up and reveal</button><button type="button" id="again">Try another variation</button></div>
      <div class="hint" id="hintbox" hidden></div>
      <details id="logwrap"><summary>Measurement log</summary><table class="log"><thead><tr><th>#</th><th>What</th><th>Reading</th></tr></thead><tbody id="log"></tbody></table></details>
      <div id="review"></div>`;

    const $ = (id) => app.querySelector('#' + id);
    const ledOk = () => !finished;

    function refreshStats() {
      $('score').textContent = s.score();
      $('probes').textContent = s.probeCount();
      const pen = s.penalties.reduce((a, p) => a + p.pts, 0);
      $('pen').innerHTML = pen ? `Penalties <strong>−${pen}</strong>` : '';
      $('log').innerHTML = s.log.map((l) => `<tr><td>${l.n}</td><td>${esc(l.desc)}${l.power ? '' : ' (power off)'}</td><td>${esc(l.reading)}</td></tr>`).join('');
    }
    function setNote(t) { $('notes').textContent = t; }

    function drawMeterInfo() {
      let t;
      if (mode === 'A') t = part ? `Meter in series with ${part}. Press Take reading.` : 'Click a part to place the meter in series with it.';
      else if (!probes.red) t = 'Click a dot to place the red probe. The black probe starts on ground.';
      else t = `Red on ${probes.red}, black on ${probes.black === 'gnd' ? 'ground' : probes.black}. Click another dot to move the black probe.`;
      if ((mode === 'R' || mode === 'C') && s.power) t += ' Turn the power off first.';
      $('meterinfo').textContent = t;
    }
    function clearReading() { reading = null; $('lcd').textContent = '- - -'; $('lcd').classList.add('idle'); }

    function syncProbeRings() {
      editor.probeState = { red: probes.red, black: probes.black, pickedBoth: probes.both };
      editor.draw();
    }

    function selectPart(id) {
      part = id;
      const p = s.base.parts.find((q) => q.id === id);
      const names = { vsource: 'Battery', resistor: 'Resistor', led: 'LED', lamp: 'Lamp', switch: 'Switch', diode: 'Diode', ldr: 'LDR' };
      $('partinfo').innerHTML = `Selected <strong>${esc(id)}</strong> (${names[p.type]})`;
      ['inspect', 'replace', 'resolder'].forEach((k) => { $(k).disabled = finished; });
      drawMeterInfo();
    }

    editor = new EB.ui.Editor($('ed'), {
      circuit: c.circuit, editable: false, probe: true, tool: 'probe', blind: true, showVolts: false,
      solve: (parts) => s.solve(parts),
      onPick: ({ tool, part: pid, node }) => {
        if (finished) return;
        if (pid) {
          if (tool === 'probe' && mode !== 'A') { setNote('In this mode, click the dots (nodes). Switch to Amps to measure a part’s current.'); return; }
          selectPart(pid); clearReading();
          return;
        }
        if (node) {
          if (mode === 'A') { setNote('In Amps mode, click a part to put the meter in series with it.'); return; }
          if (!probes.red || probes.both) { probes.red = node; probes.black = 'gnd'; probes.both = false; }
          else { probes.black = node; probes.both = true; }
          clearReading(); syncProbeRings(); drawMeterInfo();
        }
      },
      onChange: () => { s.base = editor.getCircuit(); },
    });
    s.base = editor.getCircuit();
    drawMeterInfo();

    // ---- controls ----
    app.querySelector('.benchbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) {
        mode = b.dataset.mode; clearReading();
        app.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
        editor.tool = 'probe'; editor.refresh(); drawMeterInfo();
      }
    });
    $('pwr').onclick = () => {
      if (finished) return;
      s.setPower(!s.power);
      $('pwr').setAttribute('aria-pressed', String(s.power));
      $('pwr').textContent = 'Power: ' + (s.power ? 'ON' : 'OFF');
      clearReading(); editor.refresh(); drawMeterInfo();
      setNote(s.power ? 'Power on.' : 'Power off. Batteries disconnected. Safe to measure resistance.');
    };
    $('take').onclick = () => {
      if (finished) return;
      let r;
      if (mode === 'A') { if (!part) return setNote('Click a part first.'); r = s.probeA(part); }
      else {
        if (!probes.red) return setNote('Place the red probe first: click a dot.');
        const fn = { V: s.probeV, R: s.probeR, C: s.continuity }[mode];
        r = fn(probes.red, probes.black);
      }
      if (r.ok) { reading = r; $('lcd').textContent = r.text; $('lcd').classList.remove('idle'); setNote(''); }
      else { clearReading(); setNote(r.text); }
      refreshStats();
    };
    $('inspect').onclick = () => { if (finished || !part) return; const r = s.inspect(part); setNote(r.text); refreshStats(); };
    const repair = (kind) => {
      if (finished || !part) return;
      const r = s[kind](part);
      setNote(r.text);
      refreshStats(); editor.refresh();
      if (s.solved) finish(true);
    };
    $('replace').onclick = () => repair('replace');
    $('resolder').onclick = () => repair('resolder');
    $('hint').onclick = () => { const h = s.hint(); $('hintbox').hidden = false; $('hintbox').innerHTML = '<strong>Hint.</strong> ' + inline(h); refreshStats(); };
    $('giveup').onclick = () => { if (!finished && confirm('Reveal the fault and end this attempt?')) finish(false); };
    $('again').onclick = () => { const n = c.variants.length > 1 ? (vi + 1 + Math.floor(Math.random() * (c.variants.length - 1))) % c.variants.length : 0; const t = `#/case/${c.id}/${n}`; if (location.hash === t) route(); else location.hash = t; };

    // ---- review ----
    function finish(won) {
      finished = true;
      ['take', 'inspect', 'replace', 'resolder', 'hint', 'giveup', 'pwr'].forEach((k) => { $(k).disabled = true; });
      s.setPower(true); editor.refresh();
      const v = s.variant;
      let html;
      if (won) {
        store.setBest(c.id, s.score());
        html = `<div class="review"><h2>Fixed! <span class="stars" aria-hidden="true">${stars(s.score())}</span></h2>
          <p><strong>${s.rating()}</strong>: score ${s.score()} with ${s.probeCount()} measurement${s.probeCount() === 1 ? '' : 's'} (par ${c.par}).</p>
          ${s.notes().length ? `<ul>${s.notes().map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
      } else {
        html = `<div class="review gaveup"><h2>The fault was…</h2>`;
      }
      html += `<p>${esc(v.explanation)}</p>
        <h3>An efficient investigation</h3><ol>${v.expert.map((st) => `<li>${esc(stepText(st))}${st.note ? `<br><span class="why">${esc(st.note)}</span>` : ''}</li>`).join('')}</ol>
        <p><a class="btn small" href="#/case/${c.id}">Play again</a> <a class="btn small secondary" href="#/">All cases</a></p></div>`;
      $('review').innerHTML = html;
      $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
      refreshStats();
      void ledOk;
    }
    const stepText = (st) => ({
      V: `Measure voltage, red on ${st.a}, black on ${st.b === 'gnd' ? 'ground' : st.b}`, A: `Measure the current through ${st.part}`,
      R: `Power off, measure resistance ${st.a} to ${st.b === 'gnd' ? 'ground' : st.b}`, C: `Continuity ${st.a} to ${st.b}`,
      inspect: `Inspect ${st.part}`, off: 'Switch the power off', on: 'Switch the power on', replace: `Replace ${st.part}`, resolder: `Resolder ${st.part}`,
    }[st.do]);

    refreshStats();
    void format;
  }

  route();
})();
