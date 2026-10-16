import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Spinner, Text, Textarea } from '@fluentui/react-components'
import {
  Add16Regular,
  ArrowClockwise16Regular,
  ArrowSwap16Regular,
  ArrowUndo16Regular,
  ArrowUp20Filled,
  BrainSparkle16Regular,
  ChatAdd20Regular,
  Checkmark12Filled,
  ChevronDown12Regular,
  Delete16Regular,
  Dismiss20Regular,
  Edit16Regular,
  ErrorCircle16Regular,
  Lightbulb16Regular,
  Map16Regular,
  Sparkle16Filled,
  Sparkle24Filled,
  Stop16Filled,
} from '@fluentui/react-icons'
import { toolLabels, type Turn, type TurnBlock } from '@/assistant'
import { Markdown } from '@/components/Markdown'
import { charCount } from '@/model'

const maxInput = 4000

const toolIcons: Record<string, ReactElement> = {
  view_map: <Map16Regular />,
  add_nodes: <Add16Regular />,
  rename_node: <Edit16Regular />,
  delete_nodes: <Delete16Regular />,
  move_node: <ArrowSwap16Regular />,
}

const toolProgress: Record<string, string> = {
  view_map: '正在读取地图…',
  add_nodes: '正在写入节点…',
  rename_node: '正在重命名…',
  delete_nodes: '正在删除…',
  move_node: '正在调整位置…',
}

function ReasoningBlock({ block, live }: { block: Extract<TurnBlock, { type: 'reasoning' }>; live: boolean }) {
  const [open, setOpen] = useState(false)
  const thinking = live && !block.done
  return (
    <div className={`assistant-reasoning${thinking ? ' is-live' : ''}`}>
      <button type="button" className="assistant-reasoning-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <BrainSparkle16Regular />
        <span className={thinking ? 'shimmer-text' : undefined}>{thinking ? '正在思考' : '思考过程'}</span>
        <ChevronDown12Regular className="assistant-chevron" />
      </button>
      {open && <div className="assistant-reasoning-text">{block.text.trim()}</div>}
    </div>
  )
}

function ToolBlock({ block }: { block: Extract<TurnBlock, { type: 'tool' }> }) {
  const active = block.status === 'pending' || block.status === 'running'
  return (
    <div className={`assistant-tool is-${block.status}`} data-tool={block.name}>
      <span className="assistant-tool-icon">{toolIcons[block.name] ?? <Sparkle16Filled />}</span>
      <div className="assistant-tool-body">
        <div className="assistant-tool-title">
          <Text weight="semibold" size={200}>{toolLabels[block.name] ?? block.name}</Text>
          <span className="assistant-tool-state" aria-hidden="true">
            {active && <Spinner size="extra-tiny" />}
            {block.status === 'done' && <Checkmark12Filled className="assistant-tool-check" />}
            {block.status === 'error' && <ErrorCircle16Regular />}
          </span>
        </div>
        <Text size={200} className="assistant-tool-detail">
          {block.status === 'pending' && '正在准备参数…'}
          {block.status === 'running' && (toolProgress[block.name] ?? '正在执行…')}
          {block.status === 'done' && block.summary}
          {block.status === 'error' && (block.error || '执行失败')}
        </Text>
        {active && <span className="assistant-tool-progress" aria-hidden="true" />}
      </div>
    </div>
  )
}

function TurnView({ turn, undoable, onUndo, onRetry }: {
  turn: Turn
  undoable: boolean
  onUndo: () => void
  onRetry: () => void
}) {
  const live = turn.status === 'streaming'
  const lastText = turn.blocks.findLastIndex((block) => block.type === 'text')
  const [undoing, setUndoing] = useState(false)
  return (
    <div className="assistant-turn">
      <div className="assistant-user"><Text>{turn.input}</Text></div>
      <div className="assistant-reply">
        <span className={`assistant-avatar${live ? ' is-live' : ''}`} aria-hidden="true"><Sparkle16Filled /></span>
        <div className="assistant-reply-body">
          {turn.blocks.map((block, index) => {
            if (block.type === 'reasoning') return <ReasoningBlock key={index} block={block} live={live} />
            if (block.type === 'tool') return <ToolBlock key={block.key} block={block} />
            return (
              <div key={index} className={`assistant-text${live && index === lastText && index === turn.blocks.length - 1 ? ' is-typing' : ''}`}>
                <Markdown text={block.text} />
              </div>
            )
          })}
          {live && turn.retrying && (
            <Text size={200} className="assistant-note assistant-retry">
              <Spinner size="extra-tiny" />连接不稳定，正在重试（第 {turn.retrying} 次）…
            </Text>
          )}
          {live && turn.blocks.length === 0 && !turn.retrying && (
            <div className="assistant-waiting" aria-label="等待回复"><span /><span /><span /></div>
          )}
          {turn.status === 'stopped' && <Text size={200} className="assistant-note">已停止</Text>}
          {turn.status === 'error' && (
            <div className="assistant-error">
              <ErrorCircle16Regular />
              <Text size={200}>{turn.error}</Text>
              <Button size="small" appearance="transparent" icon={<ArrowClockwise16Regular />} onClick={onRetry}>重新编辑</Button>
            </div>
          )}
          {turn.undone && <Text size={200} className="assistant-note">已撤销本轮对地图的修改</Text>}
          {undoable && (
            <Button
              size="small"
              appearance="subtle"
              className="assistant-undo"
              icon={undoing ? <Spinner size="extra-tiny" /> : <ArrowUndo16Regular />}
              disabled={undoing}
              onClick={() => {
                setUndoing(true)
                Promise.resolve(onUndo()).finally(() => setUndoing(false))
              }}
            >
              撤销本轮修改
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function AssistantPanel({
  projectName,
  aiEnabled,
  turns,
  streaming,
  undoableId,
  draft,
  suggestions,
  onDraftChange,
  onSend,
  onStop,
  onUndo,
  onReset,
  onClose,
}: {
  projectName?: string
  aiEnabled?: boolean
  turns: Turn[]
  streaming: boolean
  undoableId?: string
  draft: string
  suggestions: string[]
  onDraftChange: (draft: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onUndo: (turnId: string) => Promise<void>
  onReset: () => void
  onClose: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)
  const tooLong = charCount(draft) > maxInput
  const canSend = Boolean(aiEnabled) && !streaming && Boolean(draft.trim()) && !tooLong

  // Follow the stream unless the reader scrolled up to look at something.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [turns])

  // Focus the box when the panel opens, after sending, and when a draft is handed in.
  const draftEmpty = draft === ''
  useEffect(() => {
    input.current?.focus()
  }, [draftEmpty])

  const submit = () => {
    if (!canSend) return
    pinned.current = true
    onSend(draft)
    onDraftChange('')
  }

  return (
    <aside className="assistant-panel" aria-label="AI 助手">
      <header className="assistant-header">
        <span className="assistant-mark" aria-hidden="true"><Sparkle16Filled /></span>
        <div className="assistant-heading">
          <Text weight="semibold">AI 助手</Text>
          <Text size={200} className="muted-text">{projectName ? `正在打磨「${projectName}」` : '与 AI 一起规划故事地图'}</Text>
        </div>
        <Button appearance="subtle" icon={<ChatAdd20Regular />} aria-label="新对话" title="新对话" onClick={onReset} disabled={turns.length === 0} />
        <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="收起助手" title="收起助手" onClick={onClose} />
      </header>

      <div
        className="assistant-scroll"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
        }}
      >
        {turns.length === 0 ? (
          <div className="assistant-empty">
            <span className="assistant-empty-mark" aria-hidden="true"><Sparkle24Filled /></span>
            <Text as="h2" weight="semibold" size={400}>聊聊你的产品</Text>
            <Text size={200} className="muted-text">
              描述产品和用户，我会和你一起梳理角色、史诗与用户故事，并直接写进地图。之后可以继续追问、调整和打磨。
            </Text>
            {aiEnabled === false ? (
              <div className="assistant-error"><ErrorCircle16Regular /><Text size={200}>后端尚未配置 AI 服务，请设置 AI_API_KEY 与 AI_MODEL 后重启。</Text></div>
            ) : (
              <div className="assistant-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className="assistant-suggestion" onClick={() => onDraftChange(suggestion)}>
                    <Lightbulb16Regular />
                    <span>{suggestion}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              undoable={turn.id === undoableId}
              onUndo={() => onUndo(turn.id)}
              onRetry={() => onDraftChange(turn.input)}
            />
          ))
        )}
      </div>

      <form
        className={`assistant-composer${streaming ? ' is-busy' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Textarea
          ref={input}
          className="assistant-input"
          appearance="filled-lighter"
          resize="none"
          value={draft}
          disabled={aiEnabled === false}
          placeholder={streaming ? 'AI 正在处理…' : '描述想法，或让我修改地图（Enter 发送，Shift+Enter 换行）'}
          onChange={(_event, data) => onDraftChange(data.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          rows={Math.min(6, Math.max(2, draft.split('\n').length))}
        />
        <div className="assistant-composer-bar">
          <Text size={100} className={tooLong ? 'assistant-limit is-over' : 'assistant-limit'}>
            {tooLong ? `超出 ${charCount(draft) - maxInput} 字` : '修改会直接保存，可撤销最近一轮'}
          </Text>
          {streaming ? (
            <Button type="button" shape="circular" className="assistant-stop" icon={<Stop16Filled />} aria-label="停止" title="停止" onClick={onStop} />
          ) : (
            <Button type="submit" shape="circular" appearance="primary" className="assistant-send" icon={<ArrowUp20Filled />} aria-label="发送" title="发送" disabled={!canSend} />
          )}
        </div>
      </form>
    </aside>
  )
}
