<template>
  <main class="auth">
    <form class="panel card stack" @submit.prevent="submit">
      <h1>{{ title }}</h1>
      <p v-if="mode === 'setup'" class="muted">
        Create the admin account. The setup code is printed in the server log when it starts
        (<code>docker logs</code>).
      </p>
      <label v-if="mode === 'setup'" class="field">
        <span>Setup code</span>
        <input v-model.trim="setupToken" autocomplete="off" required />
      </label>
      <label class="field">
        <span>Username</span>
        <input v-model.trim="username" autocomplete="username" required minlength="3" maxlength="32" />
      </label>
      <label class="field">
        <span>Password</span>
        <input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required :minlength="mode === 'login' ? 1 : 8" />
      </label>
      <label v-if="mode !== 'login'" class="field">
        <span>Repeat password</span>
        <input v-model="password2" type="password" autocomplete="new-password" required />
      </label>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy">{{ action }}</button>
      <p v-if="mode === 'login' && session.registrationOpen" class="muted">
        New here? <RouterLink to="/register">Create an account</RouterLink>
      </p>
      <p v-if="mode === 'register'" class="muted">
        Already have an account? <RouterLink to="/login">Log in</RouterLink>
      </p>
      <p v-if="mode === 'register' && !session.registrationOpen" class="error-text">
        Registration is closed. Ask an admin for an account.
      </p>
    </form>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { session, loadSession } from '../session';

const props = defineProps<{ mode: 'login' | 'register' | 'setup' }>();
const router = useRouter();
const route = useRoute();
const username = ref(''), password = ref(''), password2 = ref(''), setupToken = ref('');
const error = ref(''), busy = ref(false);

const title = computed(() => ({ login: 'Log in', register: 'Create an account', setup: 'Set up ' + session.siteName })[props.mode]);
const action = computed(() => ({ login: 'Log in', register: 'Create account', setup: 'Create admin account' })[props.mode]);

async function submit() {
  error.value = '';
  if (props.mode !== 'login' && password.value !== password2.value) { error.value = 'The passwords don’t match'; return; }
  busy.value = true;
  try {
    const path = { login: '/api/login', register: '/api/register', setup: '/api/setup' }[props.mode];
    await api.post(path, { username: username.value, password: password.value, setupToken: setupToken.value });
    await loadSession();
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    router.replace(next);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.auth { min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
.card { width: min(400px, 100%); padding: 1.75rem; box-shadow: var(--shadow); --gap: .9rem; }
.card button[type="submit"] { width: 100%; justify-content: center; padding: .6em; }
code { font-size: .9em; }
</style>
