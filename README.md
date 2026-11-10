# WeChatOAStudio

AI 驱动的微信公众号内容自动化工作台。Bot 可以自行上网搜集资料、核对来源、撰写文稿、寻找配图、套用模板，并按作者授权自动保存和发送文章。

项目面向公众号作者和运营人员，把资料采集、写作、配图、排版和发表串成一个连续任务。可以直接交代主题、篇幅与发送要求，也可以设定每天或每周执行的任务，让 AI 按账号的写作规则和长期偏好处理。同时提供多账号、草稿、互动与数据管理。

[![最新版本](https://img.shields.io/github/v/release/tswawa/WeChatOAStudio?style=flat&logo=github&label=release)](https://github.com/tswawa/WeChatOAStudio/releases/latest)
[![Release 累计下载量](https://img.shields.io/github/downloads/tswawa/WeChatOAStudio/total?style=flat&logo=github&label=downloads)](https://github.com/tswawa/WeChatOAStudio/releases)
[![GitHub Stars](https://img.shields.io/github/stars/tswawa/WeChatOAStudio?style=flat&logo=github)](https://github.com/tswawa/WeChatOAStudio/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/tswawa/WeChatOAStudio?style=flat&logo=github)](https://github.com/tswawa/WeChatOAStudio/forks)
[![GitHub Issues](https://img.shields.io/github/issues/tswawa/WeChatOAStudio?style=flat&logo=github)](https://github.com/tswawa/WeChatOAStudio/issues)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue?style=flat)](LICENSE)

[![Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D4?style=flat)](#安装)
[![Electron 45.2.1](https://img.shields.io/badge/Electron-45.2.1-47848F?style=flat&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?style=flat&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?style=flat&logo=nodedotjs&logoColor=white)](#开发与文档)

[功能介绍](#功能介绍) · [下载安装](#安装) · [首次使用](#首次使用) · [更新与备份](#更新与备份) · [开发与文档](#开发与文档) · [交流与建议](#交流与建议)

## 功能介绍

### AI 自动采集、写稿与发送

在 Bot 中说明要写什么、写多少字、采用什么风格和是否发送，AI 按要求连续处理整篇文章。

| 环节 | AI 处理的内容 |
| --- | --- |
| 搜集资料 | 根据选题搜索互联网，读取真实网页，整理来源与相关信息。 |
| 撰写文稿 | 结合资料、文章模板和账号规则，生成标题、摘要与完整正文。 |
| 寻找配图 | 从来源网页或搜索结果取得图片，由当前模型查看图片内容，选择适合段落的配图。 |
| 排版保存 | 按选定范文套用标题、引用、段落和图片样式，保存到公众号草稿箱。 |
| 自动发送 | 按本次指令或已保存的任务授权发表文章，通知范围按作者要求设置，并跟踪微信回执。 |

例如，直接告诉 Bot：

> 写一篇关于最近很火的 DeepSeek bot 的文章，2000 字左右，配图用 DeepSeek 娘化形象相关的表情包，使用默认模板，然后帮我直接发送，不群发通知。

这次示例生成了《DeepSeek 出圈的居然不是模型，是一只“蓝色大肥鱼”》，带有标题、摘要、完整正文和 5 张配图。下面可以看到提出需求后得到的文稿卡片，正文效果在后续章节展示。文稿与配图沿用此前的创作案例，账号信息替换为演示数据。

![向 Bot 提出 DeepSeek bot 选题并生成带图文稿](docs/assets/readme/bot.png)

也可以保存为定时任务，按设定时间自动执行同样的流程。账号风格、资料要求、选图偏好和常用任务都可以自行维护。需要调整时，在原会话继续提出要求，Bot 会结合当前稿件处理。

自动发送需要当前账号具备相应权限；微信触发身份验证时，在原生窗口完成确认后继续。定时自动发表的配置见下方「定时任务与快捷任务」。

### 多公众号管理

在微信公众平台完成登录后，应用读取账号资料，在工作台顶部切换当前公众号。

- 各公众号分别保存浏览器会话、草稿缓存、Bot 会话、任务和配图记录。
- 支持添加账号、切换账号、检查登录状态、打开公众平台和退出登录。
- 应用重新启动后会复核登录状态；需要重新授权时，在微信页面完成验证。
- 可在「账号设置」配置密码自动登录，凭据通过 Windows 加密保存。

### Bot 写稿与连续改稿

进入「Bot」，用自然语言处理当前公众号的内容和运营任务。对话历史按会话保存在本机，可以继续追问或新建会话。

- **写稿**：按主题、篇幅、语气和选定模板生成文章，支持标题、摘要、正文与配图。
- **改稿**：从编辑器交给 Bot，或在当前会话继续要求修改标题、补充段落、精简内容和添加图片。
- **身份与规则**：编辑 Bot 名称、写作要求、选图偏好和工作方式。
- **长期记忆**：保存账号背景和稳定偏好，支持查看、编辑与删除。
- **执行记录**：查看实际工具步骤、模型返回和操作结果，生成过程中可以停止。
- **操作确认**：改稿和任务调整通过确认卡执行；本条消息明确要求直接发送时，按绑定的稿件、发送方式和通知范围执行。

例如，可以说“按默认模板写一篇 1500 字的产品更新，配上相关图片”“保留正文，只给这篇加两张图”，或“把当前选中的草稿普通发送，不群发通知”。

生成的正文可直接打开手机预览。DeepSeek bot 这篇稿件从话题场景切入，再展开背景、形象与传播过程；检查后可以继续要求调整语气、补充资料或修改段落。

<img src="docs/assets/readme/article-preview.png" alt="DeepSeek bot 文章标题、开头与正文排版预览" width="520">

### 联网资料与配图

Bot 可以搜索网页、阅读指定来源，并从文章、仓库 README 或图片直链取得配图。

- 网页搜索与图片搜索支持 Bing、Google、百度、搜狗、360、DuckDuckGo、Yahoo 和 Yandex，在 Bot 设置中选择来源和顺序。
- 检索优先使用当前模型接口的原生搜索；接口明确不支持时，使用已选择的搜索引擎。
- 网页正文、图片详情链接、Markdown 图片、相对路径和 GitHub 文件链接可直接读取。
- 搜索结果先核对主题相关性，候选图片再由当前模型查看实际像素并审核，通过后保存到本地。
- 图片可以插入正文，并作为文章封面；卡片中可查看来源、预览图片和移除配图。
- 配图数量、风格、批次、并行与重试方式按作者的当前要求及可编辑规则安排。

配图使用静态 JPG、PNG 和 WebP。视觉审核使用 Bot 当前配置的模型，模型需要支持图片输入。网站的登录、验证码和动态加载可能影响正文或图片读取。

例如，写 DeepSeek bot 时会围绕角色形象和表情包文化选图，放到对应段落中。这张图位于文稿结尾，和正文里的互动话题一起展示。

<img src="docs/assets/readme/article-images.png" alt="自动选取的 DeepSeek 娘化表情包与文章结尾" width="520">

### 文章模板与编辑

在「内容 → 文章模板」维护文章范文和排版。

- 编辑模板名称、结构要求和范文，设置默认模板。
- 在范文中插入、粘贴或拖入图片，调整图片说明、宽度和对齐。
- Bot 参考范文的段落结构、标题、引用和图片位置，应用按范文套用排版样式。
- 草稿编辑器支持图文内容和贴图，提供图片排序、文章信息与预览。

把已经排好的文章作为范文保存，后续选题可以沿用它的结构和版式。编辑器左侧填写用途与写作结构，中间编辑范文，右侧同步查看手机效果。

![使用科技热点解读范文编辑文章模板并查看手机效果](docs/assets/readme/templates.png)

### 草稿、发表与群发通知

草稿箱、编辑器和已保存稿件的 Bot 卡片均可发起发表。

| 发送方式 | 使用条件 |
| --- | --- |
| 普通发送 | 使用当前公众号已登录的微信页面，在专用窗口中完成原生发送流程。 |
| 接口发送 | 在「开发接口」配置该公众号的 AppID 和 AppSecret，微信账号需具有对应接口权限。 |

两种方式都可以分别选择是否开启群发通知。开启通知会占用微信实际群发次数，剩余次数在发表界面显示并可刷新。

普通发送会处理通知开关和常规二次确认；微信要求管理员扫码、验证码或其他身份确认时，显示微信窗口，由账号本人完成。**普通发表也可能触发账号的微信发送保护。**

发表前会核对完整稿件版本，发送记录区分准备中、等待验证、已提交、成功、失败和结果待核实。同一版本已有成功或待核实提交时会阻止重复发送，最终状态以微信回执为准。

文稿准备好后，在同一入口选择发送方式与通知范围，查看摘要、封面和微信剩余通知次数。

![DeepSeek bot 稿件的普通发送与群发通知设置](docs/assets/readme/publication.png)

### 定时任务与快捷任务

在「运营任务」添加任务内容、执行时间和重复星期，应用运行期间按时将任务交给 Bot。

- 支持每天或每周指定星期执行，保存时确认完整任务内容。
- 查看任务状态、执行历史，支持暂停、恢复、修改和删除。
- 任务可设置发表前确认，或授权本次任务新稿自动发表、发表并群发通知；自动发表任务使用已配置的官方接口。
- 试写用于检查稿件与执行结果，只保存草稿。
- 快捷任务可保存常用指令，在 Bot 中快速调用。

定时任务需要应用保持运行，Windows 关机或休眠期间无法按原时间执行。

把日常的 AI 行业简报、产品更新或固定栏目保存为任务，到点按同一套要求采集资料、写稿和配图，在任务详情中查看执行结果。

![每日 AI 行业简报的任务内容与定时执行设置](docs/assets/readme/schedule.png)

### 聊天附件

在 Bot 输入框选择文件、粘贴图片或拖入附件，发送前可预览和移除。

支持 JPG、PNG、WebP，以及 TXT、Markdown、CSV、JSON、LOG、PDF 和 DOCX。图片以实际像素提供给当前模型，文档在本机提取文字后进入对话。需要把附件图片用于文章时，可明确要求 Bot 将其审核为正文配图。

单个附件上限 10 MB，一条消息附件合计上限 20 MB。长文档可分段读取，实际可处理内容还取决于模型上下文配置。

### 互动、数据与收入

工作台沿用当前公众号的登录会话，同步各业务页面。

- **留言与私信**：查看会话和留言、处理回复与已读状态，维护常用回复。
- **自动回复与菜单**：维护关注回复、关键词规则和自定义菜单。
- **用户与人员**：查看用户资料、标签和账号人员信息。
- **数据分析**：查看粉丝、阅读和文章相关数据。
- **收入概览**：查看流量主、付费阅读和赞赏的可用汇总，支持独立刷新与官方详情入口。

收入内容随公众号已开通的能力及微信返回字段展示。人民币与微信豆分别显示，历史缓存会标注时间。

![工作台首页的账号概况、待办、任务与文章数据，使用演示数据](docs/assets/readme/overview.png)

## 安装

当前版本为 **0.3.14**，提供 Windows x64 桌面包。

| 文件 | 下载 |
| --- | --- |
| Windows 安装器 | [WeChatOAStudio-Setup-0.3.14.exe](https://github.com/tswawa/WeChatOAStudio/releases/download/v0.3.14/WeChatOAStudio-Setup-0.3.14.exe) |
| Windows 免安装压缩包 | [WeChatOAStudio-0.3.14-win-x64.zip](https://github.com/tswawa/WeChatOAStudio/releases/download/v0.3.14/WeChatOAStudio-0.3.14-win-x64.zip) |
| 源码压缩包 | [WeChatOAStudio-0.3.14-source.zip](https://github.com/tswawa/WeChatOAStudio/releases/download/v0.3.14/WeChatOAStudio-0.3.14-source.zip) |
| 文件校验值 | [SHA256SUMS.txt](https://github.com/tswawa/WeChatOAStudio/releases/download/v0.3.14/SHA256SUMS.txt) |

使用安装器时，运行后选择安装目录。使用免安装包时，解压完整目录，运行其中的 `WeChatOAStudio.exe`。

包体未配置代码签名证书，Windows 可能显示未知发布者提示。可先对照 `SHA256SUMS.txt` 核对文件：

```powershell
Get-FileHash .\WeChatOAStudio-Setup-0.3.14.exe -Algorithm SHA256
```

## 首次使用

1. **登录公众号**：打开应用，点击「打开微信公众平台登录」，在微信自己的页面扫码或使用账号密码，并完成微信要求的验证。
2. **配置模型**：进入「Bot → 设置」，填写接口地址、模型名称和 API Key，选择 API 格式，测试连接后保存。
3. **设置 Bot**：编辑「身份与规则」，填写写作风格、资料要求与配图偏好；在同页设置配图保存目录。
4. **准备文章模板**：进入「文章模板」，填写结构要求和范文，需要常用时设为默认。
5. **开始写稿**：回到 Bot，说明主题、篇幅和使用的模板，也可附上资料或图片。
6. **检查稿件**：在生成卡片中预览正文、配图和封面，按需要继续修改，再确认保存或发起发表。
7. **核对发表状态**：微信要求验证时在微信窗口完成，随后在发送卡片或发表记录查询结果。

首次启动从连接公众号开始，模型连接与写作规则在进入工作台后配置。

![空数据首次启动的公众号连接界面](docs/assets/readme/first-start.png)

### 模型连接

| API 格式 | 接口类型 |
| --- | --- |
| Chat Completions | OpenAI 及兼容接口 |
| Responses | OpenAI Responses |
| Anthropic | Anthropic Messages |
| Gemini | Google Gemini GenerateContent |

接口地址、模型名、思考强度和上下文窗口按服务商文档填写。需要自动配图或读取图片附件时，选择支持图像输入的模型。模型服务的额度与费用由所选服务商计算。

## 更新与备份

更新前退出应用，再安装新版本或替换完整的免安装目录。

| 数据 | 默认位置 |
| --- | --- |
| 账号、Bot 会话、任务、模板、设置、附件与微信会话 | `%APPDATA%\mp-ops-desktop\` |
| 正文配图 | 软件目录下的 `ArticleImages\`，或作者在 Bot 设置中选择的目录 |

备份时先退出应用，复制完整的数据目录和配图目录。重新安装通常会继续使用原数据，卸载程序默认保留用户数据。模型和自动登录凭据通过 Windows 加密保存，迁移到另一台电脑后可能需要重新填写。

## 开发与文档

项目使用 Vue 3、Vue Router、WeUI 和 Vite 构建界面，Electron 提供桌面窗口、会话隔离、SQLite 存储与受限 IPC。模型连接使用 OpenAI、Anthropic 和 Google 的 SDK，图片处理使用 sharp，文档提取使用 pdf-parse 和 mammoth。

建议在 Windows x64、Node.js 24 环境中开发。

```powershell
git clone https://github.com/tswawa/WeChatOAStudio.git
cd WeChatOAStudio
npm ci
npm run desktop
```

```powershell
npm run test:desktop
npm run desktop:pack
npm run desktop:installer
```

桌面开发与打包命令会先构建前端。单独调试浏览器演示页面时运行 `npm run dev`，构建输出为 `dist/index.html`。

```text
src/          工作台页面、组件、样式、状态与演示数据
electron/     桌面入口、账号会话、微信业务、Bot 与本地存储
tests/        独立回归测试与受控模型响应
scripts/      测试工具
build/        Windows 图标等打包资源
docs/         截图、发布与安全说明
```

| 需要了解的内容 | 文档 |
| --- | --- |
| 本地开发、测试与提交代码 | [贡献指南](CONTRIBUTING.md) |
| 源码发布、安装包与版本 Release | [发布指南](docs/RELEASING.md) |
| 用户数据与漏洞报告 | [安全政策](SECURITY.md) |
| 代码许可与依赖组件 | [许可说明](LICENSING.md) |

## 交流与建议

使用问题或改进建议请提交 [Issues](https://github.com/tswawa/WeChatOAStudio/issues)。描述复现步骤、应用版本和 Windows 版本，附图前请遮住账号资料、二维码和凭据。

## 许可证

项目采用 [GPL-3.0-only](LICENSE) 许可。第三方组件及其许可证见 [许可说明](LICENSING.md) 和 [第三方组件清单](docs/THIRD-PARTY-NOTICES.md)。
