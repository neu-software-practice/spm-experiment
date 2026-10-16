import { Button, Divider, Text } from '@fluentui/react-components'
import {
  Add20Regular,
  Board20Regular,
  CheckmarkCircle16Filled,
  Dismiss20Regular,
  Folder20Filled,
  FolderOpen20Filled,
  Sparkle16Filled,
} from '@fluentui/react-icons'
import type { Project } from '@/model'

export function ProjectSidebar({
  projects,
  activeId,
  open,
  aiEnabled,
  onSelect,
  onCreate,
  onClose,
}: {
  projects: Project[]
  activeId?: string
  open: boolean
  aiEnabled?: boolean
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
            title="关闭项目导航"
            onClick={onClose}
          />
        </div>
        <Divider className="sidebar-divider" />
        <div className="sidebar-section-heading">
          <Text size={200} weight="semibold">项目</Text>
          <Button
            appearance="subtle"
            size="small"
            icon={<Add20Regular />}
            className="icon-add"
            aria-label="新建项目"
            title="新建项目"
            onClick={onCreate}
          />
        </div>
        <nav className="project-list" aria-label="项目列表">
          {projects.map((item) => {
            const active = item.id === activeId
            return (
              <button
                key={item.id}
                type="button"
                className={`project-nav-item${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  onSelect(item.id)
                  onClose()
                }}
              >
                {active ? <FolderOpen20Filled className="project-folder-icon" /> : <Folder20Filled className="project-folder-icon" />}
                <span>{item.name}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <Button appearance="secondary" icon={<Add20Regular />} className="sidebar-create icon-add" onClick={onCreate}>
            新建项目
          </Button>
          <div className="sidebar-status">
            <span className="autosave-status"><CheckmarkCircle16Filled />自动保存</span>
            {aiEnabled !== undefined && (
              <span
                className={`ai-status${aiEnabled ? ' is-enabled' : ''}`}
                title={aiEnabled ? 'AI 生成已启用' : '后端未配置 AI 服务'}
              >
                <Sparkle16Filled />{aiEnabled ? 'AI 已启用' : 'AI 未配置'}
              </span>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
