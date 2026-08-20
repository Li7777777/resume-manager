// 我要酥化：基于 /asu 技能的对话式经历酥化（LLM 使用 OpenAI 协议，配置在设置页）
import React, { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, Trash2, Loader2, Settings as SettingsIcon, Wand2, Square, Download } from 'lucide-react'
import { Button } from '../components/ui'
import { loadSettings } from '../settings'
import { useToast } from '../toast'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// 从回复文本中提取 JSON（优先 ```json 代码块，回退到裸 JSON）
function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const candidate = fence ? fence[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export default function Polish() {
  const toast = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    loadSettings()
      .then((s) => setLlmConfigured(!!s.llmApiKey))
      .catch(() => setLlmConfigured(false))
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/polish/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        let err = `HTTP ${res.status}`
        try {
          const d = await res.json()
          if (d?.error) err = d.error
        } catch {
          /* 保留 HTTP 状态 */
        }
        throw new Error(err)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      let finished = false
      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const data = t.slice(5).trim()
          if (data === '[DONE]') {
            finished = true
            break
          }
          try {
            const json = JSON.parse(data)
            if (json.error) {
              acc = acc ? `${acc}\n\n[错误] ${json.error}` : `[错误] ${json.error}`
              finished = true
              break
            }
            if (json.content) acc += json.content
            if (json.done) {
              finished = true
              break
            }
          } catch {
            /* 忽略非 JSON 行 */
          }
        }
        setMessages((ms) => {
          const copy = [...ms]
          copy[copy.length - 1] = { role: 'assistant', content: acc }
          return copy
        })
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setMessages((ms) => {
        const copy = [...ms]
        copy[copy.length - 1] = { role: 'assistant', content: `请求失败：${e?.message || e}` }
        return copy
      })
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()
  const clear = () => setMessages([])

  // 一键导出：从最后一条助手回复提取 JSON 并下载
  const exportJson = () => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)
    if (!last) return toast('warn', '暂无可导出的内容')
    const obj = extractJson(last.content)
    if (!obj) return toast('error', '未在回复中找到 JSON，请让模型输出 JSON 代码块')
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'project.json'
    a.click()
    URL.revokeObjectURL(url)
    toast('success', '已导出 project.json')
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <Wand2 size={18} className="text-indigo-400" /> 我要酥化
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">基于 /asu 技能，把真实经历改写成强定位、强证据的简历内容</p>
        </div>
        {messages.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={exportJson} disabled={streaming}>
              <Download size={13} /> 导出 JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={clear} disabled={streaming}>
              <Trash2 size={13} /> 清空对话
            </Button>
          </div>
        )}
      </div>

      {llmConfigured === false && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <SettingsIcon size={13} className="shrink-0" />
          <span>尚未配置 LLM，请先到「设置」页填写 OpenAI 协议的 API Key 与模型。</span>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
            <Sparkles size={28} className="text-indigo-400/70" />
            <p className="text-sm text-zinc-400">输入目标岗位和一段经历，开始酥化</p>
            <p className="max-w-md text-xs leading-relaxed text-zinc-600">
              例如：「目标岗位：AI Agent 应用开发。经历：用 Django 写了一个面向家庭食物管理的 Agent 应用」
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user' ? 'bg-indigo-500/20 text-indigo-100' : 'bg-zinc-800/80 text-zinc-200'
                }`}
              >
                {m.content || (streaming && i === messages.length - 1 ? <Loader2 size={14} className="animate-spin" /> : '')}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          disabled={streaming}
          placeholder="输入目标岗位 + 原始经历，Enter 发送，Shift+Enter 换行"
          rows={3}
          className="min-h-[46px] flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 disabled:opacity-50"
        />
        {streaming ? (
          <Button onClick={stop}>
            <Square size={14} /> 停止
          </Button>
        ) : (
          <Button variant="primary" onClick={send} disabled={!input.trim()}>
            <Send size={14} /> 发送
          </Button>
        )}
      </div>
    </div>
  )
}
