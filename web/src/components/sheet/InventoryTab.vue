<template>
  <div class="inv">
    <div class="row totals">
      <span>Carried weight <strong class="num">{{ fmt(variables.weightCarried?.value ?? carriedWeight) }}</strong> lb</span>
      <span>Value <strong class="num">{{ fmt(variables.valueTotal?.value ?? totalValue) }}</strong> gp</span>
      <span class="spacer" />
      <input v-model="q" type="search" placeholder="Find an item" aria-label="Find an item" class="search" />
    </div>
    <section v-for="g in groups" :key="g.id" class="panel">
      <div class="section-head">
        <h3>{{ g.name }}</h3>
        <span v-if="g.prop" class="faint num">{{ fmt(g.prop.contentsWeight) }} lb · {{ fmt(g.prop.contentsValue) }} gp</span>
      </div>
      <div v-for="it in g.items" :key="it._id" class="item">
        <button class="iname" @click="ctx.open(it)">
          {{ (it.quantity ?? 1) !== 1 && it.plural ? it.plural : it.name }}
          <span v-if="it.requiresAttunement" class="faint" :title="it.attuned ? 'Attuned' : 'Requires attunement'"> {{ it.attuned ? '◆ attuned' : '◇ attunement' }}</span>
        </button>
        <span class="spacer" />
        <span class="faint num w">{{ it.weight ? fmt(it.weight * (it.quantity ?? 1)) + ' lb' : '' }}</span>
        <template v-if="ctx.canEdit.value && ((it.quantity ?? 1) !== 1 || it.showIncrement)">
          <button class="icon small" :aria-label="`One fewer ${it.name}`" :disabled="!ctx.canEdit.value || !(it.quantity > 0)" @click="ctx.actions.adjust(it._id, 'increment', -1)">−</button>
          <span class="qty num">{{ it.quantity ?? 1 }}</span>
          <button class="icon small" :aria-label="`One more ${it.name}`" :disabled="!ctx.canEdit.value" @click="ctx.actions.adjust(it._id, 'increment', 1)">+</button>
        </template>
        <span v-else-if="(it.quantity ?? 1) !== 1" class="qty num">×{{ it.quantity }}</span>
        <label v-if="ctx.canEdit.value" class="equip" :title="it.equipped ? 'Equipped' : 'Not equipped'">
          <input type="checkbox" :checked="!!it.equipped" @change="ctx.actions.setField(it._id, ['equipped'], ($event.target as HTMLInputElement).checked)" />
          <span>Equipped</span>
        </label>
      </div>
      <p v-if="!g.items.length" class="muted">Empty</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCtx } from '../../lib/context';

const ctx = useCtx();
const q = ref('');
const variables = computed(() => ctx.variables.value);
const fmt = (n?: number) => (n === undefined || n === null ? '0' : Math.round(n * 100) / 100);
const items = computed(() => ctx.sheet.ofType('item').filter(i => !q.value || (i.name || '').toLowerCase().includes(q.value.toLowerCase())));
const carriedWeight = computed(() => items.value.reduce((s, i) => s + (i.weight || 0) * (i.quantity ?? 1), 0));
const totalValue = computed(() => items.value.reduce((s, i) => s + (i.value || 0) * (i.quantity ?? 1), 0));

const groups = computed(() => {
  const out: { id: string, name: string, prop?: any, items: any[] }[] = [];
  const equipped = items.value.filter(i => i.equipped);
  if (equipped.length) out.push({ id: 'equipped', name: 'Equipped', items: equipped });
  const containers = ctx.sheet.ofType('container');
  const inContainer = (i: any) => ctx.sheet.ancestors(i).reverse().find(a => a.type === 'container');
  for (const c of containers) out.push({ id: c._id, name: c.name, prop: c, items: items.value.filter(i => !i.equipped && inContainer(i)?._id === c._id) });
  const loose = items.value.filter(i => !i.equipped && !inContainer(i));
  if (loose.length) out.push({ id: 'carried', name: 'Carried', items: loose });
  return out.filter(g => g.items.length || g.prop);
});
</script>

<style scoped>
.inv { display: grid; gap: 1rem; }
.totals { gap: 1.25rem; }
.search { max-width: 260px; }
.item { display: flex; align-items: center; gap: .5rem; padding: .3rem 0; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.iname { border: 0; background: none; padding: 0; text-align: left; color: var(--ink); font-weight: 500; }
.iname:hover { color: var(--accent); }
.w { font-size: var(--step--1); min-width: 4rem; text-align: right; }
.qty { min-width: 2rem; text-align: center; font-weight: 700; }
.icon.small { width: 1.8em; height: 1.8em; padding: 0; }
.equip { display: flex; align-items: center; gap: .3rem; font-size: var(--step--1); color: var(--muted); }
@media (max-width: 640px) { .equip span, .w { display: none; } }
</style>
