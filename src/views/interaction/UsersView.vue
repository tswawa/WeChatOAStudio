<!-- 用户管理：总用户数与标签分组 -->
<script setup>
import { ws } from '../../store/workspace.js'
import { fmtNumber } from '../../utils/time.js'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          用户管理
        </h1>
        <p class="page-desc">
          共 {{ fmtNumber(ws.followers) }} 位用户
        </p>
      </div>
    </div>
    <div class="card">
      <div class="card-title">
        标签
      </div>
      <table
        v-if="ws.tags.length"
        class="table"
      >
        <thead>
          <tr>
            <th>标签名称</th>
            <th>用户数</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tag in ws.tags"
            :key="tag.name"
          >
            <td>{{ tag.name }}</td>
            <td>{{ fmtNumber(tag.count) }}</td>
          </tr>
        </tbody>
      </table>
      <WorkspaceEmptyState
        v-else
        section="users"
        text="没有标签"
      />
    </div>
    <div class="card">
      <div class="card-title">用户列表</div>
      <table
        v-if="ws.users?.length"
        class="table"
      >
        <thead>
          <tr>
            <th>用户</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in ws.users"
            :key="user.id"
          >
            <td>{{ user.name || '未获取' }}</td>
            <td>{{ user.remark || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <WorkspaceEmptyState
        v-else
        section="users"
        text="没有用户"
      />
    </div>
  </div>
</template>
