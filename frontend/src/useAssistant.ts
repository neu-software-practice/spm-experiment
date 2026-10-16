import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, RequestCancelled } from '@/api'
import {
  applyEvent,
  changedIds,
  emptyConversation,
  finishTurn,
  forgetConversation,
  loadConversation,
  saveConversation,
  type AssistantEvent,
  type ChatMessage,
  type Conversation,
  type Turn,
} from '@/assistant'
import type { Project, StoryNode } from '@/model'

const undoNote = '（我撤销了你上一轮对地图的全部修改，地图已恢复到那一轮之前的状态。）'

/** The text the assistant streamed in a turn, for history when the turn never completed. */
function partialReply(turn: Turn) {
  return turn.blocks.flatMap((block) => block.type === 'text' ? [block.text] : []).join('').trim()
}

/**
 * Owns the assistant conversation of one project: streaming a turn, folding its events
 * into the display, keeping the provider-format history, and undoing the latest turn.
 */
export function useAssistant({
  projectId,
  nodes,
  onProject,
  onChanged,
  onReload,
}: {
  projectId?: string
  nodes: StoryNode[]
  /** The map after a tool changed it, or after an undo. */
  onProject: (project: Project) => void
  /** Node IDs a tool just created or changed, for highlighting. */
  onChanged: (ids: string[]) => void
  /** Re-fetch the project when a turn ended without a final state. */
  onReload: (projectId: string) => void
}) {
  const [state, setState] = useState(() => ({
    projectId,
    conversation: projectId ? loadConversation(projectId) : emptyConversation,
  }))
  // Switching projects swaps in that project's saved conversation during render.
  if (state.projectId !== projectId) {
    setState({ projectId, conversation: projectId ? loadConversation(projectId) : emptyConversation })
  }
  const conversation = state.conversation
  const setConversation = (update: (current: Conversation) => Conversation) =>
    setState((current) => ({ ...current, conversation: update(current.conversation) }))
  const [streaming, setStreaming] = useState(false)
  const controller = useRef<AbortController>(undefined)
  // Bumped when the conversation is replaced, so a turn still unwinding leaves it alone.
  const epoch = useRef(0)
  // Event handlers outlive the render that started a turn; read callbacks through a ref.
  const latest = useRef({ nodes, onProject, onChanged, onReload })
  useLayoutEffect(() => {
    latest.current = { nodes, onProject, onChanged, onReload }
  })

  useEffect(() => {
    epoch.current += 1
    controller.current?.abort()
  }, [projectId])

  useEffect(() => {
    if (state.projectId) saveConversation(state.projectId, state.conversation)
  }, [state])

  useEffect(() => () => controller.current?.abort(), [])

  const updateTurn = (id: string, update: (turn: Turn) => Turn) =>
    setConversation((current) => ({ ...current, turns: current.turns.map((turn) => turn.id === id ? update(turn) : turn) }))

  const send = async (input: string) => {
    const text = input.trim()
    if (!projectId || !text || streaming) return
    const turn: Turn = { id: crypto.randomUUID(), input: text, blocks: [], status: 'streaming', before: latest.current.nodes, changed: false }
    const history = conversation.history
    const abort = new AbortController()
    controller.current = abort
    setStreaming(true)
    setConversation((current) => ({ ...current, turns: [...current.turns, turn] }))

    const ownEpoch = epoch.current
    const current = () => epoch.current === ownEpoch
    let settled = false
    let shown = turn
    const settle = (messages: ChatMessage[], status: 'done' | 'error' | 'stopped', error?: string) => {
      settled = true
      if (!current()) return
      shown = finishTurn(shown, status, error)
      const ended = shown
      setConversation((current) => ({
        history: [...current.history, ...messages],
        turns: current.turns.map((item) => item.id === ended.id ? ended : item),
      }))
    }
    const onEvent = (event: AssistantEvent) => {
      if (abort.signal.aborted || !current()) return
      switch (event.event) {
        case 'project':
          latest.current.onProject(event.data)
          shown = { ...shown, changed: true }
          break
        case 'done':
          settle(event.data.messages, 'done')
          return
        case 'error':
          settle(event.data.messages ?? [], 'error', event.data.error)
          return
        default:
          shown = applyEvent(shown, event)
      }
      const ids = changedIds(event)
      if (ids.length > 0) latest.current.onChanged(ids)
      const snapshot = shown
      updateTurn(turn.id, () => snapshot)
    }

    try {
      await api.chat(projectId, { messages: history, input: text }, onEvent, abort.signal)
      if (!settled) throw new Error('与 AI 助手的连接中断')
    } catch (reason) {
      if (!settled && current()) {
        // Completed steps were not reported; keep the request and any streamed text so the
        // model still sees what was asked, and re-read the map the tools may have changed.
        const cancelled = reason instanceof RequestCancelled
        const fallback: ChatMessage[] = [
          { role: 'user', content: text },
          { role: 'assistant', content: partialReply(shown) || (cancelled ? '（回复被用户中断）' : '（回复中断）') },
        ]
        settle(fallback, cancelled ? 'stopped' : 'error', cancelled ? undefined : reason instanceof Error ? reason.message : '发生未知错误')
        latest.current.onReload(projectId)
      }
    } finally {
      if (controller.current === abort) controller.current = undefined
      setStreaming(false)
    }
  }

  const stop = () => controller.current?.abort()

  const undo = async (turnId: string) => {
    const turn = conversation.turns.find((item) => item.id === turnId)
    if (!projectId || !turn?.before) return
    const restored = await api.replaceNodes(projectId, turn.before)
    latest.current.onProject(restored)
    setConversation((current) => ({
      history: [...current.history, { role: 'user', content: undoNote }],
      turns: current.turns.map((item) => item.id === turnId ? { ...item, undone: true } : item),
    }))
  }

  const reset = () => {
    epoch.current += 1
    controller.current?.abort()
    if (projectId) forgetConversation(projectId)
    setConversation(() => emptyConversation)
  }

  return { turns: conversation.turns, streaming, send, stop, undo, reset }
}
