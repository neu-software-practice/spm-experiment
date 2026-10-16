import type { StoryNode } from './model.ts'

/** One OpenAI-format message; the server owns the shape, the client only keeps and resends it. */
export type ChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export type ToolStatus = 'pending' | 'running' | 'done' | 'error'

export type TurnBlock =
  | { type: 'reasoning'; text: string; done: boolean }
  | { type: 'text'; text: string }
  | { type: 'tool'; key: string; name: string; status: ToolStatus; summary?: string; error?: string }

export type TurnStatus = 'streaming' | 'done' | 'error' | 'stopped'

/** What the panel shows for one user message and everything the assistant did in reply. */
export type Turn = {
  id: string
  input: string
  blocks: TurnBlock[]
  status: TurnStatus
  error?: string
  /** The map before this turn changed it; kept so the latest turn can be undone. */
  before?: StoryNode[]
  changed: boolean
  undone?: boolean
  /** Set while the server retries a dropped model call. */
  retrying?: number
}

export type Conversation = { history: ChatMessage[]; turns: Turn[] }

export type AssistantEvent =
  | { event: 'start'; data: Record<string, never> }
  | { event: 'reasoning' | 'text'; data: { text: string } }
  | { event: 'tool_pending'; data: { key: string; name: string } }
  | { event: 'retry'; data: { attempt: number } }
  | { event: 'tool_start'; data: { key: string; name: string; args: unknown } }
  | { event: 'tool_end'; data: { key: string; name: string; ok: boolean; summary: string; error: string; changedIds: string[] | null } }
  | { event: 'project'; data: { id: string; name: string; nodes: StoryNode[] } }
  | { event: 'done'; data: { messages: ChatMessage[] } }
  | { event: 'error'; data: { error: string; messages: ChatMessage[] | null } }

export const toolLabels: Record<string, string> = {
  view_map: '查看地图',
  add_nodes: '新增节点',
  rename_node: '重命名',
  delete_nodes: '删除节点',
  move_node: '调整位置',
}

export const emptyConversation: Conversation = { history: [], turns: [] }

/**
 * Splits a server-sent event stream into events. Returns the parsed events and the
 * unterminated tail to prepend to the next chunk.
 */
export function parseEventStream(buffer: string): { events: AssistantEvent[]; rest: string } {
  const events: AssistantEvent[] = []
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = frames.pop() ?? ''
  for (const frame of frames) {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length === 0) continue
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) } as AssistantEvent)
    } catch {
      // A malformed frame is skipped rather than ending the turn.
    }
  }
  return { events, rest }
}

function closeReasoning(blocks: TurnBlock[]) {
  return blocks.map((block) => block.type === 'reasoning' && !block.done ? { ...block, done: true } : block)
}

/** Folds one streamed event into the turn being displayed. */
export function applyEvent(current: Turn, event: AssistantEvent): Turn {
  if (event.event === 'retry') {
    // The model call restarts: drop what it streamed since the last tool that ran.
    const kept = current.blocks.findLastIndex((block) => block.type === 'tool' && (block.status === 'done' || block.status === 'error'))
    return { ...current, blocks: current.blocks.slice(0, kept + 1), retrying: event.data.attempt }
  }
  const turn = current.retrying ? { ...current, retrying: undefined } : current
  const blocks = turn.blocks
  const last = blocks.at(-1)
  switch (event.event) {
    case 'reasoning':
      if (last?.type === 'reasoning' && !last.done) {
        return { ...turn, blocks: [...blocks.slice(0, -1), { ...last, text: last.text + event.data.text }] }
      }
      return { ...turn, blocks: [...blocks, { type: 'reasoning', text: event.data.text, done: false }] }
    case 'text': {
      const closed = closeReasoning(blocks)
      const tail = closed.at(-1)
      if (tail?.type === 'text') {
        return { ...turn, blocks: [...closed.slice(0, -1), { ...tail, text: tail.text + event.data.text }] }
      }
      return { ...turn, blocks: [...closed, { type: 'text', text: event.data.text }] }
    }
    case 'tool_pending':
      return { ...turn, blocks: [...closeReasoning(blocks), { type: 'tool', key: event.data.key, name: event.data.name, status: 'pending' }] }
    case 'tool_start':
    case 'tool_end': {
      const update = (block: TurnBlock): TurnBlock => {
        if (block.type !== 'tool' || block.key !== event.data.key) return block
        if (event.event === 'tool_start') return { ...block, status: 'running' }
        return { ...block, status: event.data.ok ? 'done' : 'error', summary: event.data.summary, error: event.data.error }
      }
      const known = blocks.some((block) => block.type === 'tool' && block.key === event.data.key)
      const withTool = known
        ? blocks
        : [...closeReasoning(blocks), { type: 'tool' as const, key: event.data.key, name: event.data.name, status: 'pending' as const }]
      return { ...turn, blocks: withTool.map(update) }
    }
    default:
      return turn
  }
}

/** Ends a turn; tools still in flight when it stopped are shown as interrupted. */
export function finishTurn(turn: Turn, status: Exclude<TurnStatus, 'streaming'>, error?: string): Turn {
  return {
    ...turn,
    retrying: undefined,
    status,
    error,
    blocks: closeReasoning(turn.blocks).map((block) =>
      block.type === 'tool' && (block.status === 'pending' || block.status === 'running')
        ? { ...block, status: 'error', error: '已中断' }
        : block),
  }
}

/** The latest turn that changed the map can be undone, as long as nothing came after it. */
export function undoableTurnId(turns: Turn[]) {
  const last = turns.at(-1)
  return last && last.status !== 'streaming' && last.changed && !last.undone && last.before ? last.id : undefined
}

/** Node IDs a tool reported as created or changed. */
export function changedIds(event: AssistantEvent) {
  return event.event === 'tool_end' && event.data.ok ? event.data.changedIds ?? [] : []
}

const storageKey = (projectId: string) => `spm:assistant:${projectId}`

export function loadConversation(projectId: string): Conversation {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return emptyConversation
    const parsed = JSON.parse(raw) as Conversation
    if (!Array.isArray(parsed.history) || !Array.isArray(parsed.turns)) return emptyConversation
    // A turn cut off by a reload is no longer streaming.
    return { history: parsed.history, turns: parsed.turns.map((turn) => turn.status === 'streaming' ? finishTurn(turn, 'stopped') : turn) }
  } catch {
    return emptyConversation
  }
}

export function saveConversation(projectId: string, conversation: Conversation) {
  try {
    if (conversation.turns.length === 0) window.localStorage.removeItem(storageKey(projectId))
    else window.localStorage.setItem(storageKey(projectId), JSON.stringify(conversation))
  } catch {
    // Storage is a convenience; a full or blocked store just loses history on reload.
  }
}

export function forgetConversation(projectId: string) {
  try {
    window.localStorage.removeItem(storageKey(projectId))
  } catch {
    // Nothing to clean up.
  }
}
