import { type CSSProperties, type ReactNode, useState } from 'react'
import { Button, Card, Text } from '@fluentui/react-components'
import { Add20Regular, Sparkle20Filled } from '@fluentui/react-icons'
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useDndMonitor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import type { Transform } from '@dnd-kit/utilities'
import { KindIcon } from '@/components/KindVisuals'
import { isConnectorTransforming } from '@/connector-visibility'
import {
  horizontalCenterDistance,
  isActiveCardCenterWithinInitialHorizontalRange,
  isEligibleNodeDropTarget,
  isTargetInDragDirection,
  parentKinds,
  type NodeKind,
} from '@/drag-collision'
import { childKinds, childrenOf, nodeKinds, nodeLabels, type CreateTarget, type StoryNode } from '@/model'
import { resolveDragSourceTransform, sortableTransformToString } from '@/sortable-transform'

const snapToNodeCollision: CollisionDetection = (args) => {
  const activeContainer = args.droppableContainers.find(
    (container) => container.id === args.active.id,
  )
  const activeCard = activeContainer?.node.current?.querySelector<HTMLElement>(
    ':scope > .branch-visual > .node-slot',
  )
  const activeCardRect = activeCard?.getBoundingClientRect()
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
  const parentKind = activeKind ? parentKinds[activeKind] : undefined
  const parentContainers = parentKind
    ? droppableContainers.filter((container) => container.data.current?.kind === parentKind)
    : []
  const directParentHits = pointerWithin({
    ...collisionArgs,
    droppableContainers: parentContainers,
  })
  if (directParentHits.length > 0) return directParentHits

  if (activeCardRect && isActiveCardCenterWithinInitialHorizontalRange(
    activeCardRect,
    args.collisionRect,
    args.active.rect.current.initial,
  )) {
    return []
  }

  const sameKindContainers = droppableContainers.filter(
    (container) => container.data.current?.kind === activeKind,
  )
  if (activeCardRect && sameKindContainers.length > 0) {
    return sameKindContainers
      .flatMap((droppableContainer) => {
        const rect = droppableRects.get(droppableContainer.id)
        return rect && isTargetInDragDirection(
          activeCardRect,
          args.collisionRect,
          args.active.rect.current.initial,
          rect,
        )
          ? [{
              id: droppableContainer.id,
              data: {
                droppableContainer,
                value: horizontalCenterDistance(activeCardRect, rect),
              },
            }]
          : []
      })
      .sort((first, second) => first.data.value - second.data.value)
  }

  return closestCorners(collisionArgs)
}

type CardDrag = {
  setActivatorNodeRef: (element: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  isDragging: boolean
}

type NodeActions = {
  onAdd?: () => void
  onGenerate?: () => void
  onAddSibling: () => void
}

function NodeCard({
  node,
  selected,
  fresh,
  onSelect,
  onAdd,
  onGenerate,
  onAddSibling,
  drag,
}: NodeActions & {
  node: StoryNode
  selected: boolean
  fresh: boolean
  onSelect: (node: StoryNode) => void
  drag: CardDrag
}) {
  const childKind = childKinds[node.kind]
  return (
    <div className="node-slot">
      {/* The whole card is the drag activator: a short pointer move or a Space press picks it up,
          a plain click or Enter opens it. dnd-kit swallows the click that ends a drag. */}
      <Card
        ref={drag.setActivatorNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        data-kind={node.kind}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${node.name}，${nodeLabels[node.kind]}`}
        className={`story-node${selected ? ' is-selected' : ''}${fresh ? ' is-fresh' : ''}`}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (!drag.isDragging) onSelect(node)
            return
          }
          drag.listeners?.onKeyDown?.(event)
        }}
      >
        <Text weight="semibold" className="story-node-title">{node.name}</Text>
      </Card>
      {onAdd && childKind && (
        <Button
          type="button"
          appearance="secondary"
          size="small"
          icon={<Add20Regular />}
          className="node-add-action"
          data-kind={childKind}
          onClick={(event) => {
            event.stopPropagation()
            onAdd()
          }}
          aria-label={`在${node.name}下新增${nodeLabels[childKind]}`}
          title="新增子节点"
        />
      )}
      {onGenerate && childKind && (
        <Button
          type="button"
          appearance="secondary"
          size="small"
          icon={<Sparkle20Filled />}
          className="node-ai-action"
          onClick={(event) => {
            event.stopPropagation()
            onGenerate()
          }}
          aria-label={`AI 为${node.name}生成${nodeLabels[childKind]}`}
          title="AI 生成子节点"
        />
      )}
      <Button
        type="button"
        appearance="secondary"
        size="small"
        icon={<Add20Regular />}
        className="sibling-add-action"
        data-kind={node.kind}
        onClick={(event) => {
          event.stopPropagation()
          onAddSibling()
        }}
        aria-label={`在${node.name}后新增${nodeLabels[node.kind]}`}
        title={`新增同级${nodeLabels[node.kind]}`}
      />
    </div>
  )
}

function SortableBranch({
  node,
  selected,
  fresh,
  sorting,
  onSelect,
  children,
  ...actions
}: NodeActions & {
  node: StoryNode
  selected: boolean
  fresh: boolean
  sorting: boolean
  onSelect: (node: StoryNode) => void
  children?: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform: sortableTransform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: node.id, disabled: sorting, data: { kind: node.kind } })
  const [dragDelta, setDragDelta] = useState<Transform | null>(null)
  useDndMonitor({
    onDragMove: ({ active, delta }) => {
      if (active.id === node.id) setDragDelta({ ...delta, scaleX: 1, scaleY: 1 })
    },
    onDragEnd: () => setDragDelta(null),
    onDragCancel: () => setDragDelta(null),
  })
  // dnd-kit drops the drag source transform while hovering another parent's children.
  const transform = resolveDragSourceTransform(isDragging, sortableTransform, dragDelta)
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
          fresh={fresh}
          onSelect={onSelect}
          {...actions}
          drag={{ setActivatorNodeRef, attributes, listeners, isDragging }}
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
  freshIds: ReadonlySet<string>
  sorting: boolean
  aiEnabled: boolean
  onSelect: (node: StoryNode) => void
  onCreate: (target: CreateTarget) => void
}

/** One node and, recursively, its subtree; each level is its own sortable group. */
function NodeBranch({ node, ...props }: BranchProps & { node: StoryNode }) {
  const childKind = childKinds[node.kind]
  const children = childKind ? childrenOf(props.nodes, node.id, childKind) : []
  return (
    <SortableBranch
      node={node}
      selected={props.selectedId === node.id}
      fresh={props.freshIds.has(node.id)}
      sorting={props.sorting}
      onSelect={props.onSelect}
      onAdd={childKind && (() => props.onCreate({ kind: childKind, parentId: node.id }))}
      onGenerate={childKind && props.aiEnabled
        ? () => props.onCreate({ kind: childKind, parentId: node.id, mode: 'ai' })
        : undefined}
      onAddSibling={() => props.onCreate({ kind: node.kind, parentId: node.parentId, afterId: node.id })}
    >
      {children.length > 0 && (
        <SortableContext items={children.map((child) => child.id)} strategy={horizontalListSortingStrategy}>
          <div className="branch-children">
            {children.map((child) => <NodeBranch key={child.id} node={child} {...props} />)}
          </div>
        </SortableContext>
      )}
    </SortableBranch>
  )
}

export function StoryMap({
  roles,
  onReorder,
  ...props
}: BranchProps & {
  roles: StoryNode[]
  onReorder: (event: DragEndEvent) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    // Enter is reserved for opening the node, so only Space picks up and drops.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
  return (
    <section className="story-map-scroll" aria-label="用户故事地图">
      <div className="level-labels" aria-hidden="true">
        {nodeKinds.map((kind) => (
          <span key={kind} className="level-label" data-kind={kind}>
            <KindIcon kind={kind} />
            <span>{nodeLabels[kind]}</span>
          </span>
        ))}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={snapToNodeCollision}
        onDragEnd={onReorder}
      >
        <SortableContext items={roles.map((node) => node.id)} strategy={horizontalListSortingStrategy}>
          <div className="story-map">
            {roles.map((role) => <NodeBranch key={role.id} node={role} {...props} />)}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  )
}
