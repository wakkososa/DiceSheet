import { createRouter, createWebHistory } from 'vue-router';
import { session } from './session';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/CharactersView.vue'), meta: { auth: true } },
    { path: '/login', component: () => import('./views/AuthView.vue'), props: { mode: 'login' } },
    { path: '/register', component: () => import('./views/AuthView.vue'), props: { mode: 'register' } },
    { path: '/setup', component: () => import('./views/AuthView.vue'), props: { mode: 'setup' } },
    { path: '/character/:id/print', component: () => import('./views/PrintView.vue'), meta: { auth: true }, props: true },
    { path: '/character/:id/:tab?', component: () => import('./views/SheetView.vue'), meta: { auth: true }, props: true },
    { path: '/admin/:section?', component: () => import('./views/AdminView.vue'), meta: { auth: true, admin: true }, props: true },
    { path: '/account', component: () => import('./views/AccountView.vue'), meta: { auth: true } },
    { path: '/:rest(.*)', redirect: '/' },
  ],
  scrollBehavior: (to, from, saved) => saved || (to.path.split('/')[2] === from.path.split('/')[2] && to.path.startsWith('/character') ? undefined : { top: 0 }),
});

router.beforeEach(to => {
  if (session.needsSetup && to.path !== '/setup') return '/setup';
  if (to.meta.auth && !session.user) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  if (to.meta.admin && !session.user?.isAdmin) return '/';
});
