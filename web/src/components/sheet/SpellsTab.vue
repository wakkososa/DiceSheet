<template>
  <div class="spells-tab">
    <section v-if="slots.length" class="panel">
      <div class="section-head"><h3>Spell slots</h3></div>
      <div class="slots">
        <div v-for="s in slots" :key="s._id" class="slot">
          <span class="lvl">{{ ordinal(s.spellSlotLevel?.value) }}</span>
          <span class="pips">
            <button v-for="i in s.total" :key="i" class="pip" :class="{ on: i <= s.value }" :disabled="!ctx.canEdit.value"
                    :aria-label="i <= s.value ? `Spend a ${ordinal(s.spellSlotLevel?.value)} level slot` : `Restore a slot`"
                    @click="ctx.actions.adjust(s._id, 'increment', i <= s.value ? 1 : -1)" />
          </span>
          <span class="faint num">{{ s.value }}/{{ s.total }}</span>
        </div>
      </div>
    </section>

    <div class="row filter">
      <input v-model="q" type="search" placeholder="Find a spell" aria-label="Find a spell" />
      <label class="row"><input v-model="preparedOnly" type="checkbox" /> Prepared only</label>
    </div>

    <section v-for="list in lists" :key="list.id" class="panel">
      <div class="section-head">
        <h3>{{ list.name }}</h3>
        <span v-if="list.prop" class="list-meta faint">
          <template v-if="list.prop.dc?.value !== undefined">Save DC {{ list.prop.dc.value }}</template>
          <template v-if="list.prop.attackRollBonus?.value !== undefined"> · Attack {{ signed(list.prop.attackRollBonus.value) }}</template>
          <template v-if="list.prop.maxPrepared?.value !== undefined"> · Prepared {{ list.preparedCount }}/{{ list.prop.maxPrepared.value }}</template>
        </span>
      </div>
      <div v-for="lv in list.levels" :key="lv.level" class="level">
        <h4 class="lv-head">{{ lv.level === 0 ? 'Cantrips' : `${ordinal(lv.level)} level` }}</h4>
        <div v-for="sp in lv.spells" :key="sp._id" class="spell" :class="{ unprepared: !isPrepared(sp) }">
          <button class="sname" @click="ctx.open(sp)">
            <span>{{ sp.name }}<span v-if="!isPrepared(sp)" class="np"> Not prepared</span></span>
            <span class="tags faint">{{ [sp.castingTime, sp.range, sp.concentration ? 'Concentration' : '', sp.ritual ? 'Ritual' : ''].filter(Boolean).join(' · ') }}</span>
          </button>
          <span class="spacer" />
          <button v-if="typeof sp.attackRoll?.value === 'number'" class="small num" @click="ctx.roll(`${sp.name} attack`, sp.attackRoll.value, { isCheck: true })">Hit {{ signed(sp.attackRoll.value) }}</button>
          <button v-for="d in damagesOf(sp)" :key="d._id" class="small num dmg" @click="ctx.roll(`${sp.name} ${d.damageType || ''}`, d.amount?.value)">{{ d.amount?.value }}</button>
          <button v-if="ctx.canEdit.value && isPrepared(sp)" class="small" :disabled="ctx.busy.value || (lv.level > 0 && !sp.castWithoutSpellSlots && !castable(lv.level) && !sp.ritual)" @click="cast(sp, lv.level)">Cast</button>
          <button v-else-if="ctx.canEdit.value && canPrepare(sp)" class="small ghost" @click="ctx.actions.setField(sp._id, ['prepared'], true)">Prepare</button>
        </div>
      </div>
      <p v-if="!list.levels.length" class="muted">No spells in this list yet.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCtx } from '../../lib/context';
import { signed } from '../../lib/dice';

const ctx = useCtx();
const q = ref(''), preparedOnly = ref(false);
const ordinal = (n?: number) => (n === undefined ? '?' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const slots = computed(() => ctx.sheet.ofType('attribute').filter(a => a.attributeType === 'spellSlot' && a.total > 0)
  .sort((a, b) => (a.spellSlotLevel?.value ?? 0) - (b.spellSlotLevel?.value ?? 0)));
const isPrepared = (sp: any) => sp.level === 0 || sp.prepared || sp.alwaysPrepared || !spellListOf(sp)?.maxPrepared;
const spellListOf = (sp: any) => ctx.sheet.ancestors(sp).reverse().find(a => a.type === 'spellList');

// Unprepared spells are switched off by the engine; keep them listed (greyed) so they don't vanish.
const visibleSpells = computed(() => ctx.sheet.sorted.value.filter(sp => sp.type === 'spell' && !sp.removed
  && (!sp.inactive || (sp.deactivatedBySelf && !sp.deactivatedByAncestor && !sp.deactivatedByToggle))));
const canPrepare = (sp: any) => sp.level > 0 && !sp.alwaysPrepared && !!spellListOf(sp)?.maxPrepared;

const lists = computed(() => {
  const s = q.value.toLowerCase();
  const spells = visibleSpells.value.filter(sp => (!s || sp.name?.toLowerCase().includes(s)) && (!preparedOnly.value || isPrepared(sp)));
  const groups = new Map<string, { id: string, name: string, prop?: any, spells: any[] }>();
  for (const l of ctx.sheet.ofType('spellList')) groups.set(l._id, { id: l._id, name: l.name, prop: l, spells: [] });
  for (const sp of spells) {
    const l = spellListOf(sp);
    const key = l?._id || 'other';
    if (!groups.has(key)) groups.set(key, { id: key, name: 'Other spells', spells: [] });
    groups.get(key)!.spells.push(sp);
  }
  return [...groups.values()].filter(g => g.spells.length || (g.prop && !s)).map(g => {
    const byLevel = new Map<number, any[]>();
    for (const sp of g.spells) { const lv = sp.level ?? 0; if (!byLevel.has(lv)) byLevel.set(lv, []); byLevel.get(lv)!.push(sp); }
    return {
      ...g,
      preparedCount: g.spells.filter(sp => sp.level > 0 && sp.prepared && !sp.alwaysPrepared).length,
      levels: [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, spells]) => ({ level, spells: spells.sort((a, b) => a.name.localeCompare(b.name)) })),
    };
  });
});

// Skip formulas that only make sense once a slot is chosen, e.g. "(slotLevel)d8" shows as "0d8 + 1"
const damagesOf = (sp: any) => ctx.sheet.descendants(sp).filter(d => d.type === 'damage' && !d.deactivatedByToggle && d.target !== 'self' && d.amount?.value && !/(^|[^\d])0d\d/.test(String(d.amount.value)) && !ctx.sheet.ancestors(d).some(a => a.type === 'branch' && a.left > sp.left && ['miss', 'successfulSave'].includes(a.branchType))).slice(0, 3);
const castable = (level: number) => slots.value.some(s => (s.spellSlotLevel?.value ?? 0) >= level && s.value > 0);

/** Cast through DiceCloud's action engine: spends the slot, rolls, applies effects. */
async function cast(sp: any, level: number) {
  if (level === 0 || sp.castWithoutSpellSlots) {
    return ctx.act({ kind: 'castSpell', propId: sp._id, withoutSpellSlot: true }, `Cast ${sp.name}`);
  }
  const options = slots.value.filter(s => (s.spellSlotLevel?.value ?? 0) >= level && s.value > 0);
  if (!options.length) {
    if (sp.ritual && confirm(`No spell slots left. Cast ${sp.name} as a ritual?`)) return ctx.act({ kind: 'castSpell', propId: sp._id, ritual: true }, `Cast ${sp.name} (ritual)`);
    return;
  }
  let slot = options[0];
  const levels = [...new Set(options.map(o => o.spellSlotLevel?.value))];
  if (levels.length > 1 || sp.ritual) {
    const choices = levels.map(String).concat(sp.ritual ? ['ritual'] : []);
    const pick = prompt(`Cast ${sp.name} with which slot level? (${choices.join(', ')})`, String(levels[0]));
    if (pick === null) return;
    if (pick.trim().toLowerCase() === 'ritual') return ctx.act({ kind: 'castSpell', propId: sp._id, ritual: true }, `Cast ${sp.name} (ritual)`);
    slot = options.find(o => String(o.spellSlotLevel?.value) === pick.trim()) || options[0];
  }
  return ctx.act({ kind: 'castSpell', propId: sp._id, slotId: slot._id }, `Cast ${sp.name}`);
}
</script>

<style scoped>
.spells-tab { display: grid; gap: 1rem; }
.slots { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; }
.slot { display: flex; align-items: center; gap: .5rem; }
.lvl { font-weight: 700; min-width: 2.2rem; }
.pips { display: inline-flex; gap: 4px; }
.pip { width: 16px; height: 16px; padding: 0; border-radius: 50%; border: 2px solid var(--accent); background: transparent; }
.pip.on { background: var(--accent); }
.filter input[type="search"] { max-width: 320px; }
.list-meta { font-size: var(--step--1); white-space: nowrap; }
.level + .level { margin-top: .6rem; }
.lv-head { font-size: var(--step--1); color: var(--muted); margin-bottom: .2rem; }
.spell { display: flex; align-items: center; gap: .5rem; padding: .25rem 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.spell:last-child { border-bottom: 0; }
.spell.unprepared .sname { color: var(--faint); }
.np { font-size: var(--step--1); font-weight: 400; color: var(--warn); margin-left: .4rem; }
.sname { border: 0; background: none; padding: 0; text-align: left; font-weight: 500; color: var(--ink); display: flex; flex-direction: column; align-items: flex-start; }
.sname:hover { color: var(--accent); }
.tags { font-size: var(--step--1); font-weight: 400; }
.dmg { background: var(--surface-2); border-color: transparent; }
</style>
