<!-- 柱状趋势图：单序列内联 SVG；柱宽不超过 24px、顶部 4px 圆角，悬停显示数值，末柱直接标注 -->
<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  values: { type: Array, required: true },
  labels: { type: Array, required: true },
  unit: { type: String, default: '' },
})

const WIDTH = 640
const HEIGHT = 220
const PAD = { top: 24, right: 12, bottom: 28, left: 44 }
const BAR = 24
// 品牌绿 #07c160 对白底对比度只有 2.3:1，柱子用校验通过的深一档绿色
const BAR_COLOR = '#06a052'

const hover = ref(null)

const max = computed(() => {
  const top = Math.max(1, ...props.values.filter((value) => typeof value === 'number' && Number.isFinite(value)))
  const step = 10 ** Math.floor(Math.log10(top))
  return Math.ceil(top / step) * step
})

const ticks = computed(() => [0, 0.5, 1].map((ratio) => Math.round(max.value * ratio)))
const plotW = WIDTH - PAD.left - PAD.right
const plotH = HEIGHT - PAD.top - PAD.bottom
const band = computed(() => plotW / props.values.length)

const bars = computed(() =>
  props.values.map((value, index) => {
    const available = typeof value === 'number' && Number.isFinite(value)
    const h = available ? (value / max.value) * plotH : 0
    const x = PAD.left + band.value * index + (band.value - BAR) / 2
    const y = PAD.top + plotH - h
    return { value: available ? value : '未获取', available, label: props.labels[index], x, y, h, cx: x + BAR / 2 }
  }),
)

// 顶部两角 4px 圆角、底部直角的柱形路径
function barPath({ x, y, h }) {
  const r = Math.min(4, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + BAR - r}Q${x + BAR},${y} ${x + BAR},${y + r}V${y + h}Z`
}

const yOf = (tick) => PAD.top + plotH - (tick / max.value) * plotH
</script>

<template>
  <figure class="chart">
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      role="img"
      :aria-label="'近 7 天阅读趋势，单位' + unit"
    >
      <g class="grid">
        <g
          v-for="tick in ticks"
          :key="tick"
        >
          <line
            :x1="PAD.left"
            :x2="WIDTH - PAD.right"
            :y1="yOf(tick)"
            :y2="yOf(tick)"
          />
          <text
            :x="PAD.left - 8"
            :y="yOf(tick) + 4"
            text-anchor="end"
          >{{ tick }}</text>
        </g>
      </g>
      <g
        v-for="(bar, index) in bars"
        :key="bar.label"
        @mouseenter="hover = index"
        @mouseleave="hover = null"
      >
        <rect
          class="hit"
          :x="PAD.left + band * index"
          :y="PAD.top"
          :width="band"
          :height="plotH"
        />
        <path
          v-if="bar.available"
          :d="barPath(bar)"
          :fill="BAR_COLOR"
          :opacity="hover === null || hover === index ? 1 : 0.55"
        />
        <text
          class="axis"
          :x="bar.cx"
          :y="HEIGHT - 8"
          text-anchor="middle"
        >{{ bar.label }}</text>
        <text
          v-if="index === bars.length - 1 && hover === null"
          class="value"
          :x="bar.cx"
          :y="bar.y - 6"
          text-anchor="middle"
        >{{ bar.value }}</text>
      </g>
    </svg>
    <div
      v-if="hover !== null"
      class="tip"
      :style="{ left: (bars[hover].cx / WIDTH) * 100 + '%', top: (bars[hover].y / HEIGHT) * 100 + '%' }"
    >
      <span class="tip-label">{{ bars[hover].label }}</span>
      <strong>{{ bars[hover].value }}{{ bars[hover].available ? unit : '' }}</strong>
    </div>
  </figure>
</template>

<style scoped>
.chart {
  position: relative;
  margin: 0;
}

svg {
  display: block;
  width: 100%;
  height: auto;
}

.grid line {
  stroke: var(--border-light);
}

.grid text,
.axis {
  fill: var(--text-3);
  font-size: 11px;
}

.value {
  fill: var(--text-1);
  font-size: 12px;
  font-weight: 600;
}

.hit {
  fill: transparent;
  cursor: default;
}

.tip {
  position: absolute;
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: var(--radius);
  background: #fff;
  box-shadow: var(--shadow-pop);
  font-size: 12px;
  transform: translate(-50%, calc(-100% - 8px));
  pointer-events: none;
  white-space: nowrap;
}

.tip-label {
  color: var(--text-2);
}
</style>
