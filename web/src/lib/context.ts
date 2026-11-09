import { inject, provide, ref, shallowRef, computed, type InjectionKey } from 'vue';
import { api } from '../api';
import { toast, toastError, type ToastRow } from '../session';
import { useSheet, type Prop, propTitle } from './sheet';
import { roll as rollDice, signed } from './dice';

const plainText = (t: string) => t.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
/**
 * Turn DiceCloud's log entries into readable rows. Roll entries look like
 * "1d20 [16] + 4\n**20**" or "1d4 [1] + 2\n**3** piercing damage": the bold number is the
 * result, what follows it the damage type, and the first line the dice breakdown.
 */
export function logRows(title: string, log: any[] = []): ToastRow[] {
  const rows: ToastRow[] = [];
  for (const l of log) {
    const name = (l.name || '').trim();
    const value = String(l.value ?? '').trim();
    if (!value) { if (name && name !== title) rows.push({ kind: 'note', text: name }); continue; }
    const m = /^([\s\S]*?)\*\*\s*(-?[\d.]+)\s*\*\*([\s\S]*)$/.exec(value);
    if (m && name) {
      const breakdown = plainText(m[1]);
      const nat = /^1d20 \[20\]/.test(breakdown) ? 'crit' : /^1d20 \[1\]/.test(breakdown) ? 'fumble' : undefined;
      rows.push({ kind: 'roll', label: name, total: m[2], suffix: plainText(m[3]) || undefined, breakdown: breakdown && breakdown !== m[2] ? breakdown : undefined, nat });
      continue;
    }
    if (!name && /^\*\*[^*]+\*\*$/.test(value)) { rows.push({ kind: 'divider', text: plainText(value) }); continue; }
    // Short notes ("Range (150/600 ft.)", "Stat 1 set from 0 to 15"); long rules text stays on the sheet
    const text = plainText(name && name !== title ? `${name}: ${value}` : value);
    if (text.length <= 90) rows.push({ kind: 'note', text });
  }
  return rows.slice(0, 10);
}

export function createSheetContext(id: string) {
  const creature = shallowRef<any>(null);
  const properties = shallowRef<Prop[]>([]);
  const variables = shallowRef<Record<string, any>>({});
  const experiences = shallowRef<any[]>([]);
  const canEdit = ref(false);
  const busy = ref(false);
  const error = ref('');
  const selectedId = ref<string | null>(null);
  const slotDialog = ref<{ slotId: string } | null>(null);
  const sheet = useSheet(properties);

  function apply(view: any) {
    if (view.creature) creature.value = view.creature;
    if (view.properties) properties.value = view.properties;
    if (view.variables) variables.value = view.variables;
    if (view.experiences) experiences.value = view.experiences;
    if ('canEdit' in view) canEdit.value = view.canEdit;
  }

  async function load() {
    try { apply(await api.get(`/api/characters/${id}`)); error.value = ''; } catch (e: any) { error.value = e.message; }
  }

  /** Run a mutation that returns the updated character view. */
  async function mutate(fn: () => Promise<any>, success?: string) {
    busy.value = true;
    try {
      const view = await fn();
      apply(view);
      if (success) toast(success);
      return view;
    } catch (e) {
      toastError(e);
      throw e;
    } finally {
      busy.value = false;
    }
  }

  const base = `/api/characters/${id}`;
  const actions = {
    update: (input: any, msg?: string) => mutate(() => api.patch(base, input), msg),
    setField: (propId: string, path: (string | number)[], value: unknown) => mutate(() => api.patch(`${base}/properties/${propId}`, { path, value })),
    adjust: (propId: string, operation: 'set' | 'increment' | 'setMax', value: number) => mutate(() => api.post(`${base}/properties/${propId}/adjust`, { operation, value })),
    remove: (propId: string) => mutate(() => api.del(`${base}/properties/${propId}`), 'Removed'),
    restore: (propId: string) => mutate(() => api.post(`${base}/properties/${propId}/restore`), 'Restored'),
    move: (propId: string, parentId: string | null) => mutate(() => api.post(`${base}/properties/${propId}/move`, { parentId })),
    insert: (body: any, msg?: string) => mutate(() => api.post(`${base}/properties`, body), msg),
    fillSlot: (slotId: string, nodeIds: string[], ignoreRequirements = false) =>
      mutate(() => api.post(`${base}/slots/${slotId}/fill`, { nodeIds, ignoreRequirements }), 'Added to your character'),
    addExperience: (input: any) => mutate(() => api.post(`${base}/experiences`, input), 'Experience added'),
    removeExperience: (expId: string) => mutate(() => api.del(`${base}/experiences/${expId}`)),
    recompute: () => mutate(() => api.post(`${base}/recompute`), 'Recalculated'),
    rest: async (type: 'shortRest' | 'longRest') => {
      const view = await mutate(() => api.post(`${base}/rest`, { type }));
      showActionLog(type === 'longRest' ? 'Long rest taken' : 'Short rest taken', view.log);
    },
  };

  // ---- DiceCloud action engine -------------------------------------------
  // The server runs the action. If it needs the player's input it returns a
  // question; we show it, then call again with the answers (same dice seed).
  type InputRequest = { kind: 'choose', choices: any[], quantity: [number, number] } | { kind: 'advantage', suggested: 0 | 1 | -1 };
  const pendingInput = ref<{ title: string, request: InputRequest, resolve: (answer: any) => void, cancel: () => void } | null>(null);

  function ask(title: string, request: InputRequest) {
    return new Promise<any>((resolve, reject) => {
      pendingInput.value = {
        title, request,
        resolve: (a: any) => { pendingInput.value = null; resolve(a); },
        cancel: () => { pendingInput.value = null; reject(new Error('cancelled')); },
      };
    });
  }

  function showActionLog(title: string, log: any[] = []) {
    const rows = logRows(title, log);
    toast(title, 'roll', undefined, rows.length > 3 ? 12000 : 8000, rows);
  }

  type Task = { kind: 'prop', propId: string } | { kind: 'castSpell', propId: string, slotId?: string, ritual?: boolean, withoutSpellSlot?: boolean };
  /** Run an action/spell/buff through the engine, prompting for choices as needed. */
  async function act(task: Task, title: string) {
    busy.value = true;
    try {
      let r = await api.post(`${base}/actions`, { task });
      for (let i = 0; r.status === 'needsInput' && i < 30; i++) {
        busy.value = false;
        const answer = await ask(title, r.request);
        busy.value = true;
        r = await api.post(`${base}/actions`, { task, seed: r.seed, decisions: [...r.decisions, answer] });
      }
      apply(r);
      showActionLog(title, r.log);
      return r;
    } catch (e: any) {
      if (e?.message !== 'cancelled') toastError(e);
    } finally {
      busy.value = false;
    }
  }

  /** Roll dice, show the result and save it to the character log. */
  function roll(label: string, expr: string | number, opts: { advantage?: 1 | -1, isCheck?: boolean } = {}) {
    let expression = expr;
    if (opts.isCheck) expression = `1d20${signed(Number(expr)).replace('−', '-')}`;
    const r = rollDice(expression, { advantage: opts.advantage });
    const value = r.total === null ? `Roll ${r.detail}` : String(r.total);
    toast(`${label}: ${value}`, 'roll', r.total === null ? undefined : r.detail, 6000);
    if (canEdit.value) {
      api.post(`${base}/logs`, { content: [{ name: label, value: r.total === null ? r.detail : `${r.detail} = **${r.total}**` }] }).catch(() => {});
    }
    return r;
  }

  const selected = computed(() => (selectedId.value ? sheet.byId.value.get(selectedId.value) : undefined));
  const open = (p: Prop | string) => { selectedId.value = typeof p === 'string' ? p : p._id; };
  const close = () => { selectedId.value = null; };
  const openSlot = (slotId: string) => { slotDialog.value = { slotId }; };

  const ctx = {
    id, creature, properties, variables, experiences, canEdit, busy, error, sheet, actions,
    load, roll, selected, selectedId, open, close, slotDialog, openSlot, propTitle, toastError, act, pendingInput,
  };
  provide(KEY, ctx);
  return ctx;
}

export type SheetContext = ReturnType<typeof createSheetContext>;
const KEY: InjectionKey<SheetContext> = Symbol('sheet');
export function useCtx(): SheetContext {
  const c = inject(KEY);
  if (!c) throw new Error('Sheet context missing');
  return c;
}
