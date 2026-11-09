<template>
  <article class="action" :class="{ spent: outOfUses || action.insufficientResources }">
    <div class="line">
      <button class="title" @click="ctx.open(action)">
        <span class="name">{{ action.name }}</span>
        <span v-if="meta" class="meta faint">{{ meta }}</span>
      </button>
      <span class="spacer" />
      <button v-if="hasAttack" class="roll hit num" :title="`Roll to hit with ${action.name}`" @click="rollAttack(0)" @contextmenu.prevent="rollAttack(1)">
        <span class="lbl">Hit</span> {{ signed(attackBonus) }}
      </button>
      <button v-for="d in damages" :key="d._id" class="roll dmg num" :title="`Roll ${d.damageType || ''} damage`" @click="rollDamage(d)">
        {{ d.amount?.value ?? d.amount?.calculation }}<span class="dtype">{{ shortType(d.damageType) }}</span>
      </button>
      <button v-for="s in saves" :key="s._id" class="save-dc" @click="ctx.open(s)" :title="`${s.name}`">
        DC {{ s.dc?.value }} {{ abbrev(s.stat) }}
      </button>
      <button v-if="ctx.canEdit.value" class="use primary small" :disabled="ctx.busy.value || outOfUses || action.insufficientResources"
              :title="'Run this action: rolls, spends uses and resources, and applies its effects'" @click="use">
        {{ hasAttack ? 'Attack' : 'Use' }}
      </button>
    </div>
    <div v-if="summary" class="summary prose" v-html="renderMarkdown(summary)" />
    <div v-if="uses !== undefined || consumes.length || itemsUsed.length" class="foot">
      <span v-if="uses !== undefined" class="uses num">
        <span v-for="i in uses" :key="i" class="pip" :class="{ on: i <= usesLeft }" />
        <span class="faint">{{ usesLeft }}/{{ uses }} {{ action.reset ? '· ' + (RESET_LABEL[action.reset] || action.reset) : '' }}</span>
      </span>
      <span v-for="c in consumes" :key="c.key" class="consume faint">Uses {{ c.quantity }} {{ c.name }} ({{ c.available }} left)</span>
      <span v-for="it in itemsUsed" :key="it.index" class="consume" :class="{ missing: !it.item }">
        <template v-if="it.choices.length > 1 || (!it.item && it.choices.length)">
          Uses {{ it.quantity }}
          <select class="pick" :value="it.item?._id || ''" :disabled="!ctx.canEdit.value" :aria-label="`Item ${action.name} uses`" @change="pickItem(it.index, ($event.target as HTMLSelectElement).value)">
            <option v-if="!it.item" value="" disabled>choose {{ it.tag }}…</option>
            <option v-for="o in it.choices" :key="o._id" :value="o._id">{{ o.name }} ({{ o.quantity ?? 0 }})</option>
          </select>
        </template>
        <template v-else-if="it.item">Uses {{ it.quantity }} {{ it.item.name }} ({{ it.item.quantity ?? 0 }} left)</template>
        <template v-else>Needs a {{ it.tag }} item (none in your inventory)</template>
      </span>
      <span class="spacer" />

      <button v-if="ctx.canEdit.value && uses !== undefined && usesLeft < uses" class="small ghost" @click="ctx.actions.adjust(action._id, 'set', 0)">Reset</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../lib/context';
import { signed } from '../../lib/dice';
import { renderMarkdown, fieldText } from '../../lib/markdown';
import { RESET_LABEL } from '../../lib/sheet';

const props = defineProps<{ action: any }>();
const ctx = useCtx();

// Everything inside an action is "inactive" until the action is applied, so
// look at descendants regardless, skipping only what a toggle switched off.
const desc = computed(() => ctx.sheet.descendants(props.action).filter(d => !d.deactivatedByToggle && !d.deactivatedBySelf));
const branchOf = (d: any) => ctx.sheet.ancestors(d).reverse().find(a => a.type === 'branch' && a.left > props.action.left);
const damages = computed(() => desc.value.filter(d => {
  if (d.type !== 'damage' || d.target === 'self' || !d.amount) return false;
  // Damage worked out only while the action runs (e.g. from a roll inside it) reads 0 until then: don't show a fake 0
  if (d.amount.value === 0 && !/^\s*0\s*$/.test(String(d.amount.calculation ?? ''))) return false;
  const b = branchOf(d);
  // Show what happens on a hit or failed save; skip miss / successful-save branches
  return !b || !['miss', 'successfulSave'].includes(b.branchType);
}).slice(0, 4));
const saves = computed(() => desc.value.filter(d => d.type === 'savingThrow' && d.dc?.value !== undefined).slice(0, 2));
const attackBonus = computed(() => props.action.attackRoll?.value);
const hasAttack = computed(() => props.action.attackRoll && typeof attackBonus.value === 'number');
const summary = computed(() => fieldText(props.action.summary));
const uses = computed(() => (typeof props.action.uses?.value === 'number' && props.action.uses.value > 0 ? props.action.uses.value : undefined));
const usesLeft = computed(() => props.action.usesLeft ?? ((uses.value ?? 0) - (props.action.usesUsed || 0)));
const outOfUses = computed(() => uses.value !== undefined && usesLeft.value <= 0);
const meta = computed(() => [props.action.range, props.action.castingTime].filter(Boolean).join(', '));

const consumes = computed(() => (props.action.resources?.attributesConsumed || []).map((c: any) => {
  const attr = c.variableName && ctx.sheet.byVar.value.get(c.variableName);
  return { key: c._id || c.variableName, quantity: c.quantity?.value ?? 1, name: attr?.name || c.variableName, available: attr?.value ?? c.available ?? 0, attr };
}).filter((c: any) => c.quantity));

// Items the action uses up (thrown weapons, ammunition): DiceCloud stores the chosen item as itemsConsumed[].itemId
const itemsUsed = computed(() => (props.action.resources?.itemsConsumed || []).map((c: any, index: number) => {
  const items = ctx.sheet.ofType('item');
  return {
    index, tag: c.tag || 'matching', quantity: c.quantity?.value ?? 1,
    item: c.itemId ? items.find(i => i._id === c.itemId) : undefined,
    choices: c.tag ? items.filter(i => (i.tags || []).includes(c.tag)) : [],
  };
}).filter((c: any) => c.quantity));
const pickItem = (index: number, itemId: string) => ctx.actions.setField(props.action._id, ['resources', 'itemsConsumed', index, 'itemId'], itemId || null).catch(() => {});

const SHORT: Record<string, string> = { slashing: 'slash', piercing: 'pierce', bludgeoning: 'bludg', healing: 'heal' };
const shortType = (t?: string) => (t ? ' ' + (SHORT[t] || t) : '');
const abbrev = (s?: string) => (s ? s.slice(0, 3).toUpperCase() : '');

function rollAttack(adv: 0 | 1) {
  ctx.roll(`${props.action.name} to hit`, attackBonus.value, { isCheck: true, advantage: adv ? 1 : undefined });
}
function rollDamage(d: any) {
  const expr = d.amount?.value ?? d.amount?.calculation;
  ctx.roll(`${props.action.name} ${d.damageType || 'damage'}`, expr);
}
// Runs the action through DiceCloud's action engine (rolls, uses, resources, buffs, triggers)
const use = () => ctx.act({ kind: 'prop', propId: props.action._id }, props.action.name);
</script>

<style scoped>
.action { padding: .55rem .2rem; border-bottom: 1px solid var(--line); }
.action:last-child { border-bottom: 0; }
.action.spent .name { color: var(--faint); }
.line { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
.title { border: 0; background: none; padding: 0; text-align: left; display: flex; flex-direction: column; align-items: flex-start; gap: 0; min-width: 0; }
.name { font-weight: 700; font-size: var(--step-0); color: var(--ink); }
.title:hover .name { color: var(--accent); }
.meta { font-size: var(--step--1); font-weight: 400; }
.roll { font-weight: 700; padding: .25em .6em; }
.roll .lbl { font-weight: 400; color: var(--muted); font-size: var(--step--1); }
.roll.hit:hover { border-color: var(--accent); color: var(--accent); }
.roll.dmg { background: var(--surface-2); border-color: transparent; }
.roll.dmg:hover { border-color: var(--hp); }
.dtype { font-weight: 400; color: var(--muted); font-size: var(--step--1); }
.use { margin-left: .2rem; }
.save-dc { font-size: var(--step--1); padding: .25em .6em; background: var(--surface-2); border-color: transparent; }
.summary { color: var(--muted); font-size: var(--step--1); margin-top: .25rem; max-width: 75ch; }
.foot { display: flex; gap: .6rem; align-items: center; margin-top: .35rem; flex-wrap: wrap; font-size: var(--step--1); }
.uses { display: inline-flex; align-items: center; gap: 3px; }
.pip { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--accent); }
.pip.on { background: var(--accent); }
.uses .faint { margin-left: .3rem; }
.consume { display: inline-flex; align-items: center; gap: .3rem; color: var(--muted); }
.consume.missing { color: var(--warn); }
.pick { width: auto; padding: .1rem .3rem; font-size: var(--step--1); }
</style>
