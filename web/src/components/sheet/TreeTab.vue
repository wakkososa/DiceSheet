<template>
  <div class="tree-tab">
    <div class="row">
      <input v-model="q" type="search" placeholder="Filter by name or type" aria-label="Filter" class="search" />
      <label class="row small-text"><input v-model="showInactive" type="checkbox" /> Show inactive</label>
      <span class="spacer" />
      <button v-if="ctx.canEdit.value" class="small primary" @click="showCustom = true">Add custom</button>
      <button class="small ghost" @click="loadRemoved">{{ removed === null ? 'Show removed' : 'Refresh removed' }}</button>
    </div>
    <section class="panel">
      <p class="hint">Everything on this character, as DiceCloud stores it. Click a row for details.</p>
      <ul class="tree" role="tree">
        <li v-for="row in rows" :key="row.p._id" role="treeitem" :aria-expanded="row.hasKids ? !collapsed.has(row.p._id) : undefined"
            :style="{ '--d': row.depth }" :class="{ inactive: row.p.inactive }">
          <button v-if="row.hasKids" class="twisty" :aria-label="collapsed.has(row.p._id) ? 'Expand' : 'Collapse'" @click="toggle(row.p._id)">{{ collapsed.has(row.p._id) ? '▸' : '▾' }}</button>
          <span v-else class="twisty" />
          <button class="node" @click="ctx.open(row.p)">
            <span class="tname">{{ ctx.propTitle(row.p) }}</span>
            <span class="ttype faint">{{ typeName(row.p.type) }}</span>
          </button>
        </li>
      </ul>
    </section>
    <section v-if="removed !== null" class="panel">
      <div class="section-head"><h3>Removed</h3></div>
      <p v-if="!removed.length" class="muted">Nothing has been removed.</p>
      <ul class="plain">
        <li v-for="r in removed" :key="r._id" class="row">
          <span>{{ ctx.propTitle(r) }}</span> <span class="faint">{{ typeName(r.type) }}</span>
          <span class="spacer" />
          <button v-if="ctx.canEdit.value" class="small" @click="restore(r)">Restore</button>
        </li>
      </ul>
    </section>
    <CustomizeDialog v-if="showCustom" @close="showCustom = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCtx } from '../../lib/context';
import { typeName } from '../../lib/sheet';
import { api } from '../../api';
import CustomizeDialog from './CustomizeDialog.vue';

const ctx = useCtx();
const showCustom = ref(false);
const q = ref(''), showInactive = ref(true);
const collapsed = ref(new Set<string>());
const removed = ref<any[] | null>(null);
const toggle = (id: string) => { const s = new Set(collapsed.value); s.has(id) ? s.delete(id) : s.add(id); collapsed.value = s; };

const rows = computed(() => {
  const out: { p: any, depth: number, hasKids: boolean }[] = [];
  const s = q.value.toLowerCase();
  const kids = ctx.sheet.children.value;
  const walk = (parent: string | undefined, depth: number) => {
    for (const p of kids.get(parent) || []) {
      if (!showInactive.value && p.inactive) continue;
      const hasKids = (kids.get(p._id) || []).length > 0;
      const match = !s || ctx.propTitle(p).toLowerCase().includes(s) || p.type.toLowerCase().includes(s);
      if (match) out.push({ p, depth: s ? 0 : depth, hasKids: !s && hasKids });
      if (s || !collapsed.value.has(p._id)) walk(p._id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
});

async function loadRemoved() {
  // Removed properties are kept in the export; read them from there
  try {
    const archive = await api.get(`/api/characters/${ctx.id}/export?version=3`);
    const all = archive.properties.filter((p: any) => p.removed);
    // Only list the top of each removed subtree
    removed.value = all.filter((p: any) => !all.some((o: any) => o._id === p.parentId && o.removedAt === p.removedAt))
      .sort((a: any, b: any) => String(b.removedAt).localeCompare(String(a.removedAt)));
  } catch (e) { ctx.toastError(e); }
}
async function restore(r: any) {
  await ctx.actions.restore(r._id).catch(() => {});
  loadRemoved();
}
</script>

<style scoped>
.tree-tab { display: grid; gap: 1rem; }
.search { max-width: 320px; }
.small-text { font-size: var(--step--1); }
.tree { list-style: none; margin: 0; padding: 0; }
.tree li { display: flex; align-items: center; padding-left: calc(var(--d) * 1.1rem); }
.tree li.inactive .tname { color: var(--faint); text-decoration: line-through; text-decoration-color: var(--line); }
.twisty { width: 1.4rem; flex: none; border: 0; background: none; padding: 0; color: var(--faint); justify-content: center; }
.node { border: 0; background: none; padding: .12rem .3rem; display: flex; gap: .5rem; align-items: baseline; text-align: left; font-weight: 400; color: var(--ink); border-radius: 4px; }
.node:hover { background: var(--surface-2); }
.ttype { font-size: var(--step--1); }
.plain { list-style: none; padding: 0; margin: 0; display: grid; gap: .3rem; }
</style>
