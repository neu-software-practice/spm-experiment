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
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  SpinButton,
  type SpinButtonOnChangeData,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
} from '@fluentui/react-components'
import { Add20Regular, Delete20Regular, Edit20Regular, Save20Regular, Sparkle20Filled } from '@fluentui/react-icons'
import { KindIcon } from '@/components/KindVisuals'
import type { GenerateOptions } from '@/api'
import {
  aiCountRange,
  aiDescendantRange,
  aiMaxGeneratedNodes,
  aiPromptMaxLength,
  charCount,
  describeLevelCounts,
  generationPlan,
  levelsBelow,
  nodeLabels,
  nodePrompts,
  type CreateTarget,
  type DeleteTarget,
  type Project,
  type StoryNode,
} from '@/model'

type CreateMode = 'manual' | 'ai'
type GenerateScope = 'children' | 'subtree'

/** Reads a SpinButton change, typed or stepped, clamped to range. */
function spinValue(data: SpinButtonOnChangeData, range: { min: number; max: number }) {
  const next = data.value ?? Number.parseInt(data.displayValue ?? '', 10)
  return Number.isFinite(next) ? Math.min(range.max, Math.max(range.min, Math.round(next))) : undefined
}

export function CreateDialog({
  target,
  parents,
  existingChildren,
  aiEnabled,
  busy,
  onClose,
  onSubmit,
  onGenerate,
}: {
  target?: CreateTarget
  parents: StoryNode[]
  /** Direct children the chosen parent already has, keyed by parent ID. */
  existingChildren: (parentId: string) => number
  aiEnabled: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (name: string, parentId?: string) => void
  onGenerate: (parentId: string, options: GenerateOptions) => void
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState(target?.parentId ?? parents[0]?.id ?? '')
  const [mode, setMode] = useState<CreateMode>(target?.mode ?? 'manual')
  const [count, setCount] = useState(aiCountRange.default)
  const [scope, setScope] = useState<GenerateScope>('children')
  const [descendantCount, setDescendantCount] = useState(aiDescendantRange.default)
  const [prompt, setPrompt] = useState('')
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
  // AI generation always needs a parent node: roles sit at the root and cannot be generated.
  const canGenerate = needsParent
  const aiMode = canGenerate && mode === 'ai'
  const promptLength = charCount(prompt)
  const promptTooLong = promptLength > aiPromptMaxLength
  const lowerLevels = kind === 'project' ? [] : levelsBelow(kind)
  const subtree = lowerLevels.length > 0 && scope === 'subtree'
  const plan = kind === 'project' ? [] : generationPlan(kind, count, subtree ? descendantCount : undefined)
  const planTotal = plan.reduce((sum, level) => sum + level.count, 0)
  const planTooLarge = planTotal > aiMaxGeneratedNodes
  const canSubmit = aiMode
    ? aiEnabled && Boolean(parentId) && !promptTooLong && !planTooLarge
    : Boolean(name.trim()) && (!needsParent || Boolean(parentId))

  const submit = () => {
    if (!canSubmit || busy) return
    if (aiMode) onGenerate(parentId, { count, prompt: prompt.trim(), ...(subtree && { descendantCount }) })
    else onSubmit(name.trim(), parentId || undefined)
  }

  return (
    // Generation can be cancelled mid-flight, so only manual creation locks the dialog open.
    <Dialog open onOpenChange={(_event, data) => !data.open && (!busy || aiMode) && onClose()}>
      <DialogSurface className="create-dialog">
        <form className="dialog-form" onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}>
          <DialogBody>
            <DialogTitle>
              <span className="dialog-title-with-icon" data-kind={kind === 'project' ? undefined : kind}>
                {kind !== 'project' && <KindIcon kind={kind} size={20} />}
                {aiMode ? `AI 生成${label}` : `新增${label}`}
              </span>
            </DialogTitle>
            <DialogContent className="dialog-content">
              {canGenerate && (
                <TabList
                  size="small"
                  selectedValue={aiMode ? 'ai' : 'manual'}
                  onTabSelect={(_event, data) => setMode(data.value as CreateMode)}
                  disabled={busy}
                  className="create-mode-tabs"
                >
                  <Tab value="manual" icon={<Edit20Regular className="icon-edit" />}>手动填写</Tab>
                  <Tab value="ai" icon={<Sparkle20Filled className="icon-ai" />}>AI 生成</Tab>
                </TabList>
              )}
              <Text className="dialog-description">
                {target.parentId
                  ? `将在「${parent?.name ?? '当前节点'}」下${aiMode ? '生成' : '创建'}${label}。`
                  : needsParent
                    ? `选择父节点并${aiMode ? '生成' : '创建'}${label}。`
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
              {aiMode ? (
                <>
                  {!aiEnabled && (
                    <MessageBar intent="warning">
                      <MessageBarBody>后端尚未配置 AI 服务，暂时无法生成。请在后端设置 AI 相关环境变量后重启服务。</MessageBarBody>
                    </MessageBar>
                  )}
                  <Field label="生成数量" hint={`${aiCountRange.min}–${aiCountRange.max} 个`}>
                    <SpinButton
                      id="generate-count"
                      min={aiCountRange.min}
                      max={aiCountRange.max}
                      value={count}
                      disabled={busy || !aiEnabled}
                      onChange={(_event, data) => {
                        const next = spinValue(data, aiCountRange)
                        if (next !== undefined) setCount(next)
                      }}
                    />
                  </Field>
                  {lowerLevels.length > 0 && (
                    <Field label="生成范围">
                      <RadioGroup
                        id="generate-scope"
                        layout="horizontal"
                        value={scope}
                        disabled={busy || !aiEnabled}
                        onChange={(_event, data) => setScope(data.value as GenerateScope)}
                      >
                        <Radio value="children" label={`仅${label}`} />
                        <Radio value="subtree" label={`${label}及所有下级`} />
                      </RadioGroup>
                    </Field>
                  )}
                  {subtree && (
                    <Field
                      label="每个节点的下级数量"
                      hint={`${aiDescendantRange.min}–${aiDescendantRange.max} 个，${lowerLevels.map((level) => nodeLabels[level]).join('、')}每层都按此数量展开`}
                    >
                      <SpinButton
                        id="generate-descendant-count"
                        min={aiDescendantRange.min}
                        max={aiDescendantRange.max}
                        value={descendantCount}
                        disabled={busy || !aiEnabled}
                        onChange={(_event, data) => {
                          const next = spinValue(data, aiDescendantRange)
                          if (next !== undefined) setDescendantCount(next)
                        }}
                      />
                    </Field>
                  )}
                  {subtree && (
                    <MessageBar intent={planTooLarge ? 'error' : 'info'} className="generate-plan">
                      <MessageBarBody>
                        {planTooLarge
                          ? `共 ${planTotal} 个节点，超过单次上限 ${aiMaxGeneratedNodes} 个，请减少数量。`
                          : `将生成 ${describeLevelCounts(plan)}，共 ${planTotal} 个节点。`}
                      </MessageBarBody>
                    </MessageBar>
                  )}
                  <Field
                    label="附加提示词（可选）"
                    validationState={promptTooLong ? 'error' : 'none'}
                    validationMessage={promptTooLong ? `不能超过 ${aiPromptMaxLength} 个字符` : undefined}
                    hint={promptTooLong ? undefined : `${promptLength}/${aiPromptMaxLength}`}
                  >
                    <Textarea
                      id="generate-prompt"
                      value={prompt}
                      resize="vertical"
                      rows={3}
                      disabled={busy || !aiEnabled}
                      placeholder="例如：重点考虑手机端操作，拆分为用户可完成的具体步骤"
                      onChange={(_event, data) => setPrompt(data.value)}
                    />
                  </Field>
                  <Text size={200} className="muted-text ai-note">
                    {parentId
                      ? `已有 ${existingChildren(parentId)} 个${label}，生成结果会追加到末尾并直接保存，可随后编辑或删除。`
                      : '生成结果会追加到父节点下并直接保存。'}
                  </Text>
                </>
              ) : (
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
              )}
            </DialogContent>
            <DialogActions>
              <Button type="button" appearance="secondary" onClick={onClose} disabled={busy && !aiMode}>
                {busy && aiMode ? '取消生成' : '取消'}
              </Button>
              {aiMode ? (
                <Button
                  type="submit"
                  appearance="primary"
                  className="ai-primary-button"
                  icon={busy ? <Spinner size="tiny" /> : <Sparkle20Filled />}
                  disabled={!canSubmit || busy}
                >
                  {busy ? '正在生成…' : `生成 ${planTotal} 个`}
                </Button>
              ) : (
                <Button type="submit" appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Add20Regular />} disabled={!canSubmit || busy}>
                  创建
                </Button>
              )}
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
