import { useState } from 'react'
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  OverlayDrawer,
  Spinner,
  Text,
} from '@fluentui/react-components'
import { Delete20Regular, Dismiss20Regular, Save20Regular, Sparkle20Filled } from '@fluentui/react-icons'
import { KindBadge, KindIcon } from '@/components/KindVisuals'
import { childKinds, nodeLabels, type StoryNode } from '@/model'

export function NodeSheet({
  node,
  parent,
  childCount,
  aiEnabled,
  busy,
  onClose,
  onSave,
  onDelete,
  onAsk,
}: {
  node: StoryNode
  parent?: StoryNode
  childCount: number
  aiEnabled: boolean
  busy: boolean
  onClose: () => void
  onSave: (name: string) => void
  onDelete: () => void
  /** Opens the assistant with a draft about this node. */
  onAsk: (draft: string) => void
}) {
  const [name, setName] = useState(node.name)
  const dirty = name.trim() !== node.name
  const childKind = childKinds[node.kind]
  return (
    <OverlayDrawer position="end" open onOpenChange={(_event, data) => !data.open && onClose()}>
      <DrawerHeader>
        <DrawerHeaderTitle action={
          <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="关闭编辑面板" title="关闭编辑面板" onClick={onClose} />
        }>
          <span className="dialog-title-with-icon" data-kind={node.kind}>
            <KindIcon kind={node.kind} size={20} />
            编辑{nodeLabels[node.kind]}
          </span>
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className="node-drawer-body">
        <Text className="dialog-description">修改节点名称及查看所属关系。</Text>
        <KindBadge kind={node.kind} size="medium" />
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
            <span className="node-parent-name" data-kind={parent.kind}>
              <KindIcon kind={parent.kind} />
              <Text>{parent.name}</Text>
            </span>
          </div>
        )}
        <div className="node-ai-panel">
          <div className="node-ai-panel-heading">
            <Sparkle20Filled className="icon-ai" />
            <Text weight="semibold">和 AI 助手一起打磨</Text>
          </div>
          <Text size={200} className="muted-text">
            {aiEnabled
              ? childKind
                ? `在助手里讨论「${node.name}」，让它拆分或调整${nodeLabels[childKind]}（当前 ${childCount} 个），改动会实时出现在地图上。`
                : `在助手里讨论「${node.name}」的表述，或让它调整位置。`
              : '后端尚未配置 AI 服务，暂不可用。'}
          </Text>
          <Button
            appearance="secondary"
            icon={<Sparkle20Filled />}
            className="ai-secondary-button"
            disabled={!aiEnabled}
            onClick={() => onAsk(childKind
              ? `帮我为「${node.name}」拆分${nodeLabels[childKind]}`
              : `帮我打磨「${node.name}」的表述`)}
          >
            在 AI 助手中讨论
          </Button>
        </div>
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
