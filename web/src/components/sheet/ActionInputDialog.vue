<template>
  <dialog ref="dlg" class="ask" @cancel.prevent="cancel">
    <form v-if="p" class="stack" @submit.prevent="submit">
      <h2>{{ p.title }}</h2>

      <template v-if="p.request.kind === 'advantage'">
        <p class="muted">Roll with advantage or disadvantage?</p>
        <div class="adv">
          <button v-for="o in advOptions" :key="o.v" type="button" :class="{ primary: o.v === p.request.suggested }" @click="p.resolve(o.v)">
            {{ o.label }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="muted">{{ chooseHint }}</p>
        <ul class="choices">
          <li v-for="c in p.request.choices" :key="c._id">
            <label class="choice" :class="{ on: picked.includes(c._id) }">
              <input :type="multi ? 'checkbox' : 'radio'" :value="c._id" :checked="picked.includes(c._id)" name="choice" @change="toggle(c._id)" />
              <span>
                <strong>{{ c.name || 'Option' }}</strong>
                <span v-if="c.summary" class="prose summary" v-html="renderMarkdown(c.summary)" />
              </span>
            </label>
          </li>
        </ul>
        <div class="row">
          <span class="spacer" />
          <button type="button" @click="cancel">Cancel</button>
          <button class="primary" :disabled="!valid">Continue</button>
        </div>
      </template>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useCtx } from '../../lib/context';
import { renderMarkdown } from '../../lib/markdown';

const ctx = useCtx();
const dlg = ref<HTMLDialogElement>();
const p = computed(() => ctx.pendingInput.value);
const picked = ref<string[]>([]);
const advOptions = [{ v: 1, label: 'Advantage' }, { v: 0, label: 'Normal' }, { v: -1, label: 'Disadvantage' }];

const range = computed<[number, number]>(() => (p.value?.request.kind === 'choose' ? p.value.request.quantity : [1, 1]));
const multi = computed(() => range.value[1] !== 1);
const valid = computed(() => picked.value.length >= range.value[0] && (range.value[1] === -1 || picked.value.length <= range.value[1]));
const chooseHint = computed(() => {
  const [min, max] = range.value;
  if (min === max) return min === 1 ? 'Choose one' : `Choose ${min}`;
  if (max === -1) return `Choose at least ${min}`;
  return `Choose ${min} to ${max}`;
});

function toggle(id: string) {
  if (!multi.value) { picked.value = [id]; return; }
  picked.value = picked.value.includes(id) ? picked.value.filter(x => x !== id) : [...picked.value, id];
}
function submit() { if (valid.value && p.value) p.value.resolve(picked.value); }
function cancel() { p.value?.cancel(); }

watch(p, async v => {
  if (v) {
    picked.value = [];
    await nextTick();
    if (!dlg.value?.open) dlg.value?.showModal();
  } else if (dlg.value?.open) {
    dlg.value.close();
  }
});
</script>

<style scoped>
.ask { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); color: var(--ink); width: min(520px, calc(100vw - 2rem)); padding: 1.25rem 1.5rem; box-shadow: var(--shadow); }
.ask::backdrop { background: rgb(18 22 29 / 45%); }
.ask form { --gap: .8rem; }
.adv { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; }
.adv button { justify-content: center; padding: .7em; }
.choices { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; max-height: 55vh; overflow: auto; }
.choice { display: flex; gap: .6rem; align-items: flex-start; padding: .55rem .7rem; border: 1px solid var(--line); border-radius: var(--r-sm); cursor: pointer; }
.choice.on { border-color: var(--accent); background: var(--accent-soft); }
.choice input { margin-top: .3rem; }
.summary { display: block; color: var(--muted); font-size: var(--step--1); }
</style>
