import { Badge } from '@fluentui/react-components'
import {
  BookOpen16Filled,
  BookOpen20Filled,
  Flag16Filled,
  Flag20Filled,
  Person16Filled,
  Person20Filled,
  TaskListSquareLtr16Filled,
  TaskListSquareLtr20Filled,
} from '@fluentui/react-icons'
import type { NodeKind } from '@/drag-collision'
import { nodeLabels } from '@/model'

const kindIcons = {
  role: [Person16Filled, Person20Filled],
  epic: [Flag16Filled, Flag20Filled],
  story: [BookOpen16Filled, BookOpen20Filled],
  substory: [TaskListSquareLtr16Filled, TaskListSquareLtr20Filled],
} satisfies Record<NodeKind, [unknown, unknown]>

/** Kind glyph tinted with the kind's accent colour (see `[data-kind]` tokens in App.css). */
export function KindIcon({ kind, size = 16 }: { kind: NodeKind; size?: 16 | 20 }) {
  const Icon = kindIcons[kind][size === 16 ? 0 : 1]
  return <Icon className="kind-icon" data-kind={kind} aria-hidden="true" />
}

export function KindBadge({ kind, size = 'small' }: { kind: NodeKind; size?: 'small' | 'medium' }) {
  return (
    <Badge
      appearance="tint"
      size={size}
      className="kind-badge"
      data-kind={kind}
      icon={<KindIcon kind={kind} />}
    >
      {nodeLabels[kind]}
    </Badge>
  )
}
