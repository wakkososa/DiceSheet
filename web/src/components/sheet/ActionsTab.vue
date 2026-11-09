<template>
  <div class="actions-tab">
    <div class="row filter">
      <input v-model="q" type="search" placeholder="Find an action" aria-label="Find an action" />
      <span class="hint">Click a bonus to roll it. Right-click to-hit to roll with advantage.</span>
    </div>
    <p v-if="!groups.length" class="panel muted">
      No actions yet. Actions come from your class, species, feats and equipped weapons — fill your slots on the Build tab.
    </p>
    <section v-for="g in groups" :key="g.type" class="panel group">
      <div class="section-head"><h3>{{ g.label }}</h3><span class="faint">{{ g.items.length }}</span></div>
      <ActionCard v-for="a in g.items" :key="a._id" :action="a" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCtx } from '../../lib/context';
import { ACTION_TYPE_LABEL, ACTION_TYPE_ORDER } from '../../lib/sheet';
import ActionCard from './ActionCard.vue';

const ctx = useCtx();
const q = ref('');
const groups = computed(() => {
  const s = q.value.toLowerCase();
  const list = ctx.sheet.ofType('action').filter(a => !s || (a.name || '').toLowerCase().includes(s));
  return ACTION_TYPE_ORDER.map(type => ({
    type, label: ACTION_TYPE_LABEL[type],
    items: list.filter(a => (a.actionType || 'action') === type),
  })).filter(g => g.items.length);
});
</script>

<style scoped>
.actions-tab { display: grid; gap: 1rem; }
.filter input { max-width: 320px; }
.group { padding-top: .75rem; }
</style>
