import {
  AlertCircle,
  Check,
  Folder,
  FolderKanban,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import './App.css'

type NodeKind = 'role' | 'epic' | 'story' | 'substory'

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

const parentKinds: Partial<Record<NodeKind, NodeKind>> = {
  epic: 'role',
  story: 'epic',
  substory: 'story',
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
  dragHandle,
}: {
  node: StoryNode
  selected: boolean
  onSelect: (node: StoryNode) => void
  onAdd?: () => void
  dragHandle?: ReactNode
}) {
  return (
    <div className="node-slot group/node">
      <Card
        size="sm"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        className={`story-node size-32 cursor-pointer justify-between bg-card transition-colors hover:bg-accent${selected ? ' ring-2 ring-ring' : ''}`}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(node)
          }
        }}
      >
        <CardHeader className="h-full content-center pb-10">
          <CardTitle className="line-clamp-3">{node.name}</CardTitle>
        </CardHeader>
      </Card>
      {onAdd && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="node-add-action absolute bottom-2 left-1/2 z-10 -ml-3.5"
          onClick={(event) => {
            event.stopPropagation()
            onAdd()
          }}
          aria-label={`在${node.name}下新增${node.kind === 'role' ? '史诗' : node.kind === 'epic' ? '用户故事' : '二级故事'}`}
          title="新增子节点"
        >
          <Plus />
        </Button>
      )}
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
  children,
}: {
  node: StoryNode
  selected: boolean
  sorting: boolean
  onSelect: (node: StoryNode) => void
  onAdd?: () => void
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
  } = useSortable({ id: node.id, disabled: sorting })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.7 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="map-branch">
      <NodeCard
        node={node}
        selected={selected}
        onSelect={onSelect}
        onAdd={onAdd}
        dragHandle={
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-2 right-2 z-10 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            onClick={(event) => event.stopPropagation()}
            aria-label={`拖拽${node.name}排序`}
            title="拖拽排序"
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </Button>
        }
      />
      {children}
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
  onSelect,
  onCreate,
}: {
  projects: Project[]
  activeId?: string
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <FolderKanban />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">项目管理</span>
                <span className="truncate text-xs text-muted-foreground">用户故事地图</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>项目</SidebarGroupLabel>
          <SidebarGroupAction onClick={onCreate} aria-label="新建项目" title="新建项目">
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    isActive={project.id === activeId}
                    tooltip={project.name}
                    onClick={() => {
                      onSelect(project.id)
                      setOpenMobile(false)
                    }}
                  >
                    <Folder />
                    <span>{project.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        <Button variant="outline" className="w-full justify-start" onClick={onCreate}>
          <Plus />
          新建项目
        </Button>
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Check className="size-3.5" />
          自动保存
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
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
  const parentLabel = target.kind === 'epic'
    ? '所属角色'
    : target.kind === 'story'
      ? '所属史诗'
      : '所属用户故事'
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && (!needsParent || parentId)) onSubmit(name.trim(), parentId || undefined)
        }}>
          <DialogHeader>
            <DialogTitle>新增{label}</DialogTitle>
            <DialogDescription>
              {needsParent ? `选择父节点并创建${label}。` : `创建一个新的${label}。`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {needsParent && (
              <div className="grid gap-2">
                <Label htmlFor="create-parent">{parentLabel}</Label>
                <Select value={parentId} onValueChange={(value) => setParentId(value ?? '')}>
                  <SelectTrigger id="create-parent" className="w-full">
                    <SelectValue placeholder="选择父节点">
                      {parents.find((parent) => parent.id === parentId)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {parents.map((parent) => <SelectItem key={parent.id} value={parent.id}>{parent.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {parents.length === 0 && <p className="text-sm text-muted-foreground">请先创建上一层节点。</p>}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="create-name">名称</Label>
              <Input
                id="create-name"
                autoFocus={!needsParent}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={nodePrompts[target.kind]}
                maxLength={80}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>取消</Button>
            <Button type="submit" disabled={!name.trim() || busy || (needsParent && !parentId)}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onSubmit(name.trim())
        }}>
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
            <DialogDescription>修改当前项目的名称。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="project-name">名称</Label>
            <Input id="project-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>取消</Button>
            <Button type="submit" disabled={!name.trim() || name.trim() === project.name || busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Save />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{nodeLabels[node.kind]}</SheetTitle>
          <SheetDescription>编辑节点名称。</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4">
          <Badge variant="secondary">{nodeLabels[node.kind]}</Badge>
          <div className="grid gap-2">
            <Label htmlFor="node-name">名称</Label>
            <Input
              id="node-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dirty && name.trim()) onSave(name.trim())
              }}
              maxLength={80}
            />
          </div>
          {parent && (
            <div className="grid gap-1 text-sm">
              <span className="text-muted-foreground">归属</span>
              <span>{parent.name}</span>
            </div>
          )}
        </div>
        <SheetFooter>
          <Button onClick={() => onSave(name.trim())} disabled={!dirty || !name.trim() || busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Save />}
            保存名称
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={busy}>
            <Trash2 />
            删除{nodeLabels[node.kind]}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
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
        setProject({ ...project, nodes: [...project.nodes, created] })
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
    <TooltipProvider>
      <SidebarProvider>
        <ProjectSidebar
          projects={projects}
          activeId={project?.id}
          onSelect={(id) => id !== project?.id && void loadProject(id)}
          onCreate={() => setCreateTarget({ kind: 'project' })}
        />
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{project?.name ?? '用户故事地图'}</h1>
            {project && (
              <>
                <Button variant="ghost" size="icon" onClick={() => setCreateTarget({ kind: 'role' })} aria-label="新增角色" title="新增角色">
                  <Plus />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={
                    <Button variant="ghost" size="icon" aria-label="项目操作"><MoreHorizontal /></Button>
                  } />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRenameProjectOpen(true)}><Pencil />重命名项目</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: 'project', name: project.name })}>
                      <Trash2 />删除项目
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </header>

          {loading ? (
            <div className="grid flex-1 grid-cols-2 gap-4 p-6 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="size-32" />)}
            </div>
          ) : !project ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <FolderKanban className="size-8 text-muted-foreground" />
              <div><h2 className="font-medium">暂无项目</h2><p className="text-sm text-muted-foreground">新建项目以开始规划。</p></div>
              <Button onClick={() => setCreateTarget({ kind: 'project' })}><Plus />新建项目</Button>
            </div>
          ) : nodesByKind.role.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <FolderKanban className="size-8 text-muted-foreground" />
              <div>
                <h2 className="font-medium">暂无角色</h2>
                <p className="text-sm text-muted-foreground">先创建角色，再逐层添加史诗和用户故事。</p>
              </div>
              <Button onClick={() => setCreateTarget({ kind: 'role' })}><Plus />新建第一个角色</Button>
            </div>
          ) : (
            <section className="story-map-scroll flex-1 overflow-auto" aria-label="用户故事地图">
              <div className="level-labels" aria-hidden="true">
                <span>角色</span>
                <span>史诗</span>
                <span>用户故事</span>
                <span>二级故事</span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
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
        </SidebarInset>

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
          key={createTarget ? `${createTarget.kind}-${createTarget.parentId ?? ''}` : 'closed'}
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

        <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !busy && setDeleteTarget(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除？</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.type === 'node'
                  ? `将删除「${deleteTarget.node.name}」及其下的所有内容。`
                  : `将永久删除项目「${deleteTarget?.name ?? ''}」。`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={() => deleteTarget?.type === 'node' ? void deleteNode(deleteTarget.node) : void deleteProject()}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {error && (
          <Alert variant="destructive" className="fixed right-4 bottom-4 z-[100] max-w-sm bg-background shadow-lg">
            <AlertCircle />
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </SidebarProvider>
    </TooltipProvider>
  )
}

export default App
