<template>
  <main class="sheet" :style="accentStyle">
    <p v-if="ctx.error.value" class="page error-text">{{ ctx.error.value }}</p>
    <template v-else-if="ctx.creature.value">
      <header class="sheet-head">
        <div class="page head-inner">
          <div class="identity">
            <img v-if="portrait" :src="portrait" alt="" class="portrait" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
            <div>
              <h1>{{ ctx.creature.value.name || 'Unnamed' }}</h1>
              <p class="muted">{{ subtitle }}</p>
            </div>
            <span class="spacer" />
            <span v-if="ctx.busy.value" class="saving muted">Saving…</span>
            <span v-if="!ctx.canEdit.value" class="pill">Read only</span>
            <RouterLink :to="`/character/${id}/print`" class="btn small ghost print-btn" title="A printable sheet for Letter paper; save it as a PDF from the print dialog">Print / PDF</RouterLink>
          </div>
          <VitalsBar />
          <p v-if="computeErrors.length" class="warn">
            DiceCloud reported {{ computeErrors.length }} calculation {{ computeErrors.length === 1 ? 'problem' : 'problems' }}:
            {{ computeErrors.map(e => e.details?.error || e.type).slice(0, 2).join('; ') }}
          </p>
        </div>
        <nav class="tabs page" aria-label="Sheet sections">
          <RouterLink v-for="t in tabs" :key="t.id" :to="`/character/${id}/${t.id}`" class="tab" :class="{ active: current === t.id }">
            {{ t.label }}<span v-if="t.badge" class="badge">{{ t.badge }}</span>
          </RouterLink>
        </nav>
      </header>

      <div class="page body">
        <PointBuyPanel v-if="current === 'build' || current === 'stats'" :only-unsaved="current === 'stats'" />
        <SetupActions v-if="current === 'stats' || current === 'build' || current === 'actions'" />
        <StatsTab v-if="current === 'stats'" />
        <ActionsTab v-else-if="current === 'actions'" />
        <SpellsTab v-else-if="current === 'spells'" />
        <InventoryTab v-else-if="current === 'inventory'" />
        <FeaturesTab v-else-if="current === 'features'" />
        <JournalTab v-else-if="current === 'journal'" />
        <BuildTab v-else-if="current === 'build'" />
        <TreeTab v-else-if="current === 'tree'" />
      </div>

      <PropertyDrawer />
      <SlotFillDialog />
      <ActionInputDialog />
    </template>
    <p v-else class="page muted">Loading character…</p>
  </main>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { createSheetContext } from '../lib/context';
import { slotAvailable, speciesName } from '../lib/sheet';
import VitalsBar from '../components/sheet/VitalsBar.vue';
import StatsTab from '../components/sheet/StatsTab.vue';
import ActionsTab from '../components/sheet/ActionsTab.vue';
import SpellsTab from '../components/sheet/SpellsTab.vue';
import InventoryTab from '../components/sheet/InventoryTab.vue';
import FeaturesTab from '../components/sheet/FeaturesTab.vue';
import JournalTab from '../components/sheet/JournalTab.vue';
import BuildTab from '../components/sheet/BuildTab.vue';
import TreeTab from '../components/sheet/TreeTab.vue';
import PropertyDrawer from '../components/sheet/PropertyDrawer.vue';
import SlotFillDialog from '../components/sheet/SlotFillDialog.vue';
import ActionInputDialog from '../components/sheet/ActionInputDialog.vue';
import SetupActions from '../components/sheet/SetupActions.vue';
import PointBuyPanel from '../components/sheet/PointBuyPanel.vue';

const props = defineProps<{ id: string, tab?: string }>();
const ctx = createSheetContext(props.id);
ctx.load();
watch(() => props.id, () => ctx.load());

const openSlots = computed(() => ctx.sheet.ofType('propertySlot').filter(s => slotAvailable(s) && !s.ignored && s.spaceLeft > 0 && (s.quantityExpected?.value ?? 0) > 0).length);
const hasSpells = computed(() => ctx.sheet.ofType('spell').length > 0 || ctx.sheet.ofType('spellList').length > 0);
const tabs = computed(() => [
  { id: 'stats', label: 'Stats' },
  { id: 'actions', label: 'Actions' },
  ...(hasSpells.value ? [{ id: 'spells', label: 'Spells' }] : []),
  { id: 'inventory', label: 'Inventory' },
  { id: 'features', label: 'Features' },
  { id: 'journal', label: 'Journal' },
  { id: 'build', label: 'Build', badge: openSlots.value || undefined },
  { id: 'tree', label: 'Tree' },
]);
const current = computed(() => props.tab && ['stats', 'actions', 'spells', 'inventory', 'features', 'journal', 'build', 'tree'].includes(props.tab) ? props.tab : 'stats');

const portrait = computed(() => ctx.creature.value?.avatarPicture || ctx.creature.value?.picture);
const computeErrors = computed<any[]>(() => (ctx.creature.value?.computeErrors || []).filter((e: any) => e.type !== 'info'));
const subtitle = computed(() => {
  const classes = ctx.sheet.ofType('class').map(c => `${c.name} ${c.level ?? ''}`.trim());
  const race = speciesName(ctx.sheet, ctx.variables.value);
  return [race, classes.join(' / '), ctx.creature.value?.alignment].filter(Boolean).join(', ') || 'Not built yet — open the Build tab to choose your options';
});
const accentStyle = computed(() => (ctx.creature.value?.color ? { '--accent': ctx.creature.value.color } : {}));
watch(() => ctx.creature.value?.name, n => { if (n) document.title = n; });
</script>

<style scoped>
.sheet-head { background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 10; }
.head-inner { padding-bottom: .75rem; display: grid; gap: .75rem; }
.identity { display: flex; align-items: center; gap: .9rem; }
.identity h1 { font-size: var(--step-3); }
.identity p { margin: 0; }
.portrait { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); }
.saving { font-size: var(--step--1); }
.print-btn { text-decoration: none; white-space: nowrap; }
.warn { color: var(--warn); font-size: var(--step--1); margin: 0; }
.tabs { display: flex; gap: .15rem; padding-top: 0; padding-bottom: 0; overflow-x: auto; scrollbar-width: none; }
.tab { padding: .55rem .85rem; text-decoration: none; color: var(--muted); font-weight: 500; border-bottom: 3px solid transparent; white-space: nowrap; }
.tab:hover { color: var(--ink); }
.tab.active { color: var(--ink); border-bottom-color: var(--accent); }
.badge { display: inline-block; margin-left: .35rem; min-width: 1.3em; padding: 0 .35em; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: .75rem; text-align: center; line-height: 1.4; }
.body { padding-top: 1.25rem; }

/* On phones the vitals stay on top and the tabs move to the bottom, within thumb reach */
@media (max-width: 640px) {
  .sheet-head { position: static; }
  .identity h1 { font-size: var(--step-2); }
  .portrait { width: 44px; height: 44px; }
  .tabs { position: fixed; bottom: 0; left: 0; right: 0; background: var(--surface); border-top: 1px solid var(--line); z-index: 20; padding-bottom: env(safe-area-inset-bottom); }
  .tab { flex: 1; text-align: center; padding: .75rem .6rem; border-bottom: 0; border-top: 3px solid transparent; }
  .tab.active { border-top-color: var(--accent); }
}
</style>
