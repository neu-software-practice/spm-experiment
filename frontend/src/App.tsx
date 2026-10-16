import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Divider,
  FluentProvider,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Skeleton,
  SkeletonItem,
  Text,
  webLightTheme,
} from '@fluentui/react-components'
import {
  Add20Regular,
  Board20Regular,
  Delete20Regular,
  Edit20Regular,
  MoreHorizontal20Regular,
  Navigation20Regular,
} from '@fluentui/react-icons'
import type { DragEndEvent } from '@dnd-kit/core'
import { api, RequestCancelled, type GenerateOptions } from '@/api'
import { CreateDialog, DeleteDialog, RenameProjectDialog } from '@/components/Dialogs'
import { NodeSheet } from '@/components/NodeSheet'
import { ProjectSidebar } from '@/components/ProjectSidebar'
import { StoryMap } from '@/components/StoryMap'
import {
  childKinds,
  childrenOf,
  countByKind,
  descendantIds,
  describeLevelCounts,
  moveNode,
  nodeKinds,
  parentKinds,
  planReorder,
  type CreateTarget,
  type DeleteTarget,
  type Project,
  type StoryNode,
} from '@/model'
import { insertAfter } from '@/node-order'
import './App.css'

type Notice = { intent: 'error' | 'success'; title: string; message: string }

const lastProjectKey = 'spm:lastProject'
const freshHighlightMs = 2400

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const [createTarget, setCreateTarget] = useState<CreateTarget>()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>()
  const [renameProjectOpen, setRenameProjectOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [aiEnabled, setAIEnabled] = useState<boolean>()
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set())
  const noticeTimer = useRef<number>(undefined)
  const generation = useRef<AbortController>(undefined)

  const nodes = project?.nodes ?? []
  const selectedNode = nodes.find((node) => node.id === selectedId)
  const nodesByKind = useMemo(() => {
    const all = project?.nodes ?? []
    return Object.fromEntries(
      nodeKinds.map((kind) => [kind, all.filter((node) => node.kind === kind)]),
    ) as Record<StoryNode['kind'], StoryNode[]>
  }, [project])

  const notify = (next: Notice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(next)
    noticeTimer.current = window.setTimeout(() => setNotice(undefined), 4000)
  }

  const showError = (reason: unknown) => {
    notify({ intent: 'error', title: '操作失败', message: reason instanceof Error ? reason.message : '发生未知错误' })
  }

  const loadProject = async (projectId: string) => {
    try {
      const result = await api.getProject(projectId)
      setProject(result)
      setSelectedId(undefined)
      window.localStorage.setItem(lastProjectKey, projectId)
    } catch (reason) {
      showError(reason)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const result = await api.listProjects()
        setProjects(result)
        const remembered = window.localStorage.getItem(lastProjectKey)
        const first = result.find((item) => item.id === remembered) ?? result[0]
        if (first) await loadProject(first.id)
      } catch (reason) {
        showError(reason)
      } finally {
        setLoading(false)
      }
    }
    void load()
    // AI is optional: a failed status check just keeps the AI entry points disabled.
    api.aiStatus().then(({ enabled }) => setAIEnabled(enabled), () => setAIEnabled(false))
  }, [])

  const createItem = async (name: string, parentId?: string) => {
    if (!createTarget) return
    setBusy(true)
    try {
      if (createTarget.kind === 'project') {
        const created = await api.createProject(name)
        setProjects((current) => [...current, created])
        setProject(created)
        setSelectedId(undefined)
        window.localStorage.setItem(lastProjectKey, created.id)
      } else if (project) {
        const created = await api.createNode(project.id, {
          name,
          kind: createTarget.kind,
          parentId,
          afterId: createTarget.afterId,
        })
        setProject({
          ...project,
          nodes: insertAfter(project.nodes, created, createTarget.afterId),
        })
        setSelectedId(created.id)
      }
      setCreateTarget(undefined)
    } catch (reason) {
      showError(reason)
    } finally {
      setBusy(false)
    }
  }

  const generateChildren = async (parentId: string, options: GenerateOptions) => {
    if (!project) return
    const projectId = project.id
    const controller = new AbortController()
    generation.current = controller
    setBusy(true)
    try {
      const result = await api.generateChildren(projectId, parentId, options, controller.signal)
      // The backend appends the batch after the parent's existing children.
      setProject((current) => current?.id === projectId
        ? { ...current, nodes: [...current.nodes, ...result.nodes] }
        : current)
      const ids = new Set(result.nodes.map((node) => node.id))
      setFreshIds(ids)
      window.setTimeout(() => setFreshIds((current) => current === ids ? new Set() : current), freshHighlightMs)
      setCreateTarget(undefined)
      notify({
        intent: 'success',
        title: 'AI 生成完成',
        message: `已新增 ${describeLevelCounts(countByKind(result.nodes)) || '0 个节点'}。`,
      })
    } catch (reason) {
      if (reason instanceof RequestCancelled) {
        // The server may have finished before the abort arrived; reload to show what was saved.
        void loadProject(projectId)
      } else {
        showError(reason)
      }
    } finally {
      if (generation.current === controller) generation.current = undefined
      setBusy(false)
    }
  }

  const closeCreateDialog = () => {
    generation.current?.abort()
    setCreateTarget(undefined)
  }

  const renameNode = async (name: string) => {
    if (!project || !selectedNode) return
    setBusy(true)
    try {
      const updated = await api.renameNode(project.id, selectedNode.id, name)
      setProject({ ...project, nodes: project.nodes.map((node) => node.id === updated.id ? updated : node) })
    } catch (reason) {
      showError(reason)
    } finally {
      setBusy(false)
    }
  }

  const deleteNode = async (node: StoryNode) => {
    if (!project) return
    setBusy(true)
    try {
      await api.deleteNode(project.id, node.id)
      const removed = descendantIds(project.nodes, node.id)
      setProject({ ...project, nodes: project.nodes.filter((item) => !removed.has(item.id)) })
      setSelectedId(undefined)
      setDeleteTarget(undefined)
    } catch (reason) {
      showError(reason)
    } finally {
      setBusy(false)
    }
  }

  const renameProject = async (name: string) => {
    if (!project) return
    setBusy(true)
    try {
      const updated = await api.renameProject(project.id, name)
      setProject({ ...project, name: updated.name })
      setProjects((current) => current.map((item) => item.id === updated.id ? { ...item, name } : item))
      setRenameProjectOpen(false)
    } catch (reason) {
      showError(reason)
    } finally {
      setBusy(false)
    }
  }

  const deleteProject = async () => {
    if (!project) return
    setBusy(true)
    try {
      await api.deleteProject(project.id)
      const remaining = projects.filter((item) => item.id !== project.id)
      setProjects(remaining)
      setDeleteTarget(undefined)
      if (remaining[0]) await loadProject(remaining[0].id)
      else setProject(null)
    } catch (reason) {
      showError(reason)
    } finally {
      setBusy(false)
    }
  }

  const reorderNodes = async ({ active, over }: DragEndEvent) => {
    if (!project || !over || sorting) return
    const plan = planReorder(project.nodes, String(active.id), String(over.id))
    if (!plan) return

    const previous = project
    setProject({ ...project, nodes: moveNode(project.nodes, plan.nodeId, plan.parentId, plan.nodeIds) })
    setSorting(true)
    try {
      await api.reorderNodes(project.id, plan)
    } catch (reason) {
      setProject((current) => current?.id === previous.id ? previous : current)
      showError(reason)
    } finally {
      setSorting(false)
    }
  }

  const createParentKind = createTarget && createTarget.kind !== 'project'
    ? parentKinds[createTarget.kind]
    : undefined
  const createParents = createParentKind ? nodesByKind[createParentKind] : []
  const countChildren = (parentId: string) => {
    const parent = nodes.find((node) => node.id === parentId)
    const kind = parent && childKinds[parent.kind]
    return kind ? childrenOf(nodes, parentId, kind).length : 0
  }

  return (
    <FluentProvider theme={webLightTheme} className="fluent-root">
      <div className="app-shell">
        <ProjectSidebar
          projects={projects}
          activeId={project?.id}
          open={sidebarOpen}
          aiEnabled={aiEnabled}
          onSelect={(id) => id !== project?.id && void loadProject(id)}
          onCreate={() => setCreateTarget({ kind: 'project' })}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="workspace">
          <header className="command-bar">
            <Button
              appearance="subtle"
              icon={<Navigation20Regular />}
              className="nav-toggle"
              aria-label="打开项目导航"
              title="打开项目导航"
              onClick={() => setSidebarOpen(true)}
            />
            <Divider vertical className="command-divider" />
            <div className="command-title">
              <Text as="h1" weight="semibold">{project?.name ?? '用户故事地图'}</Text>
              {project && <Text size={200}>用户故事地图</Text>}
            </div>
            {project && (
              <div className="command-actions">
                <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreateTarget({ kind: 'role' })}>
                  新增角色
                </Button>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="项目操作" title="项目操作" />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem icon={<Edit20Regular className="icon-edit" />} onClick={() => setRenameProjectOpen(true)}>重命名项目</MenuItem>
                      <MenuDivider />
                      <MenuItem icon={<Delete20Regular />} className="danger-menu-item" onClick={() => setDeleteTarget({ type: 'project', name: project.name })}>
                        删除项目
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </div>
            )}
          </header>

          {loading ? (
            <Skeleton className="loading-grid" aria-label="正在加载项目">
              {Array.from({ length: 8 }, (_, index) => <SkeletonItem key={index} className="loading-card" />)}
            </Skeleton>
          ) : !project ? (
            <div className="empty-state">
              <span className="empty-icon"><Board20Regular /></span>
              <div><h2>暂无项目</h2><p>新建项目以开始规划。</p></div>
              <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreateTarget({ kind: 'project' })}>新建项目</Button>
            </div>
          ) : nodesByKind.role.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon"><Board20Regular /></span>
              <div>
                <h2>暂无角色</h2>
                <p>先创建角色，再逐层添加史诗和用户故事。</p>
              </div>
              <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreateTarget({ kind: 'role' })}>新建第一个角色</Button>
            </div>
          ) : (
            <StoryMap
              roles={nodesByKind.role}
              nodes={nodes}
              selectedId={selectedId}
              freshIds={freshIds}
              sorting={sorting}
              aiEnabled={Boolean(aiEnabled)}
              onSelect={(node) => setSelectedId(node.id)}
              onCreate={setCreateTarget}
              onReorder={(event) => void reorderNodes(event)}
            />
          )}
        </main>

        {selectedNode && (
          <NodeSheet
            key={selectedNode.id}
            node={selectedNode}
            parent={nodes.find((node) => node.id === selectedNode.parentId)}
            childCount={countChildren(selectedNode.id)}
            aiEnabled={Boolean(aiEnabled)}
            busy={busy}
            onClose={() => setSelectedId(undefined)}
            onSave={renameNode}
            onDelete={() => setDeleteTarget({ type: 'node', node: selectedNode })}
            onGenerate={() => {
              const kind = childKinds[selectedNode.kind]
              if (!kind) return
              setSelectedId(undefined)
              setCreateTarget({ kind, parentId: selectedNode.id, mode: 'ai' })
            }}
          />
        )}

        <CreateDialog
          key={createTarget ? `${createTarget.kind}-${createTarget.parentId ?? ''}-${createTarget.afterId ?? ''}-${createTarget.mode ?? ''}` : 'closed'}
          target={createTarget}
          parents={createParents}
          existingChildren={countChildren}
          aiEnabled={Boolean(aiEnabled)}
          busy={busy}
          onClose={closeCreateDialog}
          onSubmit={createItem}
          onGenerate={generateChildren}
        />

        {renameProjectOpen && project && (
          <RenameProjectDialog
            project={project}
            busy={busy}
            onClose={() => setRenameProjectOpen(false)}
            onSubmit={renameProject}
          />
        )}

        <DeleteDialog
          target={deleteTarget}
          busy={busy}
          onClose={() => setDeleteTarget(undefined)}
          onConfirm={(target) => target.type === 'node' ? void deleteNode(target.node) : void deleteProject()}
        />

        {notice && (
          <MessageBar intent={notice.intent} className="notice-toast" key={`${notice.intent}-${notice.message}`}>
            <MessageBarBody><MessageBarTitle>{notice.title}</MessageBarTitle>{notice.message}</MessageBarBody>
          </MessageBar>
        )}
      </div>
    </FluentProvider>
  )
}

export default App
