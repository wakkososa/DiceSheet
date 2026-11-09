<template>
  <section v-if="groups.length && ctx.canEdit.value" class="setup panel" aria-label="Finish setting up">
    <div v-for="g in groups" :key="g.buff._id" class="group">
      <div class="head">
        <h3>{{ g.buff.name || 'Finish setting up' }}</h3>
        <span v-if="g.progress" class="faint">{{ g.progress }}</span>
      </div>
      <div v-if="g.note" class="prose note" v-html="renderMarkdown(g.note)" />
      <div class="buttons">
        <button v-for="a in g.actions" :key="a._id" class="primary small" :disabled="ctx.busy.value" @click="ctx.act({ kind: 'prop', propId: a._id }, a.name)">
          {{ a.name }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../lib/context';
import { renderMarkdown, fieldText } from '../../lib/markdown';

/**
 * Libraries often guide setup with a temporary buff that holds "event" actions,
 * e.g. LoV's "Assign Stats" buff with "Assign To Strength" and friends.
 * Surface those actions here so they can't be missed.
 */
const ctx = useCtx();
const groups = computed(() => {
  const out: { buff: any, actions: any[], note: string, progress: string }[] = [];
  for (const buff of ctx.sheet.ofType('buff')) {
    // Skip anything inside an optional slot (e.g. LoV's Tutorial)
    if (ctx.sheet.ancestors(buff).some(a => a.type === 'propertySlot' && a.ignored)) continue;
    const desc = ctx.sheet.descendants(buff);
    // Already-done steps are switched off by the library's own toggles (deactivatedByToggle)
    const actions = desc.filter(d => d.type === 'action' && d.actionType === 'event' && !d.inactive);
    if (!actions.length) continue;
    const note = desc.find(d => d.type === 'note');
    const counter = desc.find(d => d.type === 'attribute' && d.variableName && /index/i.test(d.variableName));
    out.push({
      buff, actions,
      note: note ? fieldText(note.summary) || fieldText(note.description) : '',
      progress: counter ? `Step ${counter.value} of ${counter.value - 1 + actions.length}` : '',
    });
  }
  return out;
});
</script>

<style scoped>
.setup { border-color: var(--accent); background: var(--accent-soft); margin-bottom: 1rem; }
.group + .group { margin-top: 1rem; }
.head { display: flex; align-items: baseline; gap: .75rem; }
.head h3 { font-size: var(--step-1); }
.note { color: var(--muted); font-size: var(--step--1); margin: .3rem 0 .6rem; max-width: 80ch; }
.buttons { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .5rem; }
</style>
