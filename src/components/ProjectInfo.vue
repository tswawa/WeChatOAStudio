<!-- 项目信息：在开发接口表单下方显示产品名、版本、作者和 GitHub 仓库。 -->
<script setup>
import { ExternalLink, Github } from 'lucide-vue-next'
import { version } from '../../package.json'
import { APP_NAME, AUTHOR_NAME, AUTHOR_GITHUB_URL, PROJECT_GITHUB_URL } from '../config/brand.js'
import { toast } from '../store/ui.js'

const repository = new URL(PROJECT_GITHUB_URL).pathname.replace(/^\//, '')

async function openLink(event, target) {
  if (!window.mpDesktop) return
  event.preventDefault()
  try {
    await window.mpDesktop.openExternal(target)
  } catch (error) {
    toast(error.message || '无法打开链接', 'warn')
    console.error('打开项目链接失败：', error)
  }
}
</script>

<template>
  <section class="card project-info" aria-label="关于 WeChatOAStudio">
    <div class="identity">
      <strong>{{ APP_NAME }}</strong>
      <span class="version">v{{ version }}</span>
    </div>
    <dl class="meta">
      <div>
        <dt>作者</dt>
        <dd>
          <a
            :href="AUTHOR_GITHUB_URL"
            target="_blank"
            rel="noopener noreferrer"
            @click="openLink($event, 'author')"
          >{{ AUTHOR_NAME }}</a>
        </dd>
      </div>
      <div>
        <dt>源代码</dt>
        <dd>
          <a
            class="repository"
            :href="PROJECT_GITHUB_URL"
            target="_blank"
            rel="noopener noreferrer"
            @click="openLink($event, 'repository')"
          >
            <Github :size="15" />
            <span>github.com/{{ repository }}</span>
            <ExternalLink :size="12" />
          </a>
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.project-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 40px;
  font-size: 13px;
}

.identity {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.identity strong {
  font-size: 15px;
}

.version {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-page);
  color: var(--text-2);
  font-size: 12px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 32px;
  margin: 0;
}

.meta div {
  display: flex;
  gap: 8px;
}

.meta dt {
  color: var(--text-3);
}

.meta dd {
  margin: 0;
}

.repository {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow-wrap: anywhere;
}
</style>
