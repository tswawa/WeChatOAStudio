// 演示账号「示例科技」（企业主体、已认证服务号，已接入开发接口）的初始数据
import { at } from '../../utils/time.js'
import { productHtml } from './articles.js'

const blue = { from: '#2b7de9', to: '#6fb1ff', label: '版本更新' }
const teal = { from: '#13c2c2', to: '#73e0e0', label: '使用指南' }

export function demoTechData() {
  return {
    followers: 58210,
    yesterday: { reads: 9420, shares: 610, newFollowers: 133, lost: 17 },
    weekReads: [8120, 7560, 9040, 8830, 10210, 8990, 9420],
    drafts: [
      {
        id: 'd201',
        title: '示例科技 3.2 上线：支持多人同时编辑',
        author: '示例科技',
        digest: '本次更新集中在协作和数据导出',
        html: productHtml(),
        cover: blue,
        origin: 'manual',
        updatedAt: at(-1, '17:40'),
        scheduledAt: null,
        massNotify: true,
      },
    ],
    published: [
      { id: 'p201', title: '发票怎么开？一篇说清楚', at: at(-2, '10:00'), mass: false, reads: 5120, likes: 96, shares: 402, comments: 9, origin: 'bot', cover: teal },
      { id: 'p202', title: '示例科技 3.1 更新说明', at: at(-9, '10:00'), mass: true, reads: 12880, likes: 233, shares: 951, comments: 41, origin: 'manual', cover: blue },
    ],
    materials: [
      { id: 'm201', name: '版本更新封面.png', size: '402KB', cover: blue },
      { id: 'm202', name: '使用指南封面.png', size: '356KB', cover: teal },
    ],
    comments: [
      { id: 'c201', user: '李工', article: '示例科技 3.1 更新说明', content: '导出什么时候支持 PDF？', at: at(-1, '09:15'), featured: false, reply: '' },
    ],
    messages: [
      { id: 'u201', user: '王女士', last: '发票三天了还没收到', at: at(0, '07:02'), unread: true },
      { id: 'u202', user: 'Kevin', last: '怎么绑定企业账号？', at: at(0, '06:47'), unread: true },
    ],
    autoReply: {
      follow: '感谢关注示例科技！回复「帮助」查看常见问题。',
      fallback: '人工客服工作时间为 9:00-18:00，我们会尽快回复。',
      keywords: [
        { id: 'k201', keyword: '发票', match: '半匹配', reply: '在「我的订单」点击「申请开票」，1 个工作日内发送至邮箱。' },
      ],
    },
    menu: [
      { name: '产品', subs: ['功能介绍', '版本更新'] },
      { name: '帮助', subs: ['常见问题', '开票指南', '联系客服'] },
    ],
    members: [
      { name: '周岚', role: '管理员', wechat: 'zhou***lan', term: '' },
      { name: '阿杰', role: '运营者', wechat: 'jie***07', term: '长期' },
      { name: '实习生小王', role: '运营者', wechat: 'wang***2x', term: '短期' },
    ],
    tags: [
      { name: '企业客户', count: 9820 },
      { name: '试用用户', count: 21400 },
    ],
    sources: [
      { id: 's201', name: '产品更新日志', kind: '网页', target: 'example-tech.com/changelog', enabled: true },
      { id: 's202', name: '客服高频问题', kind: '文档', target: '每周导出', enabled: true },
    ],
    api: { connected: true, appId: 'wx8d1c04a5e6f3b210' },
  }
}
