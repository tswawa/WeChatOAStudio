// Format integer cents without introducing floating-point rounding into financial displays.
const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('zh-CN')

export function formatIncomeMetric(metric) {
  if (!Number.isSafeInteger(metric?.value)) return '--'
  if (metric.unit === 'CNY') {
    const cents = BigInt(metric.value)
    const absolute = cents < 0n ? -cents : cents
    const fraction = String(absolute % 100n).padStart(2, '0')
    const text = currency.formatToParts(absolute / 100n).map(part => part.type === 'fraction' ? fraction : part.value).join('')
    return (cents < 0n ? '-' : '') + text
  }
  return number.format(metric.value) + (metric.unit === 'WECOIN' ? ' 微信豆' : metric.unit === 'ARTICLE' ? ' 篇' : '')
}
