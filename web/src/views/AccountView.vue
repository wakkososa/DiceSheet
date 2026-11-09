<template>
  <main class="page stack narrow">
    <h1>Your account</h1>
    <section class="panel stack">
      <p>Logged in as <strong>{{ session.user?.username }}</strong>. You can have up to {{ session.user?.characterLimit }} characters.</p>
    </section>
    <form class="panel stack" @submit.prevent="change">
      <div class="section-head"><h3>Change password</h3></div>
      <label class="field"><span>Current password</span><input v-model="current" type="password" autocomplete="current-password" required /></label>
      <label class="field"><span>New password (8+ characters)</span><input v-model="next" type="password" autocomplete="new-password" minlength="8" required /></label>
      <label class="field"><span>Repeat new password</span><input v-model="next2" type="password" autocomplete="new-password" required /></label>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div><button class="primary">Change password</button></div>
      <p class="hint">Changing your password logs you out on every other device.</p>
    </form>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { session, toast } from '../session';

const current = ref(''), next = ref(''), next2 = ref(''), error = ref('');
async function change() {
  error.value = '';
  if (next.value !== next2.value) { error.value = 'The new passwords don’t match'; return; }
  try {
    await api.post('/api/account/password', { currentPassword: current.value, newPassword: next.value });
    current.value = next.value = next2.value = '';
    toast('Password changed');
  } catch (e: any) { error.value = e.message; }
}
</script>

<style scoped>
.narrow { max-width: 560px; }
</style>
