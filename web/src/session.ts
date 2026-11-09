import { reactive } from 'vue';
import { api } from './api';

export type SessionUser = { id: string, username: string, isAdmin: boolean, characterLimit: number };

export const session = reactive({
  loaded: false,
  user: null as SessionUser | null,
  registrationOpen: false,
  needsSetup: false,
  siteName: 'DiceSheet',
});

export async function loadSession() {
  const s = await api.get('/api/session');
  session.user = s.user || null;
  session.registrationOpen = s.registrationOpen;
  session.needsSetup = s.needsSetup;
  session.siteName = s.siteName;
  session.loaded = true;
  document.title = s.siteName;
}

export async function logout() {
  await api.post('/api/logout');
  session.user = null;
}

// Toasts
/** One line of an action result: a roll ("To Hit 20", breakdown "1d20 [16] + 4"), a divider ("On hit") or a note. */
export type ToastRow =
  | { kind: 'roll', label: string, total: string, suffix?: string, breakdown?: string, nat?: 'crit' | 'fumble' }
  | { kind: 'divider', text: string }
  | { kind: 'note', text: string };

export const toasts = reactive<{ id: number, text: string, kind: 'info' | 'error' | 'roll', detail?: string, rows?: ToastRow[] }[]>([]);
let toastId = 0;
export function toast(text: string, kind: 'info' | 'error' | 'roll' = 'info', detail?: string, ms = 4000, rows?: ToastRow[]) {
  const id = ++toastId;
  toasts.push({ id, text, kind, detail, rows });
  if (toasts.length > 4) toasts.shift();
  setTimeout(() => { const i = toasts.findIndex(t => t.id === id); if (i >= 0) toasts.splice(i, 1); }, ms);
}
export function dismissToast(id: number) {
  const i = toasts.findIndex((t: any) => t.id === id); if (i >= 0) toasts.splice(i, 1);
}

export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), 'error', undefined, 6000);
}
