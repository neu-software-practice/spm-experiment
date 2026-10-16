import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Text,
} from '@fluentui/react-components'
import { Add20Regular, Delete20Regular, Save20Regular } from '@fluentui/react-icons'
import { KindIcon } from '@/components/KindVisuals'
import {
  nodeLabels,
  nodePrompts,
  type CreateTarget,
  type DeleteTarget,
  type Project,
  type StoryNode,
} from '@/model'

export function CreateDialog({
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

  const kind = target.kind
  const label = kind === 'project' ? '项目' : nodeLabels[kind]
  const needsParent = kind !== 'project' && kind !== 'role'
  const chooseParent = needsParent && !target.parentId
  const parent = parents.find((item) => item.id === parentId)
  const parentLabel = kind === 'epic'
    ? '所属角色'
    : kind === 'story'
      ? '所属史诗'
      : '所属用户故事'
  const canSubmit = Boolean(name.trim()) && (!needsParent || Boolean(parentId))

  const submit = () => {
    if (!canSubmit || busy) return
    onSubmit(name.trim(), parentId || undefined)
  }

  return (
    <Dialog open onOpenChange={(_event, data) => !data.open && !busy && onClose()}>
      <DialogSurface className="create-dialog">
        <form className="dialog-form" onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}>
          <DialogBody>
            <DialogTitle>
              <span className="dialog-title-with-icon" data-kind={kind === 'project' ? undefined : kind}>
                {kind !== 'project' && <KindIcon kind={kind} size={20} />}
                新增{label}
              </span>
            </DialogTitle>
            <DialogContent className="dialog-content">
              <Text className="dialog-description">
                {target.parentId
                  ? `将在「${parent?.name ?? '当前节点'}」下创建${label}。`
                  : needsParent
                    ? `选择父节点并创建${label}。`
                    : `创建一个新的${label}。`}
              </Text>
              {chooseParent && (
                <Field label={parentLabel} hint={parents.length === 0 ? '请先创建上一层节点。' : undefined}>
                  <Dropdown
                    id="create-parent"
                    placeholder="选择父节点"
                    value={parent?.name ?? ''}
                    selectedOptions={parentId ? [parentId] : []}
                    onOptionSelect={(_event, data) => setParentId(data.optionValue ?? '')}
                  >
                    {parents.map((item) => <Option key={item.id} value={item.id}>{item.name}</Option>)}
                  </Dropdown>
                </Field>
              )}
              <Field label="名称">
                <Input
                  id="create-name"
                  autoFocus={!chooseParent}
                  value={name}
                  onChange={(_event, data) => setName(data.value)}
                  placeholder={nodePrompts[kind]}
                  maxLength={80}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button type="button" appearance="secondary" onClick={onClose} disabled={busy}>取消</Button>
              <Button type="submit" appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Add20Regular />} disabled={!canSubmit || busy}>
                创建
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  )
}

export function RenameProjectDialog({
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

export function DeleteDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target?: DeleteTarget
  busy: boolean
  onClose: () => void
  onConfirm: (target: DeleteTarget) => void
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(_event, data) => !data.open && !busy && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>确认删除？</DialogTitle>
          <DialogContent>
            {target?.type === 'node'
              ? `将删除「${target.node.name}」及其下的所有内容。`
              : `将永久删除项目「${target?.name ?? ''}」。`}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={busy} onClick={onClose}>取消</Button>
            <Button
              appearance="primary"
              className="danger-primary-button"
              icon={busy ? <Spinner size="tiny" /> : <Delete20Regular />}
              disabled={busy}
              onClick={() => target && onConfirm(target)}
            >
              删除
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
