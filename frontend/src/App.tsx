import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Dropdown,
  Field,
  FluentProvider,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  OverlayDrawer,
  Skeleton,
  SkeletonItem,
  Spinner,
  Text,
  Tooltip,
  webLightTheme,
} from '@fluentui/react-components'
import {
  Add20Regular,
  ArrowMove20Regular,
  Board20Regular,
  CheckmarkCircle16Regular,
  Delete20Regular,
  Dismiss20Regular,
  Edit20Regular,
  Folder20Regular,
  MoreHorizontal20Regular,
  Navigation20Regular,
  Save20Regular,
} from '@fluentui/react-icons'
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { isConnectorTransforming } from '@/connector-visibility'
import {
  isActiveCardCenterWithinInitialRect,
  isEligibleNodeDropTarget,
  parentKinds,
  type NodeKind,
} from '@/drag-collision'
import { insertAfter } from '@/node-order'
import { sortableTransformToString } from '@/sortable-transform'
import './App.css'

type StoryNode = {
  id: string
  kind: NodeKind
  parentId?: string
  name: string
}

type Project = {
  id: string
  name: string
  nodes: StoryNode[]
}

type CreateTarget = {
  kind: NodeKind | 'project'
  parentId?: string
  afterId?: string
}

type DeleteTarget =
  | { type: 'project'; name: string }
  | { type: 'node'; node: StoryNode }

const nodeLabels: Record<NodeKind, string> = {
  role: '角色',
  epic: '史诗',
  story: '用户故事',
  substory: '二级故事',
}

const nodePrompts: Record<NodeKind | 'project', string> = {
  project: '例如：移动端改版',
  role: '例如：内容创作者',
  epic: '例如：发布内容',
  story: '例如：编辑一篇文章',
  substory: '例如：添加封面图片',
}

const snapToNodeCollision: CollisionDetection = (args) => {
  const activeContainer = args.droppableContainers.find(
    (container) => container.id === args.active.id,
  )
  const activeCard = activeContainer?.node.current?.querySelector<HTMLElement>(
    ':scope > .branch-visual > .node-slot',
  )
  if (activeCard && isActiveCardCenterWithinInitialRect(
    activeCard.getBoundingClientRect(),
    args.collisionRect,
    args.active.rect.current.initial,
  )) {
    return []
  }
  const activeKind = args.active.data.current?.kind as NodeKind | undefined
  const droppableContainers = args.droppableContainers.filter((container) => {
    const kind = container.data.current?.kind as NodeKind | undefined
    return isEligibleNodeDropTarget(args.active.id, activeKind, container.id, kind)
  })
  const droppableRects = new Map(args.droppableRects)

  for (const container of droppableContainers) {
    const node = container.node.current?.querySelector<HTMLElement>(
      ':scope > .branch-visual > .node-slot',
    )
    if (node) droppableRects.set(container.id, node.getBoundingClientRect())
  }

  const collisionArgs = { ...args, droppableContainers, droppableRects }
  const directHits = pointerWithin(collisionArgs)
  return directHits.length > 0 ? directHits : closestCorners(collisionArgs)
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options?.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options?.headers,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? '请求失败，请稍后重试')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function childrenOf(nodes: StoryNode[], parentId: string, kind: NodeKind) {
  return nodes.filter((node) => node.parentId === parentId && node.kind === kind)
}

function moveNode(nodes: StoryNode[], nodeID: string, parentID: string, orderedIDs: string[]) {
  const nodesByID = new Map(nodes.map((node) => [node.id, node]))
  const moved = nodesByID.get(nodeID)
  if (!moved) return nodes

  const ordered = orderedIDs.map((id) => {
    const node = nodesByID.get(id)!
    if (id !== nodeID) return node
    if (parentID) return { ...node, parentId: parentID }
    const { parentId: _, ...rootNode } = node
    return rootNode
  })
  const targetIDs = new Set(orderedIDs)
  return [...nodes.filter((node) => !targetIDs.has(node.id)), ...ordered]
}

function NodeCard({
  node,
  selected,
  onSelect,
  onAdd,
  onAddSibling,
  dragHandle,
}: {
  node: StoryNode
  selected: boolean
  onSelect: (node: StoryNode) => void
  onAdd?: () => void
  onAddSibling: () => void
  dragHandle?: ReactNode
}) {
  return (
    <div className="node-slot group/node">
      <Card
        data-kind={node.kind}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        className={`story-node${selected ? ' is-selected' : ''}`}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(node)
          }
        }}
      >
        <Text weight="semibold" className="story-node-title">{node.name}</Text>
        <Badge appearance="tint" color="informative" size="small">{nodeLabels[node.kind]}</Badge>
      </Card>
      {onAdd && (
        <Tooltip content="新增子节点" relationship="label">
          <Button
            type="button"
            appearance="subtle"
            size="small"
            icon={<Add20Regular />}
            className="node-add-action"
            onClick={(event) => {
              event.stopPropagation()
              onAdd()
            }}
            aria-label={`在${node.name}下新增${node.kind === 'role' ? '史诗' : node.kind === 'epic' ? '用户故事' : '二级故事'}`}
          />
        </Tooltip>
      )}
      <Tooltip content={`新增同级${nodeLabels[node.kind]}`} relationship="label">
        <Button
          type="button"
          appearance="secondary"
          size="small"
          icon={<Add20Regular />}
          className="sibling-add-action"
          onClick={(event) => {
            event.stopPropagation()
            onAddSibling()
          }}
          aria-label={`在${node.name}后新增${nodeLabels[node.kind]}`}
        />
      </Tooltip>
      {dragHandle}
    </div>
  )
}

function SortableBranch({
  node,
  selected,
  sorting,
  onSelect,
  onAdd,
  onAddSibling,
  children,
}: {
  node: StoryNode
  selected: boolean
  sorting: boolean
  onSelect: (node: StoryNode) => void
  onAdd?: () => void
  onAddSibling: () => void
  children?: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: node.id, disabled: sorting, data: { kind: node.kind } })
  const style: CSSProperties = {
    transform: sortableTransformToString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.7 : undefined,
  }
  const isTransforming = isConnectorTransforming({ transform, transition })
  const hasChildren = Boolean(children)

  return (
    <div
      ref={setNodeRef}
      className={`map-branch${isTransforming ? ' is-transforming' : ''}${isDragging ? ' is-dragging' : ''}${isOver && !isDragging ? ' is-drop-target' : ''}`}
    >
      <div className="branch-visual" style={style}>
        <NodeCard
          node={node}
          selected={selected}
          onSelect={onSelect}
          onAdd={onAdd}
          onAddSibling={onAddSibling}
          dragHandle={
            <Button
              ref={setActivatorNodeRef}
              type="button"
              appearance="subtle"
              size="small"
              icon={<ArrowMove20Regular />}
              className="node-drag-action"
              onClick={(event) => event.stopPropagation()}
              aria-label={`拖拽${node.name}排序`}
              title="拖拽排序"
              {...attributes}
              {...listeners}
            />
          }
        />
        {children}
      </div>
      {hasChildren && <span className="branch-outgoing-connector" aria-hidden="true" />}
    </div>
  )
}

type BranchProps = {
  nodes: StoryNode[]
  selectedId?: string
  sorting: boolean
  onSelect: (node: StoryNode) => void
  onCreate: (target: CreateTarget) => void
}

function StoryBranch({ story, ...props }: BranchProps & { story: StoryNode }) {
  const substories = childrenOf(props.nodes, story.id, 'substory')
  return (
    <SortableBranch
      node={story}
      selected={props.selectedId === story.id}
      sorting={props.sorting}
      onSelect={props.onSelect}
      onAdd={() => props.onCreate({ kind: 'substory', parentId: story.id })}
      onAddSibling={() => props.onCreate({ kind: 'story', parentId: story.parentId, afterId: story.id })}
    >
      {substories.length > 0 && (
        <SortableContext items={substories.map((node) => node.id)} strategy={horizontalListSortingStrategy}>
          <div className="branch-children">
            {substories.map((node) => (
              <SortableBranch
                key={node.id}
                node={node}
                selected={props.selectedId === node.id}
                sorting={props.sorting}
                onSelect={props.onSelect}
                onAddSibling={() => props.onCreate({ kind: 'substory', parentId: story.id, afterId: node.id })}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </SortableBranch>
  )
}

function EpicBranch({ epic, ...props }: BranchProps & { epic: StoryNode }) {
  const stories = childrenOf(props.nodes, epic.id, 'story')
  return (
    <SortableBranch
      node={epic}
      selected={props.selectedId === epic.id}
      sorting={props.sorting}
      onSelect={props.onSelect}
      onAdd={() => props.onCreate({ kind: 'story', parentId: epic.id })}
      onAddSibling={() => props.onCreate({ kind: 'epic', parentId: epic.parentId, afterId: epic.id })}
    >
      {stories.length > 0 && (
        <SortableContext items={stories.map((node) => node.id)} strategy={horizontalListSortingStrategy}>
          <div className="branch-children">
            {stories.map((story) => <StoryBranch key={story.id} story={story} {...props} />)}
          </div>
        </SortableContext>
      )}
    </SortableBranch>
  )
}

function RoleBranch({ role, ...props }: BranchProps & { role: StoryNode }) {
  const epics = childrenOf(props.nodes, role.id, 'epic')
  return (
    <SortableBranch
      node={role}
      selected={props.selectedId === role.id}
      sorting={props.sorting}
      onSelect={props.onSelect}
      onAdd={() => props.onCreate({ kind: 'epic', parentId: role.id })}
      onAddSibling={() => props.onCreate({ kind: 'role', afterId: role.id })}
    >
      {epics.length > 0 && (
        <SortableContext items={epics.map((node) => node.id)} strategy={horizontalListSortingStrategy}>
          <div className="branch-children">
            {epics.map((epic) => <EpicBranch key={epic.id} epic={epic} {...props} />)}
          </div>
        </SortableContext>
      )}
    </SortableBranch>
  )
}

function ProjectSidebar({
  projects,
  activeId,
  open,
  onSelect,
  onCreate,
  onClose,
}: {
  projects: Project[]
  activeId?: string
  open: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onClose: () => void
}) {
  return (
    <>
      <button className={`sidebar-scrim${open ? ' is-open' : ''}`} aria-label="关闭项目导航" onClick={onClose} />
      <aside className={`project-sidebar${open ? ' is-open' : ''}`} aria-label="项目导航">
        <div className="sidebar-brand">
          <span className="brand-mark"><Board20Regular /></span>
          <div>
            <Text weight="semibold" block>项目管理</Text>
            <Text size={200} className="sidebar-subtitle">用户故事地图</Text>
          </div>
          <Button
            appearance="subtle"
            size="small"
            icon={<Dismiss20Regular />}
            className="sidebar-close"
            aria-label="关闭项目导航"
            onClick={onClose}
          />
        </div>
        <Divider />
        <div className="sidebar-section-heading">
          <Text size={200} weight="semibold">项目</Text>
          <Tooltip content="新建项目" relationship="label">
            <Button appearance="subtle" size="small" icon={<Add20Regular />} aria-label="新建项目" onClick={onCreate} />
          </Tooltip>
        </div>
        <nav className="project-list" aria-label="项目列表">
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`project-nav-item${item.id === activeId ? ' is-active' : ''}`}
              aria-current={item.id === activeId ? 'page' : undefined}
              onClick={() => {
                onSelect(item.id)
                onClose()
              }}
            >
              <Folder20Regular />
              <span>{item.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Button appearance="secondary" icon={<Add20Regular />} className="sidebar-create" onClick={onCreate}>
            新建项目
          </Button>
          <div className="autosave-status"><CheckmarkCircle16Regular />自动保存</div>
        </div>
      </aside>
    </>
  )
}

function CreateDialog({
  target,
  parents,
  busy,
  onClose,
  onSubmit,
}: {
  target?: CreateTarget
  parents: StoryNode[]
  busy: boolean
  onClose: () => void
  onSubmit: (name: string, parentId?: string) => void
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState(target?.parentId ?? parents[0]?.id ?? '')
  if (!target) return null
  const label = target.kind === 'project' ? '项目' : nodeLabels[target.kind]
  const needsParent = target.kind !== 'project' && target.kind !== 'role'
  const chooseParent = needsParent && !target.parentId
  const presetParent = target.parentId
    ? parents.find((parent) => parent.id === target.parentId)
    : undefined
  const parentLabel = target.kind === 'epic'
    ? '所属角色'
    : target.kind === 'story'
      ? '所属史诗'
      : '所属用户故事'
  return (
    <Dialog open onOpenChange={(_event, data) => !data.open && !busy && onClose()}>
      <DialogSurface>
        <form className="dialog-form" onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && (!needsParent || parentId)) onSubmit(name.trim(), parentId || undefined)
        }}>
          <DialogBody>
            <DialogTitle>新增{label}</DialogTitle>
            <DialogContent className="dialog-content">
              <Text className="dialog-description">
              {target.parentId
                ? `将在「${presetParent?.name ?? '当前节点'}」下创建${label}。`
                : needsParent
                  ? `选择父节点并创建${label}。`
                  : `创建一个新的${label}。`}
              </Text>
            {chooseParent && (
              <Field label={parentLabel} hint={parents.length === 0 ? '请先创建上一层节点。' : undefined}>
                <Dropdown
                  id="create-parent"
                  placeholder="选择父节点"
                  value={parents.find((parent) => parent.id === parentId)?.name ?? ''}
                  selectedOptions={parentId ? [parentId] : []}
                  onOptionSelect={(_event, data) => setParentId(data.optionValue ?? '')}
                >
                  {parents.map((parent) => <Option key={parent.id} value={parent.id}>{parent.name}</Option>)}
                </Dropdown>
              </Field>
            )}
            <Field label="名称">
              <Input
                id="create-name"
                autoFocus={!chooseParent}
                value={name}
                onChange={(_event, data) => setName(data.value)}
                placeholder={nodePrompts[target.kind]}
                maxLength={80}
              />
            </Field>
            </DialogContent>
          <DialogActions>
            <Button type="button" appearance="secondary" onClick={onClose} disabled={busy}>取消</Button>
            <Button type="submit" appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Add20Regular />} disabled={!name.trim() || busy || (needsParent && !parentId)}>
              创建
            </Button>
          </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  )
}

function RenameProjectDialog({
  project,
  busy,
  onClose,
  onSubmit,
}: {
  project: Project
  busy: boolean
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(project.name)
  return (
    <Dialog open onOpenChange={(_event, data) => !data.open && !busy && onClose()}>
      <DialogSurface>
        <form className="dialog-form" onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onSubmit(name.trim())
        }}>
          <DialogBody>
            <DialogTitle>重命名项目</DialogTitle>
            <DialogContent className="dialog-content">
              <Text className="dialog-description">修改当前项目的名称。</Text>
              <Field label="名称">
                <Input id="project-name" autoFocus value={name} onChange={(_event, data) => setName(data.value)} maxLength={80} />
              </Field>
            </DialogContent>
          <DialogActions>
            <Button type="button" appearance="secondary" onClick={onClose} disabled={busy}>取消</Button>
            <Button type="submit" appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Save20Regular />} disabled={!name.trim() || name.trim() === project.name || busy}>
              保存
            </Button>
          </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  )
}

function NodeSheet({
  node,
  parent,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  node: StoryNode
  parent?: StoryNode
  busy: boolean
  onClose: () => void
  onSave: (name: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(node.name)
  const dirty = name.trim() !== node.name
  return (
    <OverlayDrawer position="end" open onOpenChange={(_event, data) => !data.open && onClose()}>
        <DrawerHeader>
          <DrawerHeaderTitle action={
            <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="关闭编辑面板" onClick={onClose} />
          }>
            编辑{nodeLabels[node.kind]}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody className="node-drawer-body">
          <Text className="dialog-description">修改节点名称及查看所属关系。</Text>
          <Badge appearance="tint" color="informative">{nodeLabels[node.kind]}</Badge>
          <Field label="名称">
            <Input
              id="node-name"
              value={name}
              onChange={(_event, data) => setName(data.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dirty && name.trim()) onSave(name.trim())
              }}
              maxLength={80}
            />
          </Field>
          {parent && (
            <div className="node-parent-info">
              <Text size={200} className="muted-text">归属</Text>
              <Text>{parent.name}</Text>
            </div>
          )}
        </DrawerBody>
        <DrawerFooter className="node-drawer-footer">
          <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Save20Regular />} onClick={() => onSave(name.trim())} disabled={!dirty || !name.trim() || busy}>
            保存名称
          </Button>
          <Button appearance="secondary" icon={<Delete20Regular />} className="danger-button" onClick={onDelete} disabled={busy}>
            删除{nodeLabels[node.kind]}
          </Button>
        </DrawerFooter>
    </OverlayDrawer>
  )
}

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
  const [error, setError] = useState<string>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const selectedNode = (project?.nodes ?? []).find((node) => node.id === selectedId)
  const nodesByKind = useMemo(() => ({
    role: (project?.nodes ?? []).filter((node) => node.kind === 'role'),
    epic: (project?.nodes ?? []).filter((node) => node.kind === 'epic'),
    story: (project?.nodes ?? []).filter((node) => node.kind === 'story'),
    substory: (project?.nodes ?? []).filter((node) => node.kind === 'substory'),
  }), [project])

  const showError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : '发生未知错误')
    window.setTimeout(() => setError(undefined), 4000)
  }

  const loadProject = async (projectId: string) => {
    try {
      const result = await api<Project>(`/api/projects/${projectId}`)
      setProject(result)
      setSelectedId(undefined)
      window.localStorage.setItem('spm:lastProject', projectId)
    } catch (reason) {
      showError(reason)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const result = await api<Project[]>('/api/projects')
        setProjects(result)
        const remembered = window.localStorage.getItem('spm:lastProject')
        const first = result.find((item) => item.id === remembered) ?? result[0]
        if (first) await loadProject(first.id)
      } catch (reason) {
        showError(reason)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const createItem = async (name: string, parentId?: string) => {
    if (!createTarget) return
    setBusy(true)
    try {
      if (createTarget.kind === 'project') {
        const created = await api<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) })
        setProjects((current) => [...current, created])
        setProject(created)
        setSelectedId(undefined)
        window.localStorage.setItem('spm:lastProject', created.id)
      } else if (project) {
        const created = await api<StoryNode>(`/api/projects/${project.id}/nodes`, {
          method: 'POST',
          body: JSON.stringify({ ...createTarget, parentId, name }),
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

  const renameNode = async (name: string) => {
    if (!project || !selectedNode) return
    setBusy(true)
    try {
      const updated = await api<StoryNode>(`/api/projects/${project.id}/nodes/${selectedNode.id}`, {
        method: 'PATCH', body: JSON.stringify({ name }),
      })
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
      await api<void>(`/api/projects/${project.id}/nodes/${node.id}`, { method: 'DELETE' })
      const removed = new Set([node.id])
      let changed = true
      while (changed) {
        changed = false
        for (const item of project.nodes) {
          if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
            removed.add(item.id)
            changed = true
          }
        }
      }
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
      const updated = await api<Project>(`/api/projects/${project.id}`, {
        method: 'PATCH', body: JSON.stringify({ name }),
      })
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
      await api<void>(`/api/projects/${project.id}`, { method: 'DELETE' })
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
    if (!project || !over || active.id === over.id || sorting) return

    const nodes = project.nodes ?? []
    const activeNode = nodes.find((node) => node.id === String(active.id))
    const overNode = nodes.find((node) => node.id === String(over.id))
    if (!activeNode || !overNode) return
    let parentID: string
    let orderedIDs: string[]

    if (overNode.kind === activeNode.kind) {
      parentID = overNode.parentId ?? ''
      const targetSiblings = nodes.filter((node) =>
        node.kind === activeNode.kind && (node.parentId ?? '') === parentID,
      )
      if ((activeNode.parentId ?? '') === parentID) {
        const oldIndex = targetSiblings.findIndex((node) => node.id === activeNode.id)
        const newIndex = targetSiblings.findIndex((node) => node.id === overNode.id)
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
        orderedIDs = arrayMove(targetSiblings, oldIndex, newIndex).map((node) => node.id)
      } else {
        const withoutMoving = targetSiblings.filter((node) => node.id !== activeNode.id)
        const newIndex = withoutMoving.findIndex((node) => node.id === overNode.id)
        if (newIndex < 0) return
        const targetOrder = [...withoutMoving]
        targetOrder.splice(newIndex, 0, activeNode)
        orderedIDs = targetOrder.map((node) => node.id)
      }
    } else if (parentKinds[activeNode.kind] === overNode.kind) {
      parentID = overNode.id
      orderedIDs = nodes
        .filter((node) => node.id !== activeNode.id && node.kind === activeNode.kind && node.parentId === parentID)
        .map((node) => node.id)
      orderedIDs.push(activeNode.id)
    } else {
      return
    }

    const previous = project
    setProject({ ...project, nodes: moveNode(nodes, activeNode.id, parentID, orderedIDs) })
    setSorting(true)
    try {
      await api<void>(`/api/projects/${project.id}/nodes/order`, {
        method: 'PUT',
        body: JSON.stringify({ nodeId: activeNode.id, parentId: parentID, nodeIds: orderedIDs }),
      })
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

  return (
    <FluentProvider theme={webLightTheme} className="fluent-root">
      <div className="app-shell">
        <ProjectSidebar
          projects={projects}
          activeId={project?.id}
          open={sidebarOpen}
          onSelect={(id) => id !== project?.id && void loadProject(id)}
          onCreate={() => setCreateTarget({ kind: 'project' })}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="workspace">
          <header className="command-bar">
            <Tooltip content="打开项目导航" relationship="label">
              <Button
                appearance="subtle"
                icon={<Navigation20Regular />}
                className="nav-toggle"
                aria-label="打开项目导航"
                onClick={() => setSidebarOpen(true)}
              />
            </Tooltip>
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
                    <Button appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="项目操作" />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem icon={<Edit20Regular />} onClick={() => setRenameProjectOpen(true)}>重命名项目</MenuItem>
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
            <section className="story-map-scroll" aria-label="用户故事地图">
              <div className="level-labels" aria-hidden="true">
                <span>角色</span>
                <span>史诗</span>
                <span>用户故事</span>
                <span>二级故事</span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={snapToNodeCollision}
                onDragEnd={(event) => void reorderNodes(event)}
              >
                <SortableContext items={nodesByKind.role.map((node) => node.id)} strategy={horizontalListSortingStrategy}>
                  <div className="story-map">
                    {nodesByKind.role.map((role) => (
                      <RoleBranch
                        key={role.id}
                        role={role}
                        nodes={project.nodes ?? []}
                        selectedId={selectedId}
                        sorting={sorting}
                        onSelect={(node) => setSelectedId(node.id)}
                        onCreate={setCreateTarget}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </section>
          )}
        </main>

        {selectedNode && (
          <NodeSheet
            key={selectedNode.id}
            node={selectedNode}
            parent={(project?.nodes ?? []).find((node) => node.id === selectedNode.parentId)}
            busy={busy}
            onClose={() => setSelectedId(undefined)}
            onSave={renameNode}
            onDelete={() => setDeleteTarget({ type: 'node', node: selectedNode })}
          />
        )}

        <CreateDialog
          key={createTarget ? `${createTarget.kind}-${createTarget.parentId ?? ''}-${createTarget.afterId ?? ''}` : 'closed'}
          target={createTarget}
          parents={createParents}
          busy={busy}
          onClose={() => setCreateTarget(undefined)}
          onSubmit={createItem}
        />

        {renameProjectOpen && project && (
          <RenameProjectDialog
            project={project}
            busy={busy}
            onClose={() => setRenameProjectOpen(false)}
            onSubmit={renameProject}
          />
        )}

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(_event, data) => !data.open && !busy && setDeleteTarget(undefined)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>确认删除？</DialogTitle>
              <DialogContent>
                {deleteTarget?.type === 'node'
                  ? `将删除「${deleteTarget.node.name}」及其下的所有内容。`
                  : `将永久删除项目「${deleteTarget?.name ?? ''}」。`}
              </DialogContent>
            <DialogActions>
              <Button appearance="secondary" disabled={busy} onClick={() => setDeleteTarget(undefined)}>取消</Button>
              <Button
                appearance="primary"
                className="danger-primary-button"
                icon={busy ? <Spinner size="tiny" /> : <Delete20Regular />}
                disabled={busy}
                onClick={() => deleteTarget?.type === 'node' ? void deleteNode(deleteTarget.node) : void deleteProject()}
              >
                删除
              </Button>
            </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        {error && (
          <MessageBar intent="error" className="error-toast">
            <MessageBarBody><MessageBarTitle>操作失败</MessageBarTitle>{error}</MessageBarBody>
          </MessageBar>
        )}
      </div>
    </FluentProvider>
  )
}

export default App
