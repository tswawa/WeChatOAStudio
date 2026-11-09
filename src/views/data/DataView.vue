<!-- 数据分析：昨日关键指标、近 7 天阅读趋势（附数据表）、单篇文章数据 -->
<script setup>
import { ref, computed } from 'vue'
import BarTrend from '../../components/BarTrend.vue'
import { ws } from '../../store/workspace.js'
import { at, fmtDateTime, fmtNumber } from '../../utils/time.js'

const showTable = ref(false)

const labels = computed(() => ws.value.weekDates?.length ? ws.value.weekDates.map((date) => date.slice(5))
  : ws.value.weekReads.map((_, index) => {
    const date = new Date(at(index - 7, '12:00'))
    return date.getMonth() + 1 + '/' + date.getDate()
  }))
const trendTitle = computed(() => ws.value.metrics?.weekReads || '阅读次数')
const trendUnit = computed(() => ws.value.trendUnit || '次')

const articles = computed(() => [...ws.value.published].sort((a, b) => b.reads - a.reads))
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          数据分析
        </h1>
      </div>
    </div>

    <section class="card">
      <div class="card-title">
        昨日关键指标
      </div>
      <dl class="kpis">
        <div>
          <dt>阅读次数</dt>
          <dd>{{ fmtNumber(ws.yesterday.reads) }}</dd>
        </div>
        <div>
          <dt>分享次数</dt>
          <dd>{{ fmtNumber(ws.yesterday.shares) }}</dd>
        </div>
        <div>
          <dt>新关注</dt>
          <dd>{{ fmtNumber(ws.yesterday.newFollowers) }}</dd>
        </div>
        <div>
          <dt>取消关注</dt>
          <dd>{{ fmtNumber(ws.yesterday.lost) }}</dd>
        </div>
        <div>
          <dt>净增关注</dt>
          <dd>{{ ws.yesterday.newFollowers == null || ws.yesterday.lost == null
            ? '未获取' : fmtNumber(ws.yesterday.newFollowers - ws.yesterday.lost) }}</dd>
        </div>
      </dl>
    </section>

    <section class="card">
      <div class="card-title">
        近 7 天{{ trendTitle }}
        <a
          class="more"
          @click="showTable = !showTable"
        >{{ showTable ? '看图表' : '看数据表' }}</a>
      </div>
      <p
        v-if="!ws.weekReads.length"
        class="empty"
      >尚未获取阅读趋势</p>
      <BarTrend
        v-else-if="!showTable"
        :values="ws.weekReads"
        :labels="labels"
        :unit="' ' + trendUnit"
      />
      <table
        v-else
        class="table"
      >
        <thead>
          <tr>
            <th>日期</th>
            <th>{{ trendTitle }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(value, index) in ws.weekReads"
            :key="labels[index]"
          >
            <td>{{ labels[index] }}</td>
            <td>{{ fmtNumber(value) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <div class="card-title">
        单篇文章
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>文章</th>
            <th>发表时间</th>
            <th>阅读</th>
            <th>分享</th>
            <th>点赞</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in articles"
            :key="item.id"
          >
            <td>{{ item.title }}{{ item.deleted ? '（已删除）' : '' }}</td>
            <td class="muted">
              {{ fmtDateTime(item.at) }}
            </td>
            <td>{{ fmtNumber(item.reads) }}</td>
            <td>{{ fmtNumber(item.shares) }}</td>
            <td>{{ fmtNumber(item.likes) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.kpis {
  display: flex;
  gap: 64px;
  margin: 0;
}

.kpis dt {
  font-size: 12px;
  color: var(--text-2);
}

.kpis dd {
  margin: 4px 0 0;
  font-size: 24px;
  font-weight: 600;
}

.more {
  font-size: 13px;
  font-weight: 400;
}
</style>
