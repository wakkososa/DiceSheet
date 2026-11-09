<template>
  <dialog ref="dlg" class="fill" @close="onClose" @cancel.prevent="close">
    <div v-if="ctx.slotDialog.value" class="inner">
      <header class="head">
        <div>
          <h2>{{ isClass ? `Level up ${data?.slot.name || ''}` : `Choose ${data?.slot.name || ''}` }}</h2>
          <p class="hint">
            <template v-if="isClass">Next level{{ data?.slot.missingLevels?.length ? 's needed: ' + data.slot.missingLevels.join(', ') : ': ' + ((data?.slot.level ?? 0) + 1) }}</template>
            <template v-else-if="data?.slot.spaceLeft !== undefined">{{ data.slot.spaceLeft - picked }} of {{ data.slot.quantityExpected }} left to choose</template>
            <template v-else>Choose as many as you like</template>
          </p>
        </div>
        <button class="ghost icon" aria-label="Close" @click="close">✕</button>
      </header>

      <div class="controls">
        <input v-model="search" type="search" placeholder="Search by name" aria-label="Search" @input="debouncedLoad" />
        <label class="row small-text"><input v-model="showUnavailable" type="checkbox" /> Show unavailable ({{ unavailable.length }})</label>
      </div>

      <div class="body">
        <ul class="list" role="listbox" :aria-multiselectable="true">
          <li v-if="loading" class="muted pad">Loading options…</li>
          <li v-else-if="!visible.length" class="muted pad">
            {{ data?.total ? 'Nothing available right now. Turn on "Show unavailable" to see why.' : 'No library entries fit this slot. Check which libraries this character can use on the Build tab.' }}
          </li>
          <li v-for="n in visible" :key="n._id" class="opt" :class="{ selected: selected.has(n._id), blocked: !canPick(n) && !selected.has(n._id), focused: focusId === n._id }"
              role="option" :aria-selected="selected.has(n._id)" @click="focusId = n._id">
            <input type="checkbox" :checked="selected.has(n._id)" :disabled="!canPick(n) && !selected.has(n._id)" :aria-label="`Select ${title(n)}`" @click.stop @change="toggle(n)" />
            <div class="otext">
              <span class="oname">{{ title(n) }}<span v-if="n.level && isClass" class="faint"> level {{ n.level }}</span></span>
              <span class="faint lib">{{ n.libraryName }}</span>
              <span v-if="!n.requirementMet" class="reason">{{ n.requirementError || 'Requires: ' + (n.requirementNote || 'conditions not met') }}</span>
              <span v-else-if="n.alreadyAdded" class="reason">Already on your character</span>
              <span v-else-if="n.tooBig" class="reason">Takes {{ n.quantity }} choices, not enough left</span>
            </div>
          </li>
          <li v-if="data && data.total > data.results.length" class="hint pad">Showing {{ data.results.length }} of {{ data.total }}. Search to narrow it down.</li>
        </ul>
        <div class="preview">
          <template v-if="focused">
            <h3>{{ title(focused) }}</h3>
            <p class="faint small-text">{{ focused.libraryName }}</p>
            <div class="prose" v-html="renderMarkdown(text(focused))" />
            <p v-if="!text(focused)" class="muted">No description.</p>
          </template>
          <p v-else class="muted">Select an option to read about it.</p>
        </div>
      </div>

      <footer class="foot">
        <label v-if="selectedBlocked" class="row small-text"><input v-model="ignoreReq" type="checkbox" /> Add even though requirements aren’t met</label>
        <span class="spacer" />
        <button @click="close">Cancel</button>
        <button class="primary" :disabled="!selected.size || busy || (selectedBlocked && !ignoreReq)" @click="add">
          {{ isClass ? (selected.size > 1 ? `Add ${selected.size} levels` : 'Add level') : selected.size > 1 ? `Add ${selected.size}` : 'Add' }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useCtx } from '../../lib/context';
import { api } from '../../api';
import { renderMarkdown, fieldText } from '../../lib/markdown';

const ctx = useCtx();
const dlg = ref<HTMLDialogElement>();
const data = ref<any>(null);
const loading = ref(false), busy = ref(false), showUnavailable = ref(false), ignoreReq = ref(false);
const search = ref('');
const selected = ref(new Set<string>());
const focusId = ref<string | null>(null);

const isClass = computed(() => data.value?.slot.type === 'class');
const results = computed<any[]>(() => data.value?.results || []);
const available = (n: any) => n.requirementMet && !n.alreadyAdded;
const unavailable = computed(() => results.value.filter(n => !available(n)));
const visible = computed(() => (showUnavailable.value ? results.value : results.value.filter(n => available(n) || selected.value.has(n._id))));
const byId = computed(() => new Map(results.value.map(n => [n._id, n])));
const focused = computed(() => (focusId.value ? byId.value.get(focusId.value) : undefined));
const picked = computed(() => [...selected.value].reduce((s, id) => s + (byId.value.get(id)?.quantity ?? 1), 0));
const selectedBlocked = computed(() => [...selected.value].some(id => !byId.value.get(id)?.requirementMet));
const title = (n: any) => n.name || n.cache?.node?.name || 'Unnamed';
const text = (n: any) => fieldText(n.description) || fieldText(n.summary) || '';

const levelOf = (n: any) => n.level || n.cache?.node?.level || 0;
const selectedLevels = computed(() => new Set([...selected.value].map(id => levelOf(byId.value.get(id)))));

function canPick(n: any) {
  if (n.alreadyAdded) return false;
  if (!n.requirementMet && !showUnavailable.value) return false;
  // Class levels: one entry per level
  if (isClass.value) return !selectedLevels.value.has(levelOf(n));
  const space = data.value?.slot.spaceLeft;
  return space === undefined || picked.value + n.quantity <= space;
}
function toggle(n: any) {
  const s = new Set(selected.value);
  if (s.has(n._id)) {
    s.delete(n._id);
  } else if (canPick(n) || !n.requirementMet) {
    s.add(n._id);
    if (isClass.value) backfill(s, n);
  }
  selected.value = s;
  focusId.value = n._id;
}
/** Like DiceCloud's level-up dialog: picking level 12 also ticks one entry for each missing lower level. */
function backfill(s: Set<string>, picked: any) {
  const slot = data.value?.slot;
  const missing: number[] = slot?.missingLevels?.length ? slot.missingLevels : [];
  const from = (slot?.level ?? 0) + 1;
  const needed = new Set<number>(missing);
  for (let l = from; l < levelOf(picked); l++) needed.add(l);
  const have = new Set([...s].map(id => levelOf(byId.value.get(id))));
  for (const l of [...needed].sort((a, b) => a - b)) {
    if (have.has(l) || l >= levelOf(picked)) continue;
    const options = results.value.filter(o => levelOf(o) === l && available(o));
    const pick = options.find(o => o.root?.id === picked.root?.id) || options[0];
    if (pick) { s.add(pick._id); have.add(l); }
  }
}

async function load() {
  const slot = ctx.slotDialog.value;
  if (!slot) return;
  loading.value = true;
  try {
    const qs = new URLSearchParams({ limit: '300', ...(search.value && { search: search.value }) });
    data.value = await api.get(`/api/characters/${ctx.id}/slots/${slot.slotId}/fillers?${qs}`);
    if (!focusId.value) focusId.value = results.value.find(available)?._id || results.value[0]?._id || null;
    // Like DiceCloud: if exactly one option is available, preselect it
    const avail = results.value.filter(available);
    if (!search.value && avail.length === 1 && !selected.value.size) selected.value = new Set([avail[0]._id]);
  } catch (e) { ctx.toastError(e); } finally { loading.value = false; }
}
let timer: any;
const debouncedLoad = () => { clearTimeout(timer); timer = setTimeout(load, 250); };

watch(() => ctx.slotDialog.value, async v => {
  if (v) {
    data.value = null; search.value = ''; selected.value = new Set(); focusId.value = null; ignoreReq.value = false; showUnavailable.value = false;
    await nextTick();
    dlg.value?.showModal();
    load();
  }
});

function close() { dlg.value?.close(); }
function onClose() { ctx.slotDialog.value = null; }

async function add() {
  if (!ctx.slotDialog.value) return;
  busy.value = true;
  try {
    await ctx.actions.fillSlot(ctx.slotDialog.value.slotId, [...selected.value], ignoreReq.value);
    close();
  } catch { /* toast shown */ } finally { busy.value = false; }
}
</script>

<style scoped>
.fill { border: 1px solid var(--line); border-radius: var(--r); padding: 0; background: var(--surface); color: var(--ink); width: min(980px, calc(100vw - 1.5rem)); height: min(760px, calc(100vh - 2rem)); box-shadow: var(--shadow); }
.fill::backdrop { background: rgb(18 22 29 / 45%); }
.inner { display: grid; grid-template-rows: auto auto 1fr auto; height: 100%; }
.head { display: flex; align-items: flex-start; gap: 1rem; padding: 1rem 1.25rem .5rem; }
.head > div { flex: 1; }
.head p { margin: .2rem 0 0; }
.controls { display: flex; gap: 1rem; align-items: center; padding: 0 1.25rem .75rem; border-bottom: 1px solid var(--line); }
.controls input[type="search"] { max-width: 340px; }
.body { display: grid; grid-template-columns: minmax(260px, 2fr) 3fr; min-height: 0; }
.list { list-style: none; margin: 0; padding: .25rem 0; overflow: auto; border-right: 1px solid var(--line); }
.pad { padding: .75rem 1.25rem; }
.opt { display: flex; gap: .6rem; align-items: flex-start; padding: .45rem 1.25rem; cursor: pointer; border-left: 3px solid transparent; }
.opt:hover { background: var(--surface-2); }
.opt.focused { background: var(--accent-soft); border-left-color: var(--accent); }
.opt.blocked .oname { color: var(--faint); }
.opt input { margin-top: .3rem; }
.otext { display: grid; }
.oname { font-weight: 500; }
.lib { font-size: var(--step--1); }
.reason { font-size: var(--step--1); color: var(--warn); }
.preview { overflow: auto; padding: 1rem 1.25rem; }
.preview .prose { max-width: 70ch; }
.foot { display: flex; align-items: center; gap: .6rem; padding: .75rem 1.25rem; border-top: 1px solid var(--line); flex-wrap: wrap; }
.small-text { font-size: var(--step--1); }
@media (max-width: 700px) {
  .fill { width: 100vw; height: 100dvh; max-width: none; max-height: none; border-radius: 0; }
  .body { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
  .list { border-right: 0; }
  .preview { max-height: 35vh; border-top: 1px solid var(--line); }
}
</style>
