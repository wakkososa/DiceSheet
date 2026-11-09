const UNMISTAKABLE = '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';
import { randomInt } from 'node:crypto';
export const Random = {
  id(n = 17) { let s = ''; for (let i = 0; i < n; i++) s += UNMISTAKABLE[randomInt(UNMISTAKABLE.length)]; return s; },
  fraction() { return Math.random(); },
  choice(a) { return a[Math.floor(Math.random() * a.length)]; },
};
