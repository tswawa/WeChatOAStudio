// 演示账号「AI 观察日报」（个人主体、未认证公众号）的初始数据
import { at, lastOccurrence } from '../../utils/time.js'
import { dailyBriefHtml, readerQaHtml } from './articles.js'

const green = { from: '#0f9d58', to: '#34a0a4', label: 'AI 日报' }

export function aiObserverData() {
  return {
    followers: 12840,
    yesterday: { reads: 3260, shares: 214, newFollowers: 41, lost: 5 },
    weekReads: [2410, 2630, 2980, 2550, 3120, 2875, 3260],
    drafts: [
      {
        id: 'd101',
        title: 'AI 日报｜开源推理模型刷新长文本评测',
        author: 'AI 观察员',
        digest: '过去 24 小时 AI 行业值得关注的 4 件事',
        html: dailyBriefHtml(),
        cover: green,
        origin: 'bot',
        taskId: 't101',
        updatedAt: lastOccurrence('08:12'),
        scheduledAt: null,
        massNotify: true,
      },
      {
        id: 'd102',
        title: '读者问答｜个人号能不能自动发文？',
        author: 'AI 观察员',
        digest: '把读者留言里问得最多的问题整理成问答',
        html: readerQaHtml(),
        cover: { from: '#576b95', to: '#8e9dbd', label: '读者问答' },
        origin: 'manual',
        updatedAt: at(-1, '19:53'),
        scheduledAt: null,
        massNotify: false,
      },
    ],
    published: [
      { id: 'p101', title: 'AI 日报｜云厂商同日下调 API 价格', at: at(-1, '09:00'), mass: true, reads: 3260, likes: 88, shares: 214, comments: 12, origin: 'bot', cover: green },
      { id: 'p102', title: 'AI 日报｜浏览器内置模型进入稳定版', at: at(-2, '09:00'), mass: true, reads: 2875, likes: 64, shares: 156, comments: 7, origin: 'bot', cover: green },
      { id: 'p103', title: '一周回顾：Agent 评测基准到底测了什么', at: at(-3, '20:30'), mass: false, reads: 1408, likes: 51, shares: 97, comments: 15, origin: 'manual', cover: { from: '#ff7a45', to: '#ffb37a', label: '一周回顾' } },
    ],
    materials: [
      { id: 'm101', name: '日报封面-绿.png', size: '312KB', cover: green },
      { id: 'm102', name: '读者问答封面.png', size: '268KB', cover: { from: '#576b95', to: '#8e9dbd', label: '读者问答' } },
      { id: 'm103', name: '一周回顾封面.png', size: '295KB', cover: { from: '#ff7a45', to: '#ffb37a', label: '一周回顾' } },
      { id: 'm104', name: '关注引导图.png', size: '96KB', cover: { from: '#3a3a3a', to: '#6b6b6b', label: '引导图' } },
    ],
    comments: [
      { id: 'c101', user: '星河', article: 'AI 日报｜云厂商同日下调 API 价格', content: '降价之后长上下文的实际成本能再测一下吗？', at: at(0, '07:41'), featured: false, reply: '' },
      { id: 'c102', user: '码农老周', article: 'AI 日报｜云厂商同日下调 API 价格', content: '每天早上必看，整理得很清楚。', at: at(-1, '12:20'), featured: true, reply: '谢谢支持！' },
      { id: 'c103', user: 'Mia', article: '一周回顾：Agent 评测基准到底测了什么', content: '可以出一期讲怎么本地部署吗？', at: at(-1, '22:05'), featured: false, reply: '' },
    ],
    messages: [
      { id: 'u101', user: '阿亮', last: '请问日报有 RSS 订阅吗？', at: at(0, '07:30'), unread: true },
      { id: 'u102', user: '小雨', last: '收到，谢谢', at: at(-1, '16:12'), unread: false },
    ],
    autoReply: {
      follow: '你好，欢迎关注 AI 观察日报！每天 9 点推送当日 AI 行业要闻。',
      fallback: '消息已收到，我们会尽快回复你。',
      keywords: [
        { id: 'k101', keyword: '日报', match: '全匹配', reply: '往期日报在菜单「日报合集」里查看。' },
        { id: 'k102', keyword: '投稿', match: '半匹配', reply: '投稿请发邮件到 aiobserver@example.com。' },
      ],
    },
    menu: [
      { name: '日报合集', subs: ['今日日报', '往期合集'] },
      { name: '读者问答', subs: [] },
      { name: '关于我们', subs: ['联系方式', '商务合作'] },
    ],
    members: [
      { name: '陈默', role: '管理员', wechat: 'chen***mo', term: '' },
      { name: '小林', role: '运营者', wechat: 'lin***99', term: '长期' },
    ],
    tags: [
      { name: '星标读者', count: 862 },
      { name: '技术从业者', count: 4310 },
      { name: '学生', count: 1975 },
    ],
    sources: [
      { id: 's101', name: 'GitHub Trending', kind: '网页', target: 'github.com/trending', enabled: true },
      { id: 's102', name: 'Hacker News', kind: 'RSS', target: 'hnrss.org/frontpage', enabled: true },
      { id: 's103', name: '模型厂商官方博客', kind: '网页', target: '6 个站点', enabled: true },
    ],
    api: { connected: false, appId: '' },
  }
}
