<template>
  <dialog ref="dlg" class="custom" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <h2>Add a custom change</h2>
      <p class="muted">For rulings and rewards from your game. It’s saved on this character and exports with it.</p>

      <div class="kinds" role="radiogroup" aria-label="What to add">
        <label v-for="k in kinds" :key="k.id" class="kind" :class="{ on: kind === k.id }">
          <input v-model="kind" type="radio" :value="k.id" class="sr-only" />
          <strong>{{ k.label }}</strong>
          <span class="hint">{{ k.hint }}</span>
        </label>
      </div>

      <label class="field"><span>Name</span><input v-model.trim="f.name" maxlength="100" :placeholder="namePlaceholder" required /></label>

      <!-- Stat bonus -->
      <template v-if="kind === 'effect'">
        <div class="row nowrap">
          <label class="field grow"><span>Stat</span>
            <select v-model="f.stat" required>
              <option value="" disabled>Choose a stat</option>
              <optgroup v-for="g in statGroups" :key="g.label" :label="g.label">
                <option v-for="s in g.items" :key="s.variableName" :value="s.variableName">{{ s.name }}</option>
              </optgroup>
            </select>
          </label>
          <label class="field"><span>Change</span>
            <select v-model="f.operation">
              <option value="add">Add</option>
              <option value="set">Set to</option>
              <option value="min">At least</option>
              <option value="max">At most</option>
              <option value="mul">Multiply by</option>
              <option value="advantage">Advantage</option>
              <option value="disadvantage">Disadvantage</option>
            </select>
          </label>
          <label v-if="needsAmount" class="field short"><span>Amount</span><input v-model.trim="f.amount" required placeholder="5" /></label>
        </div>
        <p class="hint">Amount can be a number or a formula, e.g. <code>5</code>, <code>-1</code> or <code>proficiencyBonus</code>.</p>
      </template>

      <!-- Resource -->
      <template v-if="kind === 'resource'">
        <div class="row nowrap">
          <label class="field short"><span>Maximum</span><input v-model.trim="f.amount" required placeholder="3" /></label>
          <label class="field grow"><span>Refills on</span>
            <select v-model="f.reset">
              <option value="">Never (refill by hand)</option>
              <option value="shortRest">Short or long rest</option>
              <option value="longRest">Long rest</option>
            </select>
          </label>
        </div>
      </template>

      <!-- Proficiency -->
      <template v-if="kind === 'proficiency'">
        <div class="row nowrap">
          <label class="field grow"><span>Skill or save</span>
            <select v-model="f.stat" required>
              <option value="" disabled>Choose</option>
              <optgroup v-for="g in skillGroups" :key="g.label" :label="g.label">
                <option v-for="s in g.items" :key="s.variableName" :value="s.variableName">{{ s.name }}</option>
              </optgroup>
            </select>
          </label>
          <label class="field"><span>Level</span>
            <select v-model.number="f.prof">
              <option :value="1">Proficient</option>
              <option :value="2">Expertise</option>
              <option :value="0.5">Half proficient</option>
            </select>
          </label>
        </div>
      </template>

      <!-- Language / tool -->
      <template v-if="kind === 'language'">
        <label class="field"><span>Type</span>
          <select v-model="f.skillType"><option value="language">Language</option><option value="tool">Tool</option><option value="weapon">Weapon</option><option value="armor">Armor</option></select>
        </label>
      </template>

      <!-- Item -->
      <template v-if="kind === 'item'">
        <div class="row nowrap">
          <label class="field short"><span>Quantity</span><input v-model.number="f.quantity" type="number" min="0" /></label>
          <label class="field short"><span>Weight (lb)</span><input v-model.number="f.weight" type="number" min="0" step="any" /></label>
          <label class="field short"><span>Value (gp)</span><input v-model.number="f.value" type="number" min="0" step="any" /></label>
        </div>
        <label class="row"><input v-model="f.equipped" type="checkbox" /> Equipped</label>
      </template>

      <label v-if="['feature', 'note', 'item', 'resource', 'effect'].includes(kind)" class="field">
        <span>{{ kind === 'effect' ? 'Why (optional)' : 'Description' }}</span>
        <textarea v-model="f.text" :placeholder="kind === 'effect' ? 'Blessing from the Oak Druids, rest of the campaign' : ''" />
      </label>

      <p v-if="preview" class="preview">{{ preview }}</p>
      <div class="row">
        <span class="spacer" />
        <button type="button" @click="dlg?.close()">Cancel</button>
        <button class="primary" :disabled="busy">Add to character</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useCtx } from '../../lib/context';

const emit = defineEmits<{ close: [] }>();
const ctx = useCtx();
const dlg = ref<HTMLDialogElement>();
const busy = ref(false);
onMounted(() => dlg.value?.showModal());

const kinds = [
  { id: 'effect', label: 'Stat bonus', hint: '+5 max HP, +1 AC, advantage on Stealth…' },
  { id: 'feature', label: 'Feature', hint: 'A rule or ability, with text' },
  { id: 'resource', label: 'Resource', hint: 'Uses you count down, e.g. 3/day' },
  { id: 'proficiency', label: 'Proficiency', hint: 'In a skill or saving throw' },
  { id: 'language', label: 'Language or tool', hint: 'A new language, tool, weapon or armor' },
  { id: 'item', label: 'Item', hint: 'Loot or gear' },
  { id: 'note', label: 'Note', hint: 'Free text in the Journal' },
] as const;
const kind = ref<typeof kinds[number]['id']>('effect');
const f = reactive({ name: '', stat: '', operation: 'add', amount: '', reset: '', prof: 1, skillType: 'language', quantity: 1, weight: 0, value: 0, equipped: false, text: '' });
const needsAmount = computed(() => !['advantage', 'disadvantage'].includes(f.operation));
const namePlaceholder = computed(() => ({ effect: 'Blessing of the Oak', feature: 'Lucky Charm', resource: 'Fate Points', proficiency: 'Trained by the Guild', language: 'Thieves’ Cant', item: 'Ring of the Duke', note: 'Session 12' } as any)[kind.value]);

// Stats the player can target, from this character
const vars = computed(() => ctx.sheet.active.value.filter(p => p.variableName && (p.type === 'attribute' || p.type === 'skill') && !p.overridden));
const nameOf = (p: any) => p.name || p.variableName;
const statGroups = computed(() => {
  const a = vars.value.filter(p => p.type === 'attribute');
  const s = vars.value.filter(p => p.type === 'skill');
  const by = (pred: (p: any) => boolean, list: any[]) => list.filter(pred).sort((x, y) => nameOf(x).localeCompare(nameOf(y)));
  return [
    { label: 'Abilities', items: by(p => p.attributeType === 'ability', a) },
    { label: 'Hit points and defenses', items: by(p => ['healthBar', 'stat', 'modifier', 'hitDice'].includes(p.attributeType) && !p.hide, a) },
    { label: 'Skills and checks', items: by(p => ['skill', 'check'].includes(p.skillType), s) },
    { label: 'Saving throws', items: by(p => p.skillType === 'save', s) },
    { label: 'Resources', items: by(p => ['resource', 'spellSlot'].includes(p.attributeType), a) },
  ].filter(g => g.items.length).map(g => ({ ...g, items: g.items.map(p => ({ variableName: p.variableName, name: nameOf(p) })) }));
});
const skillGroups = computed(() => statGroups.value.filter(g => g.label === 'Skills and checks' || g.label === 'Saving throws'));
const statName = computed(() => vars.value.find(p => p.variableName === f.stat)?.name || f.stat);

const preview = computed(() => {
  if (kind.value !== 'effect' || !f.stat) return '';
  const amt = f.amount || '?';
  const op = ({ add: `${/^-/.test(amt) ? '' : '+'}${amt} to`, set: `Set ${statName.value} to ${amt}:`, min: `At least ${amt}:`, max: `At most ${amt}:`, mul: `×${amt}:`, advantage: 'Advantage on', disadvantage: 'Disadvantage on' } as any)[f.operation];
  return f.operation === 'set' || ['min', 'max', 'mul'].includes(f.operation) ? `${op} ${statName.value}` : `${op} ${statName.value}`;
});

const camel = (s: string) => s.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'custom';
const textField = () => (f.text ? { text: f.text } : undefined);

async function save() {
  let property: any;
  switch (kind.value) {
    case 'effect':
      property = { type: 'effect', name: f.name, operation: f.operation, stats: [f.stat], ...(needsAmount.value && { amount: { calculation: f.amount } }), ...(f.text && { text: f.text }) };
      break;
    case 'feature':
      property = { type: 'feature', name: f.name, ...(f.text && { summary: textField() }) };
      break;
    case 'resource':
      property = { type: 'attribute', attributeType: 'resource', name: f.name, variableName: camel(f.name), baseValue: { calculation: f.amount }, ...(f.reset && { reset: f.reset }), ...(f.text && { description: textField() }) };
      break;
    case 'proficiency':
      property = { type: 'proficiency', name: f.name, stats: [f.stat], value: f.prof };
      break;
    case 'language':
      property = { type: 'skill', skillType: f.skillType, name: f.name, variableName: camel(f.name), baseProficiency: 1 };
      break;
    case 'item':
      property = { type: 'item', name: f.name, quantity: f.quantity ?? 1, weight: f.weight || 0, value: f.value || 0, equipped: f.equipped, ...(f.text && { description: textField() }) };
      break;
    case 'note':
      property = { type: 'note', name: f.name, ...(f.text && { summary: textField() }) };
      break;
  }
  busy.value = true;
  try {
    await ctx.actions.insert({ property, parentId: 'custom' }, `Added ${f.name}`);
    dlg.value?.close();
  } catch { /* toast shown */ } finally { busy.value = false; }
}
</script>

<style scoped>
.custom { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); color: var(--ink); width: min(640px, calc(100vw - 1.5rem)); padding: 1.25rem 1.5rem; box-shadow: var(--shadow); }
.custom::backdrop { background: rgb(18 22 29 / 45%); }
.custom form { --gap: .8rem; }
.custom p { margin: 0; }
.kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: .4rem; }
.kind { display: grid; gap: .1rem; padding: .5rem .7rem; border: 1px solid var(--line); border-radius: var(--r-sm); cursor: pointer; }
.kind.on { border-color: var(--accent); background: var(--accent-soft); }
.kind:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.nowrap { flex-wrap: nowrap; align-items: flex-end; }
.grow { flex: 1; }
.short { width: 7.5rem; flex: none; }
.preview { font-family: var(--serif); font-size: var(--step-1); }
code { font-size: .85em; }
@media (max-width: 560px) { .nowrap { flex-wrap: wrap; } .short { width: auto; flex: 1; } }
</style>
