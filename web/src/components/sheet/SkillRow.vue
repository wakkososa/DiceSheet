<template>
  <div class="skill">
    <span class="prof" :class="profClass" :title="profTitle" aria-hidden="true" />
    <button class="name" @click="ctx.open(skill)">{{ label }}</button>
    <span v-if="skill.advantage > 0" class="adv" title="Advantage">adv</span>
    <span v-else-if="skill.advantage < 0" class="adv dis" title="Disadvantage">dis</span>
    <span v-if="kind === 'skill' && skill.passiveBonus !== undefined" class="passive faint num" title="Passive score">{{ 10 + skill.value + (skill.passiveBonus || 0) }}</span>
    <button class="roll num" :title="`Roll ${label}`" @click="ctx.roll(kind === 'save' ? `${label} save` : label, skill.value, { isCheck: true, advantage: skill.advantage > 0 ? 1 : skill.advantage < 0 ? -1 : undefined })">
      {{ signed(skill.value) }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../lib/context';
import { signed } from '../../lib/dice';
import { ABILITY_SHORT } from '../../lib/sheet';

const props = defineProps<{ skill: any, kind: 'skill' | 'save' | 'check' }>();
const ctx = useCtx();
const label = computed(() => props.kind === 'save' ? (props.skill.name || '').replace(/ sav(e|ing throw)s?$/i, '') : props.skill.name);
const profClass = computed(() => ({ 0.49: 'half', 0.5: 'half', 1: 'full', 2: 'expert' } as any)[props.skill.proficiency] || '');
const profTitle = computed(() => ({ half: 'Half proficient', full: 'Proficient', expert: 'Expertise' } as any)[profClass.value] || 'Not proficient');
void ABILITY_SHORT;
</script>

<style scoped>
.skill { display: flex; align-items: center; gap: .5rem; padding: .12rem 0; }
.prof { width: .7rem; height: .7rem; border-radius: 50%; border: 1.5px solid var(--faint); flex: none; }
.prof.half { background: linear-gradient(90deg, var(--accent) 50%, transparent 50%); border-color: var(--accent); }
.prof.full { background: var(--accent); border-color: var(--accent); }
.prof.expert { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent); }
.name { border: 0; background: none; padding: 0; flex: 1; text-align: left; font-weight: 400; color: var(--ink); }
.name:hover { color: var(--accent); }
.adv { font-size: .75rem; color: var(--good); font-weight: 700; }
.adv.dis { color: var(--bad); }
.passive { font-size: var(--step--1); min-width: 1.6rem; text-align: right; }
.roll { min-width: 3.1rem; justify-content: center; font-weight: 700; padding: .15em .5em; }
.roll:hover { border-color: var(--accent); color: var(--accent); }
</style>
