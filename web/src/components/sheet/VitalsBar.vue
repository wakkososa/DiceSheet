<template>
  <section class="vitals" aria-label="Vitals">
    <div v-if="hp" class="hp" :class="{ down: hp.value <= 0 }">
      <div class="hp-top">
        <span class="hp-label">{{ hp.name }}</span>
        <button class="hp-num num ghost" :title="'Set hit points'" :disabled="!ctx.canEdit.value" @click="setExact">
          <strong>{{ hp.value }}</strong><span class="faint"> / {{ hp.total }}</span>
          <span v-if="temp && temp.value > 0" class="temp-num"> +{{ temp.value }} temp</span>
        </button>
      </div>
      <div class="bar" role="meter" :aria-valuenow="hp.value" aria-valuemin="0" :aria-valuemax="hp.total" :aria-label="hp.name">
        <span class="fill" :style="{ width: pct(hp.value, hp.total) + '%' }" />
        <span v-if="temp && temp.value > 0" class="fill temp" :style="{ width: Math.min(100, pct(temp.value, hp.total)) + '%' }" />
      </div>
      <form v-if="ctx.canEdit.value" class="hp-input" @submit.prevent="apply('damage')">
        <label class="sr-only" for="hp-amount">Amount</label>
        <input id="hp-amount" v-model.number="amount" type="number" inputmode="numeric" min="0" placeholder="0" class="num" />
        <button type="submit" class="dmg" :disabled="!amount">Damage</button>
        <button type="button" class="heal" :disabled="!amount" @click="apply('heal')">Heal</button>
        <button v-if="temp" type="button" class="tmp" :disabled="!amount" title="Set temporary hit points" @click="apply('temp')">Temp</button>
      </form>
      <div v-if="ctx.canEdit.value" class="rests">
        <button class="small ghost" @click="restNow('shortRest')">Short rest</button>
        <button class="small ghost" @click="restNow('longRest')">Long rest</button>
      </div>
    </div>

    <dl class="chips">
      <div v-for="c in chips" :key="c.label" class="chip" :class="{ clickable: c.roll !== undefined }"
           :role="c.roll !== undefined ? 'button' : undefined" :tabindex="c.roll !== undefined ? 0 : undefined"
           @click="c.roll !== undefined && ctx.roll(c.label, c.roll, { isCheck: true })"
           @keydown.enter="c.roll !== undefined && ctx.roll(c.label, c.roll, { isCheck: true })">
        <dt>{{ c.label }}</dt>
        <dd class="num">{{ c.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCtx } from '../../lib/context';
import { signed } from '../../lib/dice';

const ctx = useCtx();
const amount = ref<number | null>(null);
const v = (name: string) => ctx.sheet.byVar.value.get(name);

const hp = computed(() => v('hitPoints') || ctx.sheet.ofType('attribute').find(p => p.attributeType === 'healthBar'));
const temp = computed(() => v('tempHP') || v('tempHitPoints') || ctx.sheet.ofType('attribute').find(p => p.attributeType === 'healthBar' && p !== hp.value && /temp/i.test(p.name || p.variableName)));

const chips = computed(() => {
  const out: { label: string, value: string | number, roll?: number }[] = [];
  const ac = v('armor') ?? v('armorClass');
  if (ac) out.push({ label: 'Armor class', value: ac.value });
  const init = v('initiative');
  if (init) out.push({ label: 'Initiative', value: signed(init.value), roll: init.value });
  const speed = v('speed');
  if (speed) out.push({ label: 'Speed', value: `${speed.value} ft` });
  const prof = v('proficiencyBonus');
  if (prof) out.push({ label: 'Proficiency', value: signed(prof.value) });
  const level = ctx.variables.value.level?.value;
  if (level) out.push({ label: 'Level', value: level });
  return out;
});

const pct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

async function apply(kind: 'damage' | 'heal' | 'temp') {
  const n = Math.abs(Math.trunc(amount.value || 0));
  if (!n || !hp.value) return;
  try {
    if (kind === 'temp' && temp.value) {
      // Temp HP don't stack: the new pool replaces the old one
      await ctx.actions.adjust(temp.value._id, 'setMax', n);
    } else if (kind === 'heal') {
      await ctx.actions.adjust(hp.value._id, 'increment', -n);
    } else {
      // Damage comes off temporary hit points first, as in the rules
      let left = n;
      if (temp.value && temp.value.value > 0) {
        const fromTemp = Math.min(temp.value.value, left);
        await ctx.actions.adjust(temp.value._id, 'increment', fromTemp);
        left -= fromTemp;
      }
      if (left) await ctx.actions.adjust(hp.value._id, 'increment', left);
    }
    amount.value = null;
  } catch { /* toast shown */ }
}

async function restNow(type: 'shortRest' | 'longRest') {
  if (type === 'longRest' && !confirm('Take a long rest? This restores everything that resets on a long rest.')) return;
  await ctx.actions.rest(type).catch(() => {});
}

async function setExact() {
  if (!hp.value) return;
  const s = prompt(`Set ${hp.value.name} to`, String(hp.value.value));
  if (s === null || s.trim() === '' || !Number.isFinite(+s)) return;
  await ctx.actions.adjust(hp.value._id, 'set', Math.trunc(+s)).catch(() => {});
}
</script>

<style scoped>
.vitals { display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 1rem 1.5rem; align-items: center; }
.hp { display: grid; gap: .35rem; }
.hp-top { display: flex; align-items: baseline; gap: .5rem; }
.hp-label { font-weight: 500; color: var(--muted); }
.hp-num { padding: 0; font-size: var(--step-2); font-family: var(--serif); margin-left: auto; border: 0; }
.hp-num:disabled { opacity: 1; cursor: default; }
.hp-num strong { color: var(--hp); }
.temp-num { color: var(--temp); font-size: var(--step-0); font-family: var(--sans); }
.down .hp-num strong { color: var(--bad); }
.bar { position: relative; height: 14px; border-radius: 7px; background: var(--hp-soft); overflow: hidden; }
.fill { position: absolute; inset: 0 auto 0 0; background: var(--hp); border-radius: 7px; transition: width .3s ease; }
.fill.temp { background: var(--temp); opacity: .85; height: 5px; top: auto; }
.hp-input { display: grid; grid-template-columns: 5.5rem 1fr 1fr auto; gap: .4rem; }
.hp-input input { text-align: center; font-size: var(--step-1); padding: .25em; }
.hp-input button { justify-content: center; font-weight: 700; }
.dmg { background: var(--hp); border-color: var(--hp); color: #fff; }
.heal { color: var(--good); border-color: color-mix(in srgb, var(--good) 45%, var(--line)); }
.tmp { color: var(--temp); }
.rests { display: flex; gap: .25rem; margin-top: -.15rem; }
.rests button { color: var(--muted); padding-left: .3rem; padding-right: .3rem; }
.rests button:hover { color: var(--ink); }
.chips { display: flex; flex-wrap: wrap; gap: .5rem; margin: 0; justify-content: flex-end; }
.chip { background: var(--surface-2); border-radius: var(--r); padding: .35rem .8rem; min-width: 5.5rem; text-align: center; }
.chip dt { font-size: var(--step--1); color: var(--muted); }
.chip dd { margin: 0; font-size: var(--step-2); font-family: var(--serif); font-weight: 700; line-height: 1.1; }
.chip.clickable { cursor: pointer; }
.chip.clickable:hover { background: var(--accent-soft); }
@media (max-width: 800px) {
  .vitals { grid-template-columns: 1fr; }
  .chips { justify-content: flex-start; }
  .chip { min-width: 0; flex: 1; padding: .3rem .4rem; }
  .chip dd { font-size: var(--step-1); }
}
</style>
