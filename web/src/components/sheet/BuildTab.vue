<template>
  <div class="build">
    <div class="main">
      <section v-if="classes.length" class="panel">
        <div class="section-head"><h3>Classes</h3></div>
        <div v-for="c in classes" :key="c._id" class="class-row">
          <button class="cname" @click="ctx.open(c)"><strong>{{ c.name }}</strong> <span class="muted">level {{ c.level ?? 0 }}</span></button>
          <span v-if="c.missingLevels?.length" class="warn-text">Missing level {{ c.missingLevels.join(', ') }}</span>
          <span class="spacer" />
          <button v-if="ctx.canEdit.value" class="primary small" @click="ctx.openSlot(c._id)">Level up</button>
        </div>
        <p class="hint">Total level {{ ctx.variables.value.level?.value ?? 0 }}<template v-if="xpLevels"> · {{ xpLevels }} levels from experience</template></p>
      </section>

      <section class="panel">
        <div class="section-head">
          <h3>Custom changes</h3>
          <button v-if="ctx.canEdit.value" class="small primary" @click="showCustom = true">Add a custom change</button>
        </div>
        <p v-if="!customItems.length" class="hint">Add rulings and rewards from your game, like +5 max hit points for the rest of the campaign, a feat your GM granted, or a new language.</p>
        <ul v-else class="customs">
          <li v-for="c in customItems" :key="c._id" :class="{ off: c.inactive }">
            <button class="fname" @click="ctx.open(c)"><strong>{{ c.name || typeName(c.type) }}</strong> <span class="muted">{{ describe(c) }}</span></button>
            <span class="spacer" />
            <button v-if="ctx.canEdit.value" class="ghost small danger" @click="removeCustom(c)">Remove</button>
          </li>
        </ul>
      </section>

      <section class="panel">
        <div class="section-head">
          <h3>Choices</h3>
          <span v-if="open.length" class="pill attention">{{ open.length }} to make</span>
        </div>
        <p v-if="!slots.length" class="muted">Nothing to choose yet. Pick a ruleset to start.</p>
        <div v-for="s in orderedSlots" :key="s._id" class="slot" :class="{ open: isOpen(s) }" :style="{ '--depth': depth(s) }">
          <div class="slot-head">
            <div>
              <button class="sname" @click="ctx.open(s)">{{ s.name || 'Slot' }}</button>
              <span v-if="path(s)" class="faint path">in {{ path(s) }}</span>
            </div>
            <span class="spacer" />
            <span v-if="s.ignored && canStillFill(s)" class="pill">Optional</span>
            <span class="faint num">{{ s.totalFilled ?? 0 }}<template v-if="s.quantityExpected?.value">/{{ s.quantityExpected.value }}</template></span>
            <button v-if="ctx.canEdit.value && canStillFill(s)" class="small" :class="{ primary: isOpen(s) }" @click="ctx.openSlot(s._id)">
              {{ isOpen(s) ? 'Choose' : 'Add' }}
            </button>
            <button v-if="ctx.canEdit.value && canStillFill(s) && s.quantityExpected?.value" class="small ghost" :title="s.ignored ? 'Count this as a choice to make' : 'Leave this empty without it counting as a choice to make'"
                    @click="ctx.actions.setField(s._id, ['ignored'], s.ignored ? null : true)">
              {{ s.ignored ? 'Unskip' : 'Skip' }}
            </button>
          </div>
          <ul v-if="fillers(s).length" class="fillers">
            <li v-for="f in fillers(s)" :key="f._id">
              <button class="fname" @click="ctx.open(f)">{{ ctx.propTitle(f) }}</button>
              <button v-if="ctx.canEdit.value" class="ghost small danger" :aria-label="`Remove ${ctx.propTitle(f)}`" @click="removeFiller(f)">Remove</button>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <aside class="side">
      <section class="panel stack">
        <div class="section-head"><h3>Character</h3></div>
        <label class="field"><span>Name</span><input v-model.trim="details.name" maxlength="100" :disabled="!ctx.canEdit.value" /></label>
        <label class="field"><span>Alignment</span><input v-model.trim="details.alignment" maxlength="100" :disabled="!ctx.canEdit.value" /></label>
        <label class="field"><span>Gender</span><input v-model.trim="details.gender" maxlength="100" :disabled="!ctx.canEdit.value" /></label>
        <label class="field"><span>Portrait image URL</span><input v-model.trim="details.picture" type="url" maxlength="2000" :disabled="!ctx.canEdit.value" /></label>
        <label class="field row"><span>Sheet colour</span><input v-model="details.color" type="color" class="color" :disabled="!ctx.canEdit.value" /></label>
        <button v-if="ctx.canEdit.value" class="small" :disabled="!detailsChanged" @click="saveDetails">Save details</button>
      </section>

      <section class="panel stack">
        <div class="section-head"><h3>Libraries</h3></div>
        <p class="hint">Choices on this character only offer content from these libraries.</p>
        <label class="opt"><input v-model="libMode" type="radio" value="all" :disabled="!ctx.canEdit.value" /> Every library on this server</label>
        <label v-for="col in libs.collections" :key="col._id" class="opt">
          <input v-model="libMode" type="radio" :value="'col:' + col._id" :disabled="!ctx.canEdit.value" />
          <span>{{ col.name }} <span class="hint">({{ col.libraries.length }})</span></span>
        </label>
        <label class="opt"><input v-model="libMode" type="radio" value="custom" :disabled="!ctx.canEdit.value" /> Pick libraries</label>
        <div v-if="libMode === 'custom'" class="libpick">
          <label v-for="l in libs.libraries" :key="l._id" class="opt small-text">
            <input v-model="customLibs" type="checkbox" :value="l._id" :disabled="!ctx.canEdit.value" /> {{ l.name }}
          </label>
        </div>
        <button v-if="ctx.canEdit.value" class="small" :disabled="!libsChanged" @click="saveLibs">Save libraries</button>
      </section>

      <section class="panel stack">
        <div class="section-head"><h3>Files</h3></div>
        <a class="btn small" :href="`/api/characters/${ctx.id}/export?version=3`" download>Export character</a>
        <a class="btn small" :href="`/api/characters/${ctx.id}/export?version=2`" download>Export for DiceCloud.com</a>
        <button v-if="ctx.canEdit.value" class="small ghost" @click="ctx.actions.recompute()">Recalculate sheet</button>
      </section>
    </aside>
    <CustomizeDialog v-if="showCustom" @close="showCustom = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useCtx } from '../../lib/context';
import { api } from '../../api';
import { typeName, slotAvailable } from '../../lib/sheet';
import CustomizeDialog from './CustomizeDialog.vue';
import { signed } from '../../lib/dice';

const ctx = useCtx();
const showCustom = ref(false);
const customFolder = computed(() => ctx.sheet.sorted.value.find(p => p.type === 'folder' && p.tags?.includes('dicesheetCustom') && !p.removed));
const customItems = computed(() => (customFolder.value ? (ctx.sheet.children.value.get(customFolder.value._id) || []) : []));
function describe(c: any) {
  const stat = (v: string) => ctx.sheet.byVar.value.get(v)?.name || v;
  const amt = c.amount?.value ?? c.amount?.calculation;
  if (c.type === 'effect') {
    const what = (c.stats || []).map(stat).join(', ');
    return ({ add: `${typeof amt === 'number' ? signed(amt) : amt} ${what}`, set: `${what} set to ${amt}`, min: `${what} at least ${amt}`, max: `${what} at most ${amt}`, mul: `${what} ×${amt}`, advantage: `Advantage on ${what}`, disadvantage: `Disadvantage on ${what}` } as any)[c.operation] || what;
  }
  if (c.type === 'attribute') return `${c.value ?? '?'}/${c.total ?? '?'}${c.reset ? ', refills on ' + (c.reset === 'longRest' ? 'long rest' : 'short rest') : ''}`;
  if (c.type === 'proficiency') return `${({ 1: 'Proficient', 2: 'Expertise', 0.5: 'Half proficient' } as any)[c.value] || ''} in ${(c.stats || []).map(stat).join(', ')}`;
  if (c.type === 'skill') return typeName(c.skillType || 'skill');
  if (c.type === 'item') return `Item${c.quantity !== 1 ? ' ×' + c.quantity : ''}`;
  return typeName(c.type);
}
async function removeCustom(c: any) {
  if (!confirm(`Remove ${c.name || 'this change'}? You can restore it from the Tree tab.`)) return;
  await ctx.actions.remove(c._id).catch(() => {});
}
const classes = computed(() => ctx.sheet.ofType('class'));
const slots = computed(() => ctx.sheet.ofType('propertySlot').filter(slotAvailable));
// Slots marked "ignored" (e.g. LoV's Tutorial) are optional, as in DiceCloud
const isOpen = (s: any) => !s.ignored && (s.quantityExpected?.value ?? 0) > 0 && s.spaceLeft > 0;
const canStillFill = (s: any) => !(s.quantityExpected?.value) || s.spaceLeft > 0;
const open = computed(() => slots.value.filter(isOpen));
const orderedSlots = computed(() => [...slots.value].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.left - b.left));
const xpLevels = computed(() => ctx.creature.value?.denormalizedStats?.milestoneLevels || 0);
const depth = (s: any) => Math.min(ctx.sheet.ancestors(s).filter(a => a.type === 'propertySlot').length, 4);
const path = (s: any) => ctx.sheet.ancestors(s).filter(a => a.type !== 'folder' || !a.name?.startsWith('#')).map(a => ctx.propTitle(a)).slice(-2).join(' › ');
const fillers = (s: any) => (ctx.sheet.children.value.get(s._id) || []).filter(c => !c.removed);

async function removeFiller(f: any) {
  if (!confirm(`Remove ${ctx.propTitle(f)} and everything it added? You can restore it from the Tree tab.`)) return;
  await ctx.actions.remove(f._id).catch(() => {});
}

// Details
const details = reactive({ name: '', alignment: '', gender: '', picture: '', color: '#3b5bdb' });
const syncDetails = () => {
  const c = ctx.creature.value || {};
  Object.assign(details, { name: c.name || '', alignment: c.alignment || '', gender: c.gender || '', picture: c.picture || '', color: c.color || '#3b5bdb' });
};
watch(() => ctx.creature.value, syncDetails, { immediate: true });
const detailsChanged = computed(() => {
  const c = ctx.creature.value || {};
  return details.name !== (c.name || '') || details.alignment !== (c.alignment || '') || details.gender !== (c.gender || '')
    || details.picture !== (c.picture || '') || details.color !== (c.color || '#3b5bdb');
});
const saveDetails = () => ctx.actions.update({ ...details }, 'Saved').catch(() => {});

// Libraries
const libs = ref<{ libraries: any[], collections: any[] }>({ libraries: [], collections: [] });
onMounted(async () => { try { libs.value = await api.get('/api/libraries'); } catch (e) { ctx.toastError(e); } });
const currentMode = computed(() => {
  const c = ctx.creature.value || {};
  if (!c.allowedLibraries && !c.allowedLibraryCollections) return 'all';
  if (c.allowedLibraryCollections?.length === 1 && !c.allowedLibraries?.length) return 'col:' + c.allowedLibraryCollections[0];
  return 'custom';
});
const libMode = ref('all');
const customLibs = ref<string[]>([]);
const syncLibs = () => {
  libMode.value = currentMode.value;
  const c = ctx.creature.value || {};
  const fromCols = libs.value.collections.filter(col => c.allowedLibraryCollections?.includes(col._id)).flatMap(col => col.libraries);
  customLibs.value = [...new Set([...(c.allowedLibraries || []), ...fromCols])];
};
watch([() => ctx.creature.value, libs], syncLibs, { immediate: true });
const libsChanged = computed(() => libMode.value !== currentMode.value || (libMode.value === 'custom'));
async function saveLibs() {
  let body: any;
  if (libMode.value === 'all') body = { allowedLibraries: null, allowedLibraryCollections: null };
  else if (libMode.value.startsWith('col:')) body = { allowedLibraries: null, allowedLibraryCollections: [libMode.value.slice(4)] };
  else body = { allowedLibraries: customLibs.value, allowedLibraryCollections: null };
  await ctx.actions.update(body, 'Libraries saved').catch(() => {});
}
</script>

<style scoped>
.build { display: grid; grid-template-columns: 1fr 320px; gap: 1rem; align-items: start; }
.main, .side { display: grid; gap: 1rem; }
.side .stack { --gap: .6rem; }
.class-row { display: flex; align-items: center; gap: .6rem; padding: .35rem 0; flex-wrap: wrap; }
.cname { border: 0; background: none; padding: 0; color: var(--ink); font-weight: 400; }
.cname:hover strong { color: var(--accent); }
.warn-text { color: var(--warn); font-size: var(--step--1); }
.customs { list-style: none; padding: 0; margin: 0; }
.customs li { display: flex; align-items: center; gap: .4rem; padding: .3rem 0; border-bottom: 1px solid var(--line); }
.customs li:last-child { border-bottom: 0; }
.customs li.off .fname { opacity: .55; }
.attention { background: var(--accent); color: var(--accent-ink); }
.slot { padding: .5rem 0 .5rem calc(var(--depth) * 1rem); border-bottom: 1px solid var(--line); }
.slot:last-child { border-bottom: 0; }
.slot.open .sname { color: var(--accent); }
.slot-head { display: flex; align-items: center; gap: .6rem; }
.sname { border: 0; background: none; padding: 0; font-weight: 700; color: var(--ink); text-align: left; }
.path { font-size: var(--step--1); margin-left: .4rem; }
.fillers { list-style: none; margin: .25rem 0 0; padding: 0 0 0 .9rem; border-left: 2px solid var(--line); }
.fillers li { display: flex; align-items: center; gap: .3rem; }
.fname { border: 0; background: none; padding: .1rem 0; color: var(--muted); font-weight: 400; text-align: left; }
.fname:hover { color: var(--accent); }
.opt { display: flex; gap: .5rem; align-items: baseline; }
.libpick { max-height: 260px; overflow: auto; border: 1px solid var(--line); border-radius: var(--r-sm); padding: .4rem .6rem; display: grid; gap: .2rem; }
.small-text { font-size: var(--step--1); }
.color { width: 3rem; height: 2rem; padding: .1rem; }
.side .btn { justify-content: center; }
@media (max-width: 900px) { .build { grid-template-columns: 1fr; } }
</style>
