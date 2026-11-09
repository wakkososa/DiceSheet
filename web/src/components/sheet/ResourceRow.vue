<template>
  <div class="res">
    <button class="name" @click="ctx.open(prop)">
      {{ prop.name }}
      <span v-if="prop.reset" class="faint reset">{{ RESET_LABEL[prop.reset] || prop.reset }}</span>
    </button>
    <div class="ctrl">
      <button v-if="ctx.canEdit.value" class="icon small" :disabled="value <= 0 && !prop.ignoreLowerLimit" :aria-label="`Use one ${prop.name}`" @click="ctx.actions.adjust(prop._id, 'increment', 1)">−</button>
      <span class="num count"><strong>{{ value }}</strong><span class="faint">/{{ prop.total }}</span></span>
      <button v-if="ctx.canEdit.value" class="icon small" :disabled="value >= prop.total && !prop.ignoreUpperLimit" :aria-label="`Restore one ${prop.name}`" @click="ctx.actions.adjust(prop._id, 'increment', -1)">+</button>
    </div>
    <div v-if="prop.total > 0 && prop.total <= 12" class="pips" aria-hidden="true">
      <span v-for="i in prop.total" :key="i" class="pip" :class="{ on: i <= value }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../lib/context';
import { RESET_LABEL } from '../../lib/sheet';

const props = defineProps<{ prop: any }>();
const ctx = useCtx();
const value = computed(() => props.prop.value ?? 0);
</script>

<style scoped>
.res { display: grid; grid-template-columns: 1fr auto; gap: .1rem .5rem; padding: .3rem 0; border-bottom: 1px solid var(--line); }
.res:last-child { border-bottom: 0; }
.name { border: 0; background: none; padding: 0; text-align: left; font-weight: 500; color: var(--ink); display: block; }
.name:hover { color: var(--accent); }
.reset { font-weight: 400; font-size: var(--step--1); margin-left: .3rem; }
.ctrl { display: flex; align-items: center; gap: .3rem; }
.count { min-width: 3rem; text-align: center; }
.icon.small { width: 1.8em; height: 1.8em; padding: 0; }
.pips { grid-column: 1 / -1; display: flex; gap: 4px; }
.pip { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--accent); }
.pip.on { background: var(--accent); }
</style>
