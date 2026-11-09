// Run one persistent Bot for desktop and scheduled work with observable model/tool steps.
const { completion } = require('../ops/model.cjs')
const { createContext, signature } = require('./context.cjs')
const { normalizeBot } = require('./config.cjs')
const { MEMORY_TOOL } = require('./memory.cjs')
const { toolOutput, estimate } = require('./tokens.cjs')

function createBotAgent({ store, sessions, memory, settings, notify, say, tools, prompt, operate, attachments, authorize }) {
  const busy = new Set()
  const controllers = new Map()
  // One run per account at a time; records which session it writes to so the UI can show it.
  const running = new Map()
  const pending = new Set()
  function track(promise) {
    pending.add(promise)
    promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  function save(accountId, message) {
    store.put('messages', accountId, message)
    notify(accountId)
  }
  async function send(accountId, { text = '', focusDraftId, attachmentIds = [], channel = 'desktop' }, scheduled = null) {
    if (!Array.isArray(attachmentIds)) throw new Error('附件列表格式无效')
    if (typeof text !== 'string' || (!text.trim() && !attachmentIds.length)) throw new Error('请输入消息或添加附件')
    if (busy.has(accountId)) {
      const current = running.get(accountId)
      throw new Error(current?.kind === 'schedule'
        ? `定时任务「${current.taskName}」正在执行，完成后再发送，或先停止它`
        : 'Bot 正在回复，请稍等')
    }
    const savedSettings = settings.private()
    if (!attachments && attachmentIds.length) throw new Error('当前环境未启用聊天附件')
    const attached = attachments ? await attachments.validate(accountId, attachmentIds, savedSettings.model) : []
    if (busy.has(accountId)) throw new Error('Bot 正在回复，请稍等')
    const controller = new AbortController()
    const signal = scheduled?.signal ? AbortSignal.any([controller.signal, scheduled.signal]) : controller.signal
    const session = scheduled ? sessions.scheduled(accountId) : sessions.conversation(accountId)
    const turnSettings = { private: () => savedSettings }
    const context = createContext({ sessions, memory, settings: turnSettings, attachments })
    const config = normalizeBot(savedSettings.bot)
    const definitions = config.memoryEnabled ? [...tools, MEMORY_TOOL] : tools
    const first = say(accountId, {
      role: 'user', text: text.trim() || '请查看附件。', channel: scheduled ? 'schedule' : channel, sessionId: session.id,
      ...(attached.length ? { attachments: attached } : {}),
      ...(scheduled ? { taskId: scheduled.taskId, runId: scheduled.runId, scheduledAt: scheduled.slot } : {}),
    })
    if (session.title === '新会话') sessions.update(accountId, session.id, { title: (text.trim() || attached[0]?.name || '附件对话').slice(0, 32) })
    const created = [first]
    let output, authorization
    let modelCalls = 0
    const beforeModelCall = () => {
      if (modelCalls >= config.maxSteps) throw new Error(`已达到本轮 ${config.maxSteps} 次模型调用上限`)
      modelCalls += 1
    }
    busy.add(accountId)
    running.set(accountId, { sessionId: session.id, kind: scheduled ? 'schedule' : 'chat',
      taskName: scheduled?.taskName || '' })
    controllers.set(accountId, controller)
    try {
      if (authorize && !scheduled && channel === 'desktop') authorization = await authorize(accountId, {
        text, focusDraftId, sessionId: session.id, currentMessageId: first.id, signal, settings: turnSettings, beforeModelCall,
      })
      for (let turn = 0; turn < config.maxSteps; turn += 1) {
        signal.throwIfAborted()
        output = say(accountId, { role: 'bot', text: '', reasoning: '', state: 'compacting',
          activity: [], sessionId: session.id })
        created.push(output)
        const prepared = await context.prepare(accountId, session.id, {
          system: prompt(accountId, focusDraftId, scheduled, config, authorization), tools: definitions, signal,
          currentMessageId: first.id, beforeModelCall, onProgress: (label) => {
            output.progress = label
            save(accountId, output)
          },
        })
        output.state = 'streaming'
        output.progress = '等待模型响应'
        output.protocol = signature(prepared.model)
        save(accountId, output)
        let flushedAt = 0
        beforeModelCall()
        const reply = await completion(turnSettings, prepared.messages, {
          tools: definitions, signal,
          onEvent(event) {
            if (event.type === 'reasoning') output.reasoning += event.delta
            if (event.type === 'text') output.text += event.delta
            output.progress = event.type === 'reasoning' ? '正在思考' : '正在回复'
            if (Date.now() - flushedAt > 180) {
              flushedAt = Date.now()
              save(accountId, output)
            }
          },
        })
        signal.throwIfAborted()
        output.text = reply.content || output.text
        output.reasoning = reply.reasoning_content || reply.reasoning || output.reasoning
        output.usage = reply.usage
        const { usage, reasoning, ...apiReply } = reply
        output.apiMessages = [apiReply]
        output.state = 'working'
        save(accountId, output)
        sessions.update(accountId, session.id, { usage: reply.usage, context: prepared.usage })
        for (const call of (reply.tool_calls || [])) {
          signal.throwIfAborted()
          const step = { id: call.id, name: call.function.name, state: 'running', at: Date.now(),
            arguments: call.function.arguments.slice(0, 4000) }
          output.activity.push(step)
          output.progress = `正在执行 ${call.function.name}`
          save(accountId, output)
          let result
          try {
            const input = JSON.parse(call.function.arguments)
            if (call.function.name === 'memory') {
              if (!config.memoryEnabled) throw new Error('长期记忆已关闭')
              if (input.operation === 'search') result = memory.list(accountId, input.query)
              else if (input.operation === 'save') {
                if (!config.autoRemember && !/记住|记一下|记下来|remember/i.test(text)) {
                  throw new Error('自动记忆已关闭，只有用户明确要求记住时才能保存')
                }
                result = memory.save(accountId, { ...input, sourceMessageId: first.id }, 'bot')
              } else if (input.operation === 'delete') {
                if (!/忘记|忘掉|删除.{0,12}记忆|清除.{0,12}记忆|forget/i.test(text)) {
                  throw new Error('只有用户明确要求忘记这条记忆时才能删除')
                }
                result = memory.remove(accountId, input.id)
              } else throw new Error('记忆操作无效')
            } else result = await operate(accountId, call.function.name, input, {
              scheduled, text, signal, created, focusDraftId, sessionId: session.id, currentMessageId: first.id,
              authorization, settings: turnSettings, beforeModelCall,
              progress: label => { output.progress = label; save(accountId, output) },
            })
            step.state = 'done'
          } catch (error) {
            if (signal.aborted) throw signal.reason
            console.warn('Bot 工具执行失败', call.function.name, error.name)
            result = { error: error instanceof SyntaxError ? '工具参数 JSON 无效' : error.message }
            step.state = 'error'
          }
          const availableTokens = Math.max(512, prepared.limits.input - estimate([...prepared.messages, ...output.apiMessages], definitions))
          const content = toolOutput(result, availableTokens)
          output.apiMessages.push({ role: 'tool', tool_call_id: call.id, content })
          step.result = content.slice(0, 4000)
          step.endedAt = Date.now()
          save(accountId, output)
        }
        output.state = 'done'
        output.progress = ''
        save(accountId, output)
        if (!reply.tool_calls?.length || created.some((item) => item.card && (['open', 'failed'].includes(item.card.state)
          || (item.card.action === 'draft.publish' && item.card.apiResult && (!authorization?.remaining
            || !['submitted','succeeded'].includes(item.card.apiResult.status)))))) {
          return { messages: created }
        }
      }
      created.push(say(accountId, { role: 'bot', state: 'done', sessionId: session.id,
        text: `已达到本轮 ${config.maxSteps} 次模型调用上限，已完成的结果已保留，可继续发送消息。` }))
      return { messages: created, limited: true }
    } catch (error) {
      if (output) {
        output.state = signal.aborted ? 'stopped' : 'error'
        output.progress = ''
        output.error = signal.aborted ? '已停止生成' : error.message
        for (const step of output.activity || []) {
          if (step.state === 'running') step.state = 'stopped'
        }
        save(accountId, output)
      }
      if (signal.aborted) return { messages: created, stopped: true }
      throw error
    } finally {
      if (authorization) authorization.active = false
      busy.delete(accountId)
      running.delete(accountId)
      controllers.delete(accountId)
      notify(accountId)
    }
  }
  async function sendScheduled(accountId, task) {
    while (busy.has(accountId)) {
      task.signal?.throwIfAborted()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    task.signal?.throwIfAborted()
    return send(accountId, { text: task.text, channel: 'schedule' }, task)
  }
  return {
    busy, running, track,
    send: (...args) => track(send(...args)),
    sendScheduled: (...args) => track(sendScheduled(...args)),
    stop(accountId) {
      controllers.get(accountId)?.abort(new Error('已停止生成'))
      return { stopping: busy.has(accountId) }
    },
    async close() {
      for (const controller of controllers.values()) controller.abort(new Error('应用正在关闭'))
      await Promise.allSettled([...pending])
    },
  }
}

module.exports = { createBotAgent }
