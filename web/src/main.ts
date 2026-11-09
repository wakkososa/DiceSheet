import { createApp } from 'vue';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya-sans/400-italic.css';
import '@fontsource/alegreya/500.css';
import '@fontsource/alegreya/700.css';
import './styles.css';
import App from './App.vue';
import { router } from './router';
import { loadSession } from './session';

loadSession().finally(() => {
  createApp(App).use(router).mount('#app');
});
