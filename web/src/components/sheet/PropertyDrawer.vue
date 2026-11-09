<template>
  <Transition name="drawer">
    <aside v-if="p" class="drawer" role="dialog" aria-modal="false" :aria-label="ctx.propTitle(p)" @keydown.esc="ctx.close()">
      <header class="dhead">
        <div class="crumbs faint">
          <button v-for="a in ancestors" :key="a._id" class="crumb" @click="ctx.open(a)">{{ ctx.propTitle(a) }}</button>
        </div>
        <div class="row">
          <h2>{{ ctx.propTitle(p) }}</h2>
          <span class="spacer" />
          <button ref="closeBtn" class="ghost icon" aria-label="Close" @click="ctx.close()">✕</button>
        </div>
        <p class="faint meta">{{ typeName(p.type) }}<template v-if="p.variableName"> · <code>{{ p.variableName }}</code></template><template v-if="p.inactive"> · inactive</template></p>
      </header>

      <div class="dbody stack">
        <dl v-if="facts.length" class="facts">
          <div v-for="f in facts" :key="f.label"><dt>{{ f.label }}</dt><dd class="num">{{ f.value }}</dd></div>
        </dl>

        <div v-if="p.type === 'spell' && canPrepare && ctx.canEdit.value" class="row">
          <span>{{ p.prepared ? 'Prepared' : 'Not prepared' }}</span>
          <button class="small" @click="ctx.actions.setField(p._id, ['prepared'], !p.prepared)">{{ p.prepared ? 'Unprepare' : 'Prepare' }}</button>
        </div>
        <div v-if="summaryText" class="prose" v-html="renderMarkdown(summaryText)" />
        <div v-if="descriptionText" class="prose" v-html="renderMarkdown(descriptionText)" />

        <section v-if="effects.length" class="sub">
          <h4>What changes this</h4>
          <ul class="plain">
            <li v-for="e in effects" :key="e._id">
              <button class="linkish" @click="ctx.open(e)">{{ ctx.propTitle(e) }}</button>
              <span class="faint"> {{ e.operation }} {{ e.amount?.value ?? '' }}</span>
            </li>
          </ul>
        </section>

        <section v-if="kids.length" class="sub">
          <h4>Contains</h4>
          <ul class="plain">
            <li v-for="k in kids" :key="k._id" :class="{ faint: k.inactive }">
              <button class="linkish" @click="ctx.open(k)">{{ ctx.propTitle(k) }}</button> <span class="faint">{{ typeName(k.type) }}</span>
            </li>
          </ul>
        </section>

        <details v-if="ctx.canEdit.value" class="edit" :open="editOpen" @toggle="editOpen = ($event.target as HTMLDetailsElement).open">
          <summary>Edit</summary>
          <form class="stack" @submit.prevent="save">
            <label class="field"><span>Name</span><input v-model="draft.name" maxlength="100" /></label>
            <label v-if="'summary' in draft" class="field"><span>Summary</span><textarea v-model="draft.summary" /></label>
            <label v-if="'description' in draft" class="field"><span>Description</span><textarea v-model="draft.description" /></label>
            <label v-for="c in calcFields" :key="c.key" class="field">
              <span>{{ c.label }} <span class="faint">= {{ c.value }}</span></span>
              <input v-model="draft.calcs[c.key]" class="mono" />
            </label>
            <p class="hint">Formulas use DiceCloud syntax, for example <code>dexterity.modifier + proficiencyBonus</code>.</p>
            <div class="row">
              <button class="primary small" type="submit" :disabled="!dirty || ctx.busy.value">Save changes</button>
              <span class="spacer" />
              <button class="danger small" type="button" @click="remove">Remove</button>
            </div>
          </form>
        </details>

        <details class="raw">
          <summary>Raw data</summary>
          <pre>{{ rawJson }}</pre>
        </details>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useCtx } from '../../lib/context';
import { renderMarkdown, fieldText } from '../../lib/markdown';
import { typeName } from '../../lib/sheet';
import { signed } from '../../lib/dice';

const ctx = useCtx();
const p = computed(() => ctx.selected.value);
const closeBtn = ref<HTMLButtonElement>();
const editOpen = ref(false);
const ancestors = computed(() => (p.value ? ctx.sheet.ancestors(p.value) : []));
const kids = computed(() => (p.value ? (ctx.sheet.children.value.get(p.value._id) || []) : []));
const summaryText = computed(() => fieldText(p.value?.summary));
const canPrepare = computed(() => !!p.value && p.value.level > 0 && !p.value.alwaysPrepared && ancestors.value.some(a => a.type === 'spellList' && a.maxPrepared));
const descriptionText = computed(() => fieldText(p.value?.description));
const effects = computed(() => {
  const ids: string[] = p.value?.effectIds || [];
  return ids.map(id => ctx.sheet.byId.value.get(id)).filter(Boolean) as any[];
});

const facts = computed(() => {
  const x = p.value; if (!x) return [];
  const f: { label: string, value: any }[] = [];
  const add = (label: string, value: any) => { if (value !== undefined && value !== null && value !== '') f.push({ label, value }); };
  if (x.type === 'attribute') { add('Value', x.value); if (x.total !== x.value) add('Max', x.total); if (x.attributeType === 'ability') add('Modifier', signed(x.modifier)); }
  if (x.type === 'skill') { add('Bonus', signed(x.value)); add('Proficiency', ({ 0: 'None', 0.5: 'Half', 1: 'Proficient', 2: 'Expertise' } as any)[x.proficiency]); }
  if (x.type === 'action' || x.type === 'spell') { add('To hit', typeof x.attackRoll?.value === 'number' ? signed(x.attackRoll.value) : undefined); add('Uses', x.uses?.value ? `${x.usesLeft}/${x.uses.value}` : undefined); }
  if (x.type === 'spell') { add('Level', x.level === 0 ? 'Cantrip' : x.level); add('Casting time', x.castingTime); add('Range', x.range); add('Duration', x.duration); add('School', x.school); }
  if (x.type === 'item') { add('Quantity', x.quantity); add('Weight', x.weight ? `${x.weight} lb` : undefined); add('Value', x.value ? `${x.value} gp` : undefined); }
  if (x.type === 'damage') { add('Amount', x.amount?.value); add('Type', x.damageType); }
  if (x.type === 'effect') { add('Does', x.operation); add('Amount', x.amount?.value); add('Affects', (x.stats || []).join(', ')); }
  if (x.type === 'class' || x.type === 'classLevel') add('Level', x.level);
  if (x.type === 'constant') add('Value', x.calculation);
  if (x.type === 'propertySlot') add('Filled', `${x.totalFilled ?? 0}${x.quantityExpected?.value ? '/' + x.quantityExpected.value : ''}`);
  if (x.type === 'savingThrow') { add('DC', x.dc?.value); add('Save', x.stat); }
  if (x.type === 'toggle') add('On', x.enabled ? 'Always' : x.disabled ? 'Never' : x.condition?.value ? 'Yes (condition)' : 'No (condition)');
  return f;
});

// Every calculation field on the property becomes editable
const calcFields = computed(() => {
  const x = p.value; if (!x) return [];
  return Object.entries(x).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && 'calculation' in v)
    .map(([key, v]: [string, any]) => ({ key, label: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()), value: typeof v.value === 'object' ? JSON.stringify(v.value) : v.value }));
});

const draft = reactive<any>({ name: '', calcs: {} });
function resetDraft() {
  const x = p.value; if (!x) return;
  for (const k of Object.keys(draft)) delete draft[k];
  draft.name = x.name || '';
  if (x.summary !== undefined || ['action', 'spell', 'feature', 'note', 'buff', 'item'].includes(x.type)) draft.summary = x.summary?.text ?? '';
  if (x.description !== undefined || ['feature', 'note', 'item', 'spell', 'action'].includes(x.type)) draft.description = x.description?.text ?? '';
  draft.calcs = Object.fromEntries(calcFields.value.map(c => [c.key, x[c.key]?.calculation ?? '']));
}
watch(() => p.value?._id, async id => { editOpen.value = false; resetDraft(); if (id) { await nextTick(); closeBtn.value?.focus(); } });
watch(() => p.value, () => { if (!editOpen.value) resetDraft(); });

const dirty = computed(() => {
  const x = p.value; if (!x) return false;
  if (draft.name !== (x.name || '')) return true;
  if ('summary' in draft && draft.summary !== (x.summary?.text ?? '')) return true;
  if ('description' in draft && draft.description !== (x.description?.text ?? '')) return true;
  return calcFields.value.some(c => draft.calcs[c.key] !== (x[c.key]?.calculation ?? ''));
});

async function save() {
  const x = p.value; if (!x) return;
  try {
    if (draft.name !== (x.name || '')) await ctx.actions.setField(x._id, ['name'], draft.name || null);
    if ('summary' in draft && draft.summary !== (x.summary?.text ?? '')) await ctx.actions.setField(x._id, ['summary', 'text'], draft.summary);
    if ('description' in draft && draft.description !== (x.description?.text ?? '')) await ctx.actions.setField(x._id, ['description', 'text'], draft.description);
    for (const c of calcFields.value) if (draft.calcs[c.key] !== (x[c.key]?.calculation ?? '')) await ctx.actions.setField(x._id, [c.key, 'calculation'], draft.calcs[c.key]);
    resetDraft();
  } catch { /* toast shown */ }
}

async function remove() {
  const x = p.value; if (!x) return;
  if (!confirm(`Remove ${ctx.propTitle(x)}${kids.value.length ? ' and everything inside it' : ''}? You can restore it from the Tree tab.`)) return;
  await ctx.actions.remove(x._id).then(() => ctx.close()).catch(() => {});
}

const rawJson = computed(() => JSON.stringify(p.value, (k, v) => (k === 'parseNode' || k === 'valueNode' || k === 'hash' ? undefined : v), 2));
</script>

<style scoped>
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 100vw); z-index: 50; background: var(--surface);
  border-left: 1px solid var(--line); box-shadow: var(--shadow); display: grid; grid-template-rows: auto 1fr;
}
.dhead { padding: 1rem 1.25rem .5rem; border-bottom: 1px solid var(--line); }
.crumbs { display: flex; flex-wrap: wrap; gap: .2rem .5rem; font-size: var(--step--1); }
.crumb { border: 0; background: none; padding: 0; color: var(--faint); font-weight: 400; }
.crumb:not(:last-child)::after { content: ' ›'; }
.crumb:hover { color: var(--accent); }
.meta { margin: .2rem 0 0; font-size: var(--step--1); }
.dbody { overflow: auto; padding: 1rem 1.25rem 2rem; --gap: 1rem; }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: .5rem; margin: 0; }
.facts div { background: var(--surface-2); border-radius: var(--r-sm); padding: .35rem .6rem; }
.facts dt { font-size: var(--step--1); color: var(--muted); }
.facts dd { margin: 0; font-weight: 700; }
.sub h4 { margin-bottom: .25rem; }
.plain { list-style: none; padding: 0; margin: 0; }
.linkish { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 400; text-align: left; }
.edit, .raw { border: 1px solid var(--line); border-radius: var(--r-sm); padding: .5rem .75rem; }
.edit summary, .raw summary { cursor: pointer; font-weight: 500; }
.edit form { margin-top: .75rem; --gap: .6rem; }
.mono, pre, code { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: .85em; }
pre { white-space: pre-wrap; word-break: break-all; max-height: 360px; overflow: auto; margin: .5rem 0 0; }
.drawer-enter-active, .drawer-leave-active { transition: transform .2s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
