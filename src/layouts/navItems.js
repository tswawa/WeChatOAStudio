// 左侧导航：公众号业务页面分组；账号、人员、开发接口合并为一个“设置”入口（页内再分页签），Bot 设置从 Bot 页进入。
import {
  House,
  Bot,
  CalendarClock,
  FileText,
  LayoutTemplate,
  Image,
  Send,
  MessageCircle,
  MessagesSquare,
  Reply,
  Menu,
  Users,
  ChartColumn,
  Settings,
} from 'lucide-vue-next'

export const NAV_GROUPS = [
  {
    title: '',
    items: [{ to: '/home', label: '首页', icon: House }],
  },
  {
    title: '智能运营',
    items: [
      { to: '/bot', label: 'Bot', icon: Bot, match: ['/bot-settings'] },
      { to: '/tasks', label: '运营任务', icon: CalendarClock },
    ],
  },
  {
    title: '内容',
    items: [
      { to: '/drafts', label: '草稿箱', icon: FileText, match: ['/editor'] },
      { to: '/templates', label: '文章模板', icon: LayoutTemplate, match: ['/template-editor'] },
      { to: '/materials', label: '素材库', icon: Image },
      { to: '/published', label: '发表记录', icon: Send },
      { to: '/data', label: '数据分析', icon: ChartColumn },
    ],
  },
  {
    title: '互动',
    items: [
      { to: '/comments', label: '留言', icon: MessageCircle },
      { to: '/messages', label: '私信', icon: MessagesSquare },
      { to: '/auto-reply', label: '自动回复', icon: Reply },
      { to: '/menu', label: '自定义菜单', icon: Menu },
      { to: '/users', label: '用户管理', icon: Users },
    ],
  },
  {
    title: '',
    items: [{ to: '/account', label: '设置', icon: Settings, match: ['/members', '/dev-api'] }],
  },
]

// 设置页的页签：三个页面各自保留原地址
export const SETTINGS_TABS = [
  { to: '/account', label: '账号' },
  { to: '/members', label: '人员' },
  { to: '/dev-api', label: '开发接口' },
]
