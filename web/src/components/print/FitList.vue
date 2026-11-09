<template>
  <div ref="box" class="fit">
    <slot :items="items.slice(0, shown)" />
    <p v-if="shown < items.length" class="more">+{{ items.length - shown }} more {{ moreText }}</p>
  </div>
</template>

<script setup lang="ts" generic="T">
import { nextTick, onMounted, ref, watch } from 'vue';

/**
 * Shows as many items as fit in a fixed-size box on a printed page. Items that
 * don't fit are reported through `overflow` so the page can continue them later.
 */
const props = withDefaults(defineProps<{ items: T[], moreText?: string }>(), { moreText: 'on the last pages' });
const emit = defineEmits<{ overflow: [rest: T[]] }>();
const box = ref<HTMLElement>();
const shown = ref(props.items.length);
let run = 0;

async function fit() {
  const mine = ++run;
  shown.value = props.items.length;
  await nextTick();
  const el = box.value;
  if (!el) return;
  // Remove items from the end until the box no longer overflows (down, or sideways for multi-column boxes)
  while (shown.value > 0 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
    shown.value--;
    await nextTick();
    if (mine !== run) return;
  }
  emit('overflow', props.items.slice(shown.value));
}

onMounted(() => {
  fit();
  // Fonts change line heights; measure again once they're in
  document.fonts?.ready.then(() => fit());
});
watch(() => props.items, fit);
defineExpose({ fit });
</script>

<style scoped>
.fit { overflow: hidden; min-height: 0; }
.more { margin: .04in 0 0; font-style: italic; color: #555; font-size: 7pt; }
</style>
