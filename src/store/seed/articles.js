// 演示用文章正文：按微信排版规范写成的内联样式 HTML 片段
const h2 = (text) =>
  `<h2 style="margin:24px 0 12px;padding-left:10px;border-left:4px solid #07c160;font-size:17px;">${text}</h2>`
const p = (text) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:#333;">${text}</p>`
const source = (text) => `<p style="margin:0 0 14px;font-size:13px;color:#888;">来源：${text}</p>`

export function dailyBriefHtml() {
  return [
    p('过去 24 小时 AI 行业值得关注的 4 件事。'),
    h2('1. 开源推理模型刷新长文本评测'),
    p('一家开源实验室发布新一代推理模型，在 128K 长文本问答评测中超过同尺寸闭源模型，权重以 Apache-2.0 协议开放。'),
    source('项目 GitHub 发布页'),
    h2('2. 云厂商下调大模型 API 价格'),
    p('多家云厂商同日下调输入 token 价格，长上下文档位降幅最大。'),
    source('各厂商官网定价页'),
    h2('3. 浏览器内置 AI 能力进入稳定版'),
    p('新版浏览器把本地摘要和翻译能力放进稳定通道，网页可以通过标准接口直接调用。'),
    source('浏览器官方博客'),
    h2('4. 新的 Agent 评测基准公开榜单'),
    p('基准覆盖网页操作、表格处理和代码修改三类任务，榜单第一的成功率为 61%。'),
    source('论文与评测仓库'),
    p('以上内容根据公开资料整理，观点仅供参考。'),
  ].join('')
}

export function readerQaHtml() {
  return [
    p('本周把读者留言里问得最多的问题整理成了问答。'),
    h2('大模型 API 怎么选'),
    p('先看任务类型：长文本整理看上下文长度，客服问答看响应速度，代码任务看工具调用是否稳定。'),
    h2('个人号能不能自动发文'),
    p('个人主体账号可以自动生成内容并存入草稿箱，最终发表需要管理员或运营者扫码验证。'),
  ].join('')
}

export function productHtml() {
  return [
    p('示例科技 3.2 版本今天上线，本次更新集中在协作和数据导出。'),
    h2('新增：多人同时编辑'),
    p('同一份文档最多支持 20 人同时编辑，光标和修改记录实时同步。'),
    h2('优化：导出速度'),
    p('万行以内的表格导出从平均 8 秒缩短到 2 秒。'),
  ].join('')
}

export function guideHtml() {
  return [
    p('很多用户问发票怎么开，这里一次说清楚。'),
    h2('第一步：进入订单详情'),
    p('在「我的订单」里找到对应订单，点击「申请开票」。个人和企业抬头都支持。'),
    h2('第二步：填写抬头'),
    p('企业抬头需要填写税号；如果要寄送纸质发票，再补充收件地址。'),
    h2('第三步：查收发票'),
    p('提交后 1 个工作日内，电子发票会发送到预留邮箱，也可以在订单详情里下载。'),
    h2('常见问题'),
    p('抬头填错了可以在 30 天内申请重开；超过 30 天请联系客服处理。'),
  ].join('')
}

export function plainText(html) {
  return html.replace(/<[^>]+>/g, '')
}
