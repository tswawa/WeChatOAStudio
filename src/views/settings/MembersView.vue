<!-- 人员设置：管理员与运营者列表。他们的微信可以直接扫码完成发表验证，其他微信号扫码需管理员通过 -->
<script setup>
import StatusTag from '../../components/StatusTag.vue'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
import { ws } from '../../store/workspace.js'
import { toast } from '../../store/ui.js'
import { isDesktop } from '../../services/desktop.js'
import { invokeAction } from '../../services/workspace.js'
import SettingsTabs from '../../components/SettingsTabs.vue'

async function bindMember() {
  if (!isDesktop) return toast('需管理员扫码确认后添加', 'warn')
  try {
    await invokeAction('settings.members')
  } catch (error) {
    toast(error.message, 'warn')
    console.error('打开人员设置失败：', error)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <SettingsTabs />
      <button
        class="weui-btn weui-btn_mini weui-btn_primary"
        @click="bindMember"
      >
        绑定运营者
      </button>
    </div>
    <div class="card">
      <table
        v-if="ws.members.length"
        class="table"
      >
        <thead>
          <tr>
            <th>成员</th>
            <th>角色</th>
            <th>微信号</th>
            <th>期限</th>
            <th>可直接扫码发表</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="member in ws.members"
            :key="member.name"
          >
            <td>{{ member.name }}</td>
            <td>
              <StatusTag :tone="member.role === '管理员' ? 'success' : 'info'">
                {{ member.role }}
              </StatusTag>
            </td>
            <td class="muted">
              {{ member.wechat }}
            </td>
            <td class="muted">
              {{ member.term || '—' }}
            </td>
            <td class="text-brand">
              是
            </td>
          </tr>
        </tbody>
      </table>
      <WorkspaceEmptyState
        v-else
        section="members"
        text="没有成员"
      />
    </div>
  </div>
</template>
