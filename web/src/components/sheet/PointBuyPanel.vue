<template>
  <section v-for="t in tables" :key="t.prop._id" class="panel pointbuy" :class="{ attention: t.unsaved }" :aria-label="t.prop.name">
    <div class="head">
      <h3>{{ t.prop.name || 'Point buy' }}</h3>
      <span v-if="t.hasBudget" class="budget num" :class="{ over: t.left < 0, done: t.left === 0 }">
        {{ t.left < 0 ? `${-t.left} points over` : `${t.left} of ${t.total} points left` }}
      </span>
      <span v-else class="faint">Enter each score ({{ t.min ?? '–' }} to {{ t.max ?? '–' }})</span>
    </div>
    <p v-if="t.unsaved" class="hint">
      {{ t.hasBudget ? 'Spend your points with − and +.' : 'Type in the scores you rolled or were given.' }}
      Until you set them, your ability scores stay at 0.
    </p>

    <div class="rows">
      <div v-for="(row, i) in t.rows" :key="row._id || i" class="r">
        <span class="name">{{ row.name || row.variableName }}</span>
        <div class="ctl">
          <button class="icon small" :aria-label="`Lower ${row.name}`" :disabled="!ctx.canEdit.value || ctx.busy.value || (t.min !== undefined && row.value <= t.min)" @click="setRow(t, i, row.value - 1)">−</button>
          <input class="num" type="number" inputmode="numeric" :value="row.value" :min="t.min" :max="t.max" :disabled="!ctx.canEdit.value"
                 :aria-label="row.name" @change="setRow(t, i, Number(($event.target as HTMLInputElement).value))" />
          <button class="icon small" :aria-label="`Raise ${row.name}`" :disabled="!ctx.canEdit.value || ctx.busy.value || (t.max !== undefined && row.value >= t.max) || (t.hasBudget && t.left <= 0)" @click="setRow(t, i, row.value + 1)">+</button>
        </div>
        <span v-if="t.hasBudget" class="cost faint num" :title="'Points spent on this score'">{{ row.spent ?? 0 }} pt</span>
        <span class="mod faint num" :title="'Modifier from this base score alone'">{{ signed(Math.floor((row.value - 10) / 2)) }}</span>
      </div>
    </div>
    <p v-if="t.unsaved && ctx.canEdit.value" class="row save">
      <button class="primary small" :disabled="ctx.busy.value" @click="saveAll(t)">Use these scores</button>
      <span class="hint">or change any score above.</span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../lib/context';
import { signed } from '../../lib/dice';

/**
 * Editor for DiceCloud's point-buy tables (LoV's "Manual" and "Point Buy" base ability scores).
 * Each row defines a variable (e.g. unmodifiedStrength) from its stored value; the table is
 * saved whole, so rows the player hasn't touched get their shown (clamped) value too.
 */
const props = withDefaults(defineProps<{ onlyUnsaved?: boolean }>(), { onlyUnsaved: false });
const ctx = useCtx();

const tables = computed(() => ctx.sheet.ofType('pointBuy')
  .filter(p => !p.ignored && !ctx.sheet.ancestors(p).some(a => a.type === 'propertySlot' && a.ignored))
  .map(prop => {
    const rows = (prop.values || []) as any[];
    // The engine clamps the shown value to min/max, but the variable keeps the stored value:
    // when they differ the table hasn't been saved yet.
    const unsaved = rows.some((r, i) => {
      const v = r.variableName && ctx.variables.value[r.variableName];
      return v && v._id === `${prop._id}_row_${i}` && v.value !== r.value;
    });
    const total = prop.total?.value;
    return {
      prop, rows, unsaved, total,
      min: prop.min?.value as number | undefined, max: prop.max?.value as number | undefined,
      hasBudget: typeof total === 'number', left: (total ?? 0) - (prop.spent || 0),
    };
  })
  .filter(t => !props.onlyUnsaved || t.unsaved));

const clean = (r: any) => ({ _id: r._id, name: r.name, variableName: r.variableName, value: r.value });

function saveRows(t: any, rows: any[]) {
  return ctx.actions.setField(t.prop._id, ['values'], rows).catch(() => { /* toast shown */ });
}
function setRow(t: any, i: number, value: number) {
  if (!Number.isFinite(value)) return;
  let v = Math.round(value);
  if (t.min !== undefined) v = Math.max(t.min, v);
  if (t.max !== undefined) v = Math.min(t.max, v);
  saveRows(t, t.rows.map((r: any, j: number) => clean(j === i ? { ...r, value: v } : r)));
}
const saveAll = (t: any) => saveRows(t, t.rows.map(clean));
</script>

<style scoped>
.pointbuy { margin-bottom: 1rem; }
.pointbuy.attention { border-color: var(--accent); background: var(--accent-soft); }
.head { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; }
.head h3 { font-size: var(--step-1); }
.budget { font-weight: 700; }
.budget.done { color: var(--good); }
.budget.over { color: var(--bad); }
.hint { margin: .3rem 0 0; }
.rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: .4rem 2.5rem; margin-top: .6rem; }
.r { display: flex; align-items: center; gap: .6rem; }
.name { flex: 1; font-weight: 500; }
.ctl { display: flex; align-items: center; gap: .25rem; }
.ctl input { width: 3.6rem; text-align: center; font-weight: 700; padding: .25rem; }
.icon.small { width: 2rem; height: 2rem; padding: 0; font-size: 1.1rem; }
.cost { min-width: 2.6rem; text-align: right; font-size: var(--step--1); }
.mod { min-width: 2rem; text-align: right; font-size: var(--step--1); }
.save { margin-top: .6rem; gap: .6rem; align-items: center; }
</style>
