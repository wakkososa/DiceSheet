<template>
  <div class="features">
    <div class="row">
      <input v-model="q" type="search" placeholder="Find a feature" aria-label="Find a feature" class="search" />
      <span class="spacer" />
      <button class="small ghost" @click="expanded = expanded.size ? new Set() : new Set(features.map(f => f._id))">
        {{ expanded.size ? 'Collapse all' : 'Expand all' }}
      </button>
    </div>
    <p v-if="!groups.length" class="panel muted">No features yet.</p>
    <section v-for="g in groups" :key="g.name" class="panel">
      <div class="section-head"><h3>{{ g.name }}</h3><span class="faint">{{ g.items.length }}</span></div>
      <article v-for="f in g.items" :key="f._id" class="feature">
        <button class="fhead" :aria-expanded="expanded.has(f._id)" @click="toggle(f._id)">
          <span class="chev" aria-hidden="true">{{ expanded.has(f._id) ? '▾' : '▸' }}</span>
          <strong>{{ f.name }}</strong>
          <span class="spacer" />
          <span v-if="usesOf(f)" class="faint num">{{ usesOf(f) }}</span>
        </button>
        <div v-if="!expanded.has(f._id) && fieldText(f.summary)" class="prose summary" v-html="renderMarkdown(fieldText(f.summary))" />
        <div v-if="expanded.has(f._id)" class="prose body">
          <div v-html="renderMarkdown(fieldText(f.description) || fieldText(f.summary))" />
          <button class="small ghost more" @click="ctx.open(f)">Details</button>
        </div>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCtx } from '../../lib/context';
import { renderMarkdown, fieldText } from '../../lib/markdown';
import { isRulesNote } from '../../lib/sheet';

const ctx = useCtx();
const q = ref('');
const expanded = ref(new Set<string>());
const toggle = (id: string) => { const s = new Set(expanded.value); s.has(id) ? s.delete(id) : s.add(id); expanded.value = s; };
// Features, plus rules notes such as weapon masteries (only top-level ones, not notes inside a feature)
const features = computed(() => [
  ...ctx.sheet.ofType('feature'),
  ...ctx.sheet.ofType('note').filter(n => {
    const anc = ctx.sheet.ancestors(n);
    return isRulesNote(n, anc) && !anc.some(a => ['feature', 'action', 'spell', 'item', 'note'].includes(a.type));
  }),
].sort((a, b) => a.left - b.left).filter(f => !q.value || (f.name || '').toLowerCase().includes(q.value.toLowerCase())));
const usesOf = (f: any) => {
  const res = ctx.sheet.descendants(f).find(d => d.type === 'attribute' && d.attributeType === 'resource' && !d.inactive);
  return res ? `${res.value}/${res.total}` : '';
};
// Group features by where they came from: the nearest class, species/race or background folder
const groups = computed(() => {
  const m = new Map<string, any[]>();
  for (const f of features.value) {
    const anc = ctx.sheet.ancestors(f);
    const src = [...anc].reverse().find(a => a.type === 'class' || a.type === 'classLevel')
      || [...anc].reverse().find(a => a.type === 'propertySlot' || (a.type === 'folder' && a.name && !a.name.startsWith('#')));
    const name = src?.type === 'classLevel' ? (anc.find(a => a.type === 'class')?.name || src.name) : (src?.name || 'Other');
    if (!m.has(name)) m.set(name, []);
    m.get(name)!.push(f);
  }
  return [...m.entries()].map(([name, items]) => ({ name, items }));
});
</script>

<style scoped>
.features { display: grid; gap: 1rem; }
.search { max-width: 320px; }
.feature { padding: .35rem 0; border-bottom: 1px solid var(--line); }
.feature:last-child { border-bottom: 0; }
.fhead { border: 0; background: none; padding: .1rem 0; width: 100%; text-align: left; color: var(--ink); font-weight: 400; }
.fhead:hover strong { color: var(--accent); }
.chev { color: var(--faint); width: 1rem; }
.summary { color: var(--muted); font-size: var(--step--1); padding-left: 1.4rem; max-width: 80ch; }
.body { padding-left: 1.4rem; max-width: 80ch; }
.more { margin-top: .3rem; }
</style>
