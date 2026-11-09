/**
 * Small dice roller for computed DiceCloud expressions such as "d6 + 5",
 * "2d8 + 3", "1d20 + 9" or "(slotLevel - 1)d10". Anything it can't parse is
 * returned as text so the player can roll it by hand.
 */
export type RollResult = { total: number, detail: string } | { total: null, detail: string };

function rollDie(sides: number) {
  const buf = new Uint32Array(1);
  // rejection sampling for an unbiased result
  const limit = Math.floor(0x100000000 / sides) * sides;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return (buf[0] % sides) + 1;
}

export function roll(expr: string | number, opts: { advantage?: 1 | -1 } = {}): RollResult {
  if (typeof expr === 'number') expr = String(expr);
  const src = expr.replace(/\s+/g, '');
  if (!/^[0-9d+\-*()]+$/i.test(src) || src.length > 80) return { total: null, detail: expr };
  const parts: string[] = [];
  let total = 0;
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gy;
  let m: RegExpExecArray | null; let pos = 0;
  while (pos < src.length && (m = re.exec(src))) {
    pos = re.lastIndex;
    if (m[3]) {
      const sign = m[1] === '-' ? -1 : 1;
      const count = Math.min(m[2] ? +m[2] : 1, 100);
      const sides = +m[3];
      if (!sides) return { total: null, detail: expr };
      let rolls = Array.from({ length: count }, () => rollDie(sides));
      if (opts.advantage && count === 1 && sides === 20) {
        const other = rollDie(20);
        const keep = opts.advantage > 0 ? Math.max(rolls[0], other) : Math.min(rolls[0], other);
        parts.push(`${sign < 0 ? '−' : ''}d20 [${rolls[0]}, ${other}] → ${keep}`);
        rolls = [keep];
      } else {
        parts.push(`${sign < 0 ? '−' : parts.length ? '+' : ''}${count}d${sides} [${rolls.join(', ')}]`);
      }
      total += sign * rolls.reduce((a, b) => a + b, 0);
    } else if (m[5]) {
      const v = (m[4] === '-' ? -1 : 1) * +m[5];
      parts.push(`${v < 0 ? '−' : '+'}${Math.abs(v)}`);
      total += v;
    } else break;
  }
  if (pos !== src.length) return { total: null, detail: expr };
  return { total, detail: parts.join(' ') };
}

export const signed = (n: number | undefined | null) => (n === undefined || n === null || Number.isNaN(n) ? '—' : n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
