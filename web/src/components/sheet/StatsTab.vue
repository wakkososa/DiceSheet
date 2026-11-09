<template>
  <div class="stats">
    <section class="abilities" aria-label="Ability scores">
      <button v-for="a in abilities" :key="a._id" class="ability" :title="`Roll ${a.name} check`" @click="ctx.roll(`${a.name} check`, a.modifier, { isCheck: true })" @contextmenu.prevent="ctx.open(a)">
        <span class="ab-name">{{ ABILITY_SHORT[a.variableName] || a.name }}</span>
        <span class="ab-mod num">{{ signed(a.modifier) }}</span>
        <span class="ab-score num">{{ a.value }}</span>
      </button>
    </section>

    <div class="cols">
      <div class="col">
        <section v-if="saves.length" class="panel">
          <div class="section-head"><h3>Saving throws</h3></div>
          <SkillRow v-for="s in saves" :key="s._id" :skill="s" kind="save" />
        </section>

        <section v-if="resources.length" class="panel">
          <div class="section-head"><h3>Resources</h3></div>
          <ResourceRow v-for="r in resources" :key="r._id" :prop="r" />
        </section>

        <section v-if="toggles.length || buffs.length" class="panel">
          <div class="section-head"><h3>Conditions and toggles</h3></div>
          <label v-for="t in toggles" :key="t._id" class="toggle-row">
            <input type="checkbox" :checked="!!t.enabled || (!t.disabled && t.condition?.value)" :disabled="!ctx.canEdit.value || (!t.enabled && !t.disabled)"
                   @change="ctx.actions.adjust(t._id, 'set', ($event.target as HTMLInputElement).checked ? 1 : 0)" />
            <span>{{ t.name }}</span>
          </label>
          <button v-for="b in buffs" :key="b._id" class="ghost buff" @click="ctx.open(b)">{{ b.name }}</button>
        </section>

        <section v-if="otherStats.length" class="panel">
          <div class="section-head"><h3>Other stats</h3></div>
          <dl class="kv">
            <template v-for="s in otherStats" :key="s._id">
              <dt><button class="linkish" @click="ctx.open(s)">{{ s.name }}</button></dt>
              <dd class="num">{{ s.value }}</dd>
            </template>
          </dl>
        </section>
      </div>

      <section class="panel col">
        <div class="section-head"><h3>Skills</h3></div>
        <SkillRow v-for="s in skills" :key="s._id" :skill="s" kind="skill" />
      </section>

      <div class="col">
        <section v-if="checks.length" class="panel">
          <div class="section-head"><h3>Checks</h3></div>
          <SkillRow v-for="s in checks" :key="s._id" :skill="s" kind="check" />
        </section>
        <section v-for="g in profGroups" :key="g.label" class="panel">
          <div class="section-head"><h3>{{ g.label }}</h3></div>
          <p class="tags">
            <button v-for="s in g.items" :key="s._id" class="ghost small tag" @click="ctx.open(s)">
              {{ s.name }}<span v-if="s.proficiency === 2" title="Expertise"> ★</span>
            </button>
          </p>
        </section>
        <section v-if="multipliers.length" class="panel">
          <div class="section-head"><h3>Resistances</h3></div>
          <ul class="plain">
            <li v-for="m in multipliers" :key="m._id">
              <strong>{{ m.value === 0 ? 'Immune' : m.value === 0.5 ? 'Resistant' : m.value === 2 ? 'Vulnerable' : `×${m.value}` }}</strong>:
              {{ (m.damageTypes || []).join(', ') }}
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../lib/context';
import { ABILITY_ORDER, ABILITY_SHORT } from '../../lib/sheet';
import { signed } from '../../lib/dice';
import SkillRow from './SkillRow.vue';
import ResourceRow from './ResourceRow.vue';

const ctx = useCtx();
const attrs = computed(() => ctx.sheet.ofType('attribute').filter(a => !a.overridden));
const abilities = computed(() => attrs.value.filter(a => a.attributeType === 'ability')
  .sort((a, b) => idx(a.variableName) - idx(b.variableName)));
const idx = (v: string) => { const i = ABILITY_ORDER.indexOf(v); return i < 0 ? 99 : i; };

const skillsOf = (t: string) => ctx.sheet.ofType('skill').filter(s => s.skillType === t && !s.overridden);
const saves = computed(() => skillsOf('save').sort((a, b) => idx(a.ability) - idx(b.ability)));
const skills = computed(() => skillsOf('skill').sort((a, b) => a.name.localeCompare(b.name)));
const checks = computed(() => skillsOf('check').filter(s => s.variableName !== 'initiative'));
const profGroups = computed(() => [
  { label: 'Languages', items: skillsOf('language') },
  { label: 'Tools', items: skillsOf('tool') },
  { label: 'Weapons', items: skillsOf('weapon') },
  { label: 'Armor', items: skillsOf('armor') },
].filter(g => g.items.length));

const resources = computed(() => attrs.value.filter(a => ['resource', 'hitDice'].includes(a.attributeType) && !(a.hide) && a.total !== 0));
const otherStats = computed(() => attrs.value.filter(a => a.attributeType === 'stat' && !['armor', 'speed'].includes(a.variableName) && !a.hide));
const toggles = computed(() => ctx.sheet.ofType('toggle').filter(t => t.showUI));
const buffs = computed(() => ctx.sheet.ofType('buff').filter(b => b.target === 'self' || !b.target).filter(b => ctx.sheet.ancestors(b).every(a => a.type !== 'action' && a.type !== 'spell')));
const multipliers = computed(() => ctx.sheet.ofType('damageMultiplier'));
</script>

<style scoped>
.abilities { display: grid; grid-template-columns: repeat(6, 1fr); gap: .6rem; margin-bottom: 1rem; }
.ability {
  display: grid; justify-items: center; gap: 0; padding: .6rem .3rem .5rem; background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--r);
}
.ability:hover { border-color: var(--accent); }
.ab-name { font-size: var(--step--1); color: var(--muted); font-weight: 700; letter-spacing: .04em; }
.ab-mod { font-family: var(--serif); font-size: var(--step-3); font-weight: 700; line-height: 1.1; }
.ab-score { font-size: var(--step--1); color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 0 .6em; }
.cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; align-items: start; }
.col { display: grid; gap: 1rem; }
section.col { display: block; }
.toggle-row { display: flex; gap: .5rem; align-items: center; padding: .15rem 0; }
.buff { display: block; padding: .2rem 0; color: var(--accent); }
.kv { display: grid; grid-template-columns: 1fr auto; gap: .2rem .75rem; margin: 0; }
.kv dd { margin: 0; font-weight: 700; }
.linkish { border: 0; background: none; padding: 0; color: inherit; font-weight: 400; text-align: left; }
.linkish:hover { color: var(--accent); }
.tags { display: flex; flex-wrap: wrap; gap: .3rem; margin: 0; }
.tag { background: var(--surface-2); }
.plain { margin: 0; padding-left: 1rem; }
@media (max-width: 1000px) { .cols { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) {
  .cols { grid-template-columns: 1fr; }
  .abilities { grid-template-columns: repeat(3, 1fr); }
}
</style>
