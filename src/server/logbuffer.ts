/**
 * Keeps the last log lines in memory for the Admin → Logs page, while still writing
 * everything to stdout/stderr as before (so `docker logs` is unchanged).
 */
import { format } from 'node:util';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogEntry = { seq: number, time: string, level: LogLevel, category: string, message: string };

const MAX = 2000;
const buffer: LogEntry[] = [];
let seq = 0;
let installed = false;

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function push(level: LogLevel, args: any[]) {
  let text = format(...args).replace(/\s+$/, '');
  if (!text) return;
  // Lines written as "HH:MM:SS [category] message" (or "[category] message") keep their category
  text = text.replace(/^\d{2}:\d{2}:\d{2} /, '');
  const m = /^\[([\w -]{1,30})\] ([\s\S]*)$/.exec(text);
  const entry: LogEntry = { seq: ++seq, time: new Date().toISOString(), level, category: m ? m[1] : 'server', message: m ? m[2] : text };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
}

/** Mirror console output into the buffer. Call once, at start-up. */
export function installLogCapture() {
  if (installed) return;
  installed = true;
  // Node announces on every start that node:sqlite is "experimental"; it's harmless and looked
  // like an error in the log. Keep every other process warning (as a warning).
  process.removeAllListeners('warning');
  process.on('warning', w => {
    if (w.name === 'ExperimentalWarning' && /sqlite/i.test(w.message)) return;
    console.warn(`[server] ${w.name}: ${w.message}`);
  });
  for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: any[]) => { original(...args); try { push(level, args); } catch { /* never break logging */ } };
  }
}

/** Write a categorised line, e.g. logEvent('auth', 'sign-in: wakko'). */
export function logEvent(category: string, message: string, level: LogLevel = 'info') {
  const line = `${stamp()} [${category}] ${message}`;
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
}

/** Entries after `after` (a seq number), oldest first. */
export function getLogs(after = 0, limit = 500): { entries: LogEntry[], last: number, oldest: number } {
  const entries = buffer.filter(e => e.seq > after);
  return { entries: entries.slice(-limit), last: seq, oldest: buffer[0]?.seq ?? 0 };
}
