<!-- 登录页：扫码登录与账号密码登录两种方式，登录成功后进入工作台；add=1 时为追加登录其他公众号 -->
<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QrLoginPanel from './QrLoginPanel.vue'
import PasswordLoginPanel from './PasswordLoginPanel.vue'
import DesktopLoginPanel from './DesktopLoginPanel.vue'
import { loginAs, session } from '../../store/session.js'
import { isDesktop } from '../../services/desktop.js'
import AppBrand from '../../components/AppBrand.vue'
import { APP_NAME } from '../../config/brand.js'

const route = useRoute()
const router = useRouter()
const method = ref('qr')

function onSuccess(accountId) {
  loginAs(accountId, method.value === 'qr' ? 'qr' : 'password')
  router.replace(route.query.next || '/home')
}
</script>

<template>
  <div class="login-page">
    <header class="login-head">
      <AppBrand />
    </header>
    <main class="login-main">
      <section class="intro">
        <h1>用登录公众平台的方式登录</h1>
        <p
          v-if="isDesktop"
          class="muted"
        >
          连接你的真实公众号，保存登录状态并管理多个账号。
          登录验证在微信自己的页面中完成。
        </p>
        <p
          v-else
          class="muted"
        >
          登录后可以使用公众平台的全部常用功能，并增加公众号 Bot：
          在聊天里告诉它要做什么，它会采集资讯、写稿、存草稿，并在需要扫码时提醒你。
        </p>
        <ul class="points">
          <li>扫码登录或账号密码登录，与公众平台一致</li>
          <li>可同时登录多个公众号，在顶部切换</li>
          <li>发表文章仍需管理员或运营者扫码验证</li>
        </ul>
      </section>
      <section class="login-card">
        <h2 class="card-heading">
          {{ route.query.add ? '登录其他公众号' : isDesktop ? '连接公众号' : method === 'qr' ? '扫码登录' : '账号登录' }}
        </h2>
        <DesktopLoginPanel v-if="isDesktop" />
        <QrLoginPanel
          v-else-if="method === 'qr'"
          @success="onSuccess"
          @switch-password="method = 'password'"
        />
        <PasswordLoginPanel
          v-else
          @success="onSuccess"
          @switch-qr="method = 'qr'"
        />
        <router-link
          v-if="session.loggedIn"
          to="/home"
          class="back"
        >
          返回工作台
        </router-link>
      </section>
    </main>
    <footer class="login-foot faint">
      {{ isDesktop ? APP_NAME + ' · 登录状态保存在本机' : '交互原型 · 演示数据，不连接真实公众平台' }}
    </footer>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: #fff;
}

.login-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 64px;
  padding: 0 40px;
  border-bottom: 1px solid var(--border-light);
}

.login-main {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 96px;
  flex: 1;
  padding: 48px 40px;
  background: linear-gradient(180deg, #fff 0%, var(--bg-page) 100%);
}

.intro {
  max-width: 420px;
}

.intro h1 {
  margin-bottom: 16px;
  font-size: 28px;
  font-weight: 600;
}

.points {
  margin: 24px 0 0;
  padding-left: 18px;
  color: var(--text-2);
  line-height: 2;
}

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 380px;
  min-height: 460px;
  padding: 36px 40px;
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.card-heading {
  font-size: 18px;
  font-weight: 600;
}

.back {
  font-size: 13px;
}

.login-foot {
  padding: 16px;
  text-align: center;
  font-size: 12px;
}
</style>
