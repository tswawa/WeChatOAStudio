// 应用入口：加载 WeUI 与全局样式，挂载路由
import { createApp } from 'vue'
import 'weui/dist/style/weui.css'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.vue'
import { router } from './router.js'
import { initializeSession } from './store/session.js'
import { loadWorkspace } from './store/workspace.js'
import { APP_NAME } from './config/brand.js'

async function start() {
  document.title = APP_NAME
  await initializeSession()
  await loadWorkspace()
  createApp(App).use(router).mount('#app')
}

start().catch((error) => {
  console.error('应用启动失败：', error)
  document.querySelector('#app').textContent = `应用启动失败：${error.message}`
})
