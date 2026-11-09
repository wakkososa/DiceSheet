<template>
  <div class="journal">
    <div class="col">
      <section class="panel">
        <div class="section-head"><h3>Notes</h3></div>
        <article v-for="n in notes" :key="n._id" class="note">
          <button class="nname" @click="ctx.open(n)">{{ n.name || 'Note' }}</button>
          <div class="prose" v-html="renderMarkdown(fieldText(n.summary) || fieldText(n.description))" />
        </article>
        <p v-if="!notes.length" class="muted">No notes yet.</p>
        <form v-if="ctx.canEdit.value" class="stack add" @submit.prevent="addNote">
          <input v-model.trim="noteName" placeholder="New note title" maxlength="100" />
          <textarea v-model="noteText" placeholder="Write anything: backstory, NPCs, loot to split…" />
          <button class="primary small" :disabled="!noteName && !noteText">Add note</button>
        </form>
      </section>
    </div>

    <div class="col">
      <section class="panel">
        <div class="section-head"><h3>Experience</h3></div>
        <p class="num"><strong>{{ xp }}</strong> XP<template v-if="milestones"> · {{ milestones }} milestone levels</template></p>
        <ul class="plain">
          <li v-for="e in ctx.experiences.value" :key="e._id" class="row">
            <span>{{ e.name }}</span><span class="spacer" />
            <span class="faint num">{{ e.xp ? `${e.xp} XP` : '' }} {{ e.levels ? `${e.levels} level${e.levels === 1 ? '' : 's'}` : '' }}</span>
            <button v-if="ctx.canEdit.value" class="ghost small danger" :aria-label="`Remove ${e.name}`" @click="ctx.actions.removeExperience(e._id)">Remove</button>
          </li>
        </ul>
        <form v-if="ctx.canEdit.value" class="row add" @submit.prevent="addXp">
          <input v-model.trim="xpName" placeholder="What for?" maxlength="100" class="grow" />
          <input v-model.number="xpAmount" type="number" placeholder="XP" class="short" />
          <input v-model.number="xpLevels" type="number" placeholder="Levels" class="short" />
          <button class="small" :disabled="!xpAmount && !xpLevels">Add</button>
        </form>
      </section>

      <section class="panel">
        <div class="section-head"><h3>Roll log</h3><button class="ghost small" @click="loadLogs">Refresh</button></div>
        <ol class="log">
          <li v-for="l in logs" :key="l._id">
            <span class="faint when">{{ when(l.date) }}</span>
            <div v-for="(c, i) in l.content" :key="i"><strong>{{ c.name }}</strong> <span class="prose" v-html="renderMarkdown(c.value)" /></div>
          </li>
        </ol>
        <p v-if="!logs.length" class="muted">Rolls you make show up here.</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useCtx } from '../../lib/context';
import { api } from '../../api';
import { renderMarkdown, fieldText } from '../../lib/markdown';
import { isRulesNote } from '../../lib/sheet';

const ctx = useCtx();
// Rules notes (e.g. weapon mastery "Nick", species info) are listed under Features instead
const notes = computed(() => ctx.sheet.ofType('note').filter(n => !isRulesNote(n, ctx.sheet.ancestors(n))));
const xp = computed(() => ctx.creature.value?.denormalizedStats?.xp || 0);
const milestones = computed(() => ctx.creature.value?.denormalizedStats?.milestoneLevels || 0);
const noteName = ref(''), noteText = ref('');
const xpName = ref(''), xpAmount = ref<number | null>(null), xpLevels = ref<number | null>(null);
const logs = ref<any[]>([]);

async function loadLogs() { try { logs.value = (await api.get(`/api/characters/${ctx.id}/logs`)).logs; } catch { /* ignore */ } }
onMounted(loadLogs);

async function addNote() {
  await ctx.actions.insert({ property: { type: 'note', name: noteName.value || 'Note', summary: { text: noteText.value } } }, 'Note added');
  noteName.value = ''; noteText.value = '';
}
async function addXp() {
  await ctx.actions.addExperience({ name: xpName.value || 'Experience', xp: xpAmount.value || undefined, levels: xpLevels.value || undefined });
  xpName.value = ''; xpAmount.value = null; xpLevels.value = null;
}
const when = (d: string) => { try { return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
</script>

<style scoped>
.journal { display: grid; grid-template-columns: 3fr 2fr; gap: 1rem; align-items: start; }
.col { display: grid; gap: 1rem; }
.note { padding: .4rem 0; border-bottom: 1px solid var(--line); }
.nname { border: 0; background: none; padding: 0; font-family: var(--serif); font-weight: 700; font-size: var(--step-0); color: var(--ink); }
.nname:hover { color: var(--accent); }
.add { margin-top: .75rem; --gap: .5rem; }
.plain { list-style: none; padding: 0; margin: 0 0 .5rem; }
.grow { flex: 1; min-width: 8rem; }
.short { width: 5.5rem; }
.log { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; max-height: 480px; overflow: auto; }
.log li { border-bottom: 1px solid var(--line); padding-bottom: .4rem; }
.when { font-size: var(--step--1); display: block; }
.log .prose :deep(p) { display: inline; }
@media (max-width: 800px) { .journal { grid-template-columns: 1fr; } }
</style>
