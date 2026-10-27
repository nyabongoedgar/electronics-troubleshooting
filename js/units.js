// Unit parsing and formatting: "4.7k", "4k7", "10 µF", "3.3V", "470 ohm" -> numbers.
(function () {
  const EB = (globalThis.EB = globalThis.EB || {});

  const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  const UNIT_ALIAS = { V: 'V', A: 'A', 'Ω': 'Ω', ohm: 'Ω', ohms: 'Ω', Ohm: 'Ω', Ohms: 'Ω', F: 'F', H: 'H', Hz: 'Hz', W: 'W', s: 's', J: 'J' };
  const UNIT_RE = '(V|A|Ω|[Oo]hms?|F|H|Hz|W|s|J)';
  const NUM_RE = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)';
  const RE_PLAIN = new RegExp('^' + NUM_RE + '\\s*([pnuµμmkKMG])?\\s*' + UNIT_RE + '?$');
  const RE_RKM = new RegExp('^(\\d+)([pnuµμmkKMGR])(\\d+)\\s*' + UNIT_RE + '?$');

  // -> { value (in base units), unit ('V' | null) } or null when unreadable
  function parse(input) {
    if (typeof input === 'number') return { value: input, unit: null };
    const s = String(input == null ? '' : input).trim();
    if (!s) return null;
    let m = RE_RKM.exec(s);
    if (m) {
      const mult = m[2] === 'R' ? 1 : PREFIX[m[2]];
      return { value: parseFloat(m[1] + '.' + m[3]) * mult, unit: m[4] ? UNIT_ALIAS[m[4]] : null };
    }
    m = RE_PLAIN.exec(s);
    if (!m) return null;
    const value = parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] : 1);
    return Number.isFinite(value) ? { value, unit: m[3] ? UNIT_ALIAS[m[3]] : null } : null;
  }

  const STEPS = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

  function format(value, unit = '', sig = 3) {
    if (!Number.isFinite(value)) return String(value) + (unit ? ' ' + unit : '');
    if (value === 0) return '0 ' + unit;
    const a = Math.abs(value);
    for (const [mult, p] of STEPS) {
      if (a >= mult * 0.9995 || p === 'p') return `${+(value / mult).toPrecision(sig)} ${p}${unit}`;
    }
  }

  const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  function e12Values(minDecade = 0, maxDecade = 6) {
    const out = [];
    for (let d = minDecade; d <= maxDecade; d++) for (const b of E12) out.push(Math.round(b * 10 ** d * 100) / 100);
    return out;
  }

  EB.units = { parse, format, e12Values };
})();
