// 路由表与登录守卫：未登录只能访问登录页
import { createRouter, createWebHashHistory } from 'vue-router'
import { session } from './store/session.js'
import WorkspaceLayout from './layouts/WorkspaceLayout.vue'
import { isDesktop } from './services/desktop.js'

function page(path, name, loader) {
  return { path, name, component: loader }
}

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/login/LoginView.vue'), meta: { public: true } },
  { path: '/editor/:id?', name: 'editor', component: () => import('./views/content/EditorView.vue') },
  { path: '/template-editor/:id?', name: 'template-editor',
    component: () => import('./views/content/TemplateEditorView.vue') },
  {
    path: '/',
    component: WorkspaceLayout,
    redirect: '/bot',
    children: [
      page('home', 'home', () => import('./views/home/HomeView.vue')),
      page('bot', 'bot', () => import('./views/ops/BotView.vue')),
      { path: 'assistant', redirect: '/bot' },
      page('tasks', 'tasks', () => import('./views/ops/TasksView.vue')),
      page('drafts', 'drafts', () => import('./views/content/DraftsView.vue')),
      page('templates', 'templates', () => import('./views/content/TemplatesView.vue')),
      page('materials', 'materials', () => import('./views/content/MaterialsView.vue')),
      page('published', 'published', () => import('./views/content/PublishedView.vue')),
      page('comments', 'comments', () => import('./views/interaction/CommentsView.vue')),
      page('messages', 'messages', () => import('./views/interaction/MessagesView.vue')),
      page('auto-reply', 'auto-reply', () => import('./views/interaction/AutoReplyView.vue')),
      page('menu', 'menu', () => import('./views/interaction/MenuView.vue')),
      page('users', 'users', () => import('./views/interaction/UsersView.vue')),
      page('data', 'data', () => import('./views/data/DataView.vue')),
      page('account', 'account', () => import('./views/settings/AccountSettingsView.vue')),
      page('members', 'members', () => import('./views/settings/MembersView.vue')),
      page('dev-api', 'dev-api', () => import('./views/settings/DevApiView.vue')),
      page('bot-settings', 'bot-settings', () => import('./views/settings/BotSettingsView.vue')),
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/bot' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  if (!to.meta.public && !session.loggedIn) return { name: 'login', query: { next: to.fullPath } }
  if (isDesktop && session.loggedIn && to.name === 'login' && !to.query.add) return { name: 'bot' }
  return true
})
