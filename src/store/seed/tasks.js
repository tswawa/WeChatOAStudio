// 演示用运营任务与运行记录；任务由运营助手在聊天中创建，这里是已存在的两个
import { lastOccurrence, at } from '../../utils/time.js'
import { dailyBriefHtml, plainText } from './articles.js'

export function seedTasks() {
  return [
    {
      id: 't101',
      accountId: 'a1',
      name: 'AI 行业日报',
      topic: '过去 24 小时 AI 产品、模型与开源项目动态',
      sourceIds: ['s101', 's102', 's103'],
      style: '选 3～5 条，每条 100 字左右，语气克制',
      schedule: { repeat: 'daily', weekday: null, prepareAt: '08:00', publishAt: '09:00' },
      mode: 'draft_notify',
      massNotify: true,
      enabled: true,
      createdAt: at(-6, '21:10'),
      lastSlot: lastOccurrence('08:00'),
    },
    {
      id: 't201',
      accountId: 'a2',
      name: '每周使用技巧',
      topic: '从客服高频问题里挑一个，写成图文使用指南',
      sourceIds: ['s202'],
      style: '800 字左右，分步骤，配操作截图占位',
      schedule: { repeat: 'weekly', weekday: 2, prepareAt: '09:00', publishAt: '10:00' },
      mode: 'auto_publish',
      massNotify: false,
      enabled: true,
      createdAt: at(-20, '15:00'),
    },
  ]
}

export function seedRuns() {
  const prepared = lastOccurrence('08:00')
  const words = plainText(dailyBriefHtml()).length
  return [
    {
      id: 'r1001',
      taskId: 't101',
      accountId: 'a1',
      startedAt: prepared,
      status: 'waiting_scan',
      steps: [
        { key: 'collect', label: '采集资讯', state: 'done', note: '3 个来源，37 条' },
        { key: 'select', label: '去重筛选', state: 'done', note: '保留 4 条，跳过 6 条旧闻' },
        { key: 'write', label: '撰写排版', state: 'done', note: `${words} 字，排版检查通过` },
        { key: 'draft', label: '存入草稿箱', state: 'done', note: '已保存到草稿箱' },
        { key: 'publish', label: '扫码发表', state: 'pending', note: '等待管理员或运营者扫码' },
      ],
      draftId: 'd101',
    },
    {
      id: 'r1000',
      taskId: 't101',
      accountId: 'a1',
      startedAt: prepared - 24 * 60 * 60 * 1000,
      status: 'succeeded',
      steps: [
        { key: 'collect', label: '采集资讯', state: 'done', note: '3 个来源，41 条' },
        { key: 'select', label: '去重筛选', state: 'done', note: '保留 3 条' },
        { key: 'write', label: '撰写排版', state: 'done', note: '1108 字' },
        { key: 'draft', label: '存入草稿箱', state: 'done', note: '已保存到草稿箱' },
        { key: 'publish', label: '扫码发表', state: 'done', note: '小林 扫码，9:00 群发' },
      ],
      publishedId: 'p101',
    },
    {
      id: 'r2000',
      taskId: 't201',
      accountId: 'a2',
      startedAt: at(-2, '09:00'),
      status: 'succeeded',
      steps: [
        { key: 'collect', label: '采集资讯', state: 'done', note: '读取 12 条高频问题' },
        { key: 'select', label: '去重筛选', state: 'done', note: '选中「发票怎么开」' },
        { key: 'write', label: '撰写排版', state: 'done', note: '826 字' },
        { key: 'draft', label: '存入草稿箱', state: 'done', note: '已保存到草稿箱' },
        { key: 'publish', label: '接口发表', state: 'done', note: '10:00 发表成功（不推送）' },
      ],
      publishedId: 'p201',
    },
  ]
}
