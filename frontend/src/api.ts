import { parseEventStream, type AssistantEvent, type ChatMessage } from './assistant.ts'
import type { Project, StoryNode } from './model.ts'

export class RequestCancelled extends Error {
  constructor() {
    super('请求已取消')
    this.name = 'RequestCancelled'
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      headers: options?.body
        ? { 'Content-Type': 'application/json', ...options.headers }
        : options?.headers,
    })
  } catch (reason) {
    if (options?.signal?.aborted) throw new RequestCancelled()
    throw reason instanceof Error ? new Error('无法连接服务，请检查网络后重试') : reason
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? '请求失败，请稍后重试')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  body: JSON.stringify(body),
  signal,
})

export const api = {
  aiStatus: () => request<{ enabled: boolean }>('/api/ai/status'),

  listProjects: () => request<Project[]>('/api/projects'),
  getProject: (projectId: string) => request<Project>(`/api/projects/${projectId}`),
  createProject: (name: string) => request<Project>('/api/projects', json('POST', { name })),
  renameProject: (projectId: string, name: string) =>
    request<Project>(`/api/projects/${projectId}`, json('PATCH', { name })),
  deleteProject: (projectId: string) =>
    request<void>(`/api/projects/${projectId}`, { method: 'DELETE' }),

  createNode: (projectId: string, body: { name: string; kind: string; parentId?: string; afterId?: string }) =>
    request<StoryNode>(`/api/projects/${projectId}/nodes`, json('POST', body)),
  renameNode: (projectId: string, nodeId: string, name: string) =>
    request<StoryNode>(`/api/projects/${projectId}/nodes/${nodeId}`, json('PATCH', { name })),
  deleteNode: (projectId: string, nodeId: string) =>
    request<void>(`/api/projects/${projectId}/nodes/${nodeId}`, { method: 'DELETE' }),
  reorderNodes: (projectId: string, body: { nodeId: string; parentId: string; nodeIds: string[] }) =>
    request<void>(`/api/projects/${projectId}/nodes/order`, json('PUT', body)),

  replaceNodes: (projectId: string, nodes: StoryNode[]) =>
    request<Project>(`/api/projects/${projectId}/nodes`, json('PUT', { nodes })),

  /** Runs one assistant turn, calling onEvent for each streamed event until the turn ends. */
  async chat(
    projectId: string,
    body: { messages: ChatMessage[]; input: string },
    onEvent: (event: AssistantEvent) => void,
    signal: AbortSignal,
  ) {
    let response: Response
    try {
      response = await fetch(`/api/projects/${projectId}/assistant/chat`, {
        ...json('POST', body, signal),
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      })
    } catch (reason) {
      if (signal.aborted) throw new RequestCancelled()
      throw reason instanceof Error ? new Error('无法连接服务，请检查网络后重试') : reason
    }
    if (!response.ok || !response.body) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(error?.error ?? 'AI 助手暂时不可用，请稍后重试')
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const parsed = parseEventStream(buffer + value)
        buffer = parsed.rest
        parsed.events.forEach(onEvent)
      }
    } catch (reason) {
      if (signal.aborted) throw new RequestCancelled()
      throw reason instanceof Error ? new Error('与 AI 助手的连接中断') : reason
    }
  },
}
