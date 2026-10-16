import type { ReactNode } from 'react'

/** **bold** and `code`; everything else stays plain text. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const key = `${keyPrefix}-${match.index}`
    parts.push(match[1] !== undefined ? <strong key={key}>{match[1]}</strong> : <code key={key}>{match[2]}</code>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

type Block =
  | { type: 'p'; lines: string[] }
  | { type: 'h'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'table'; rows: string[][] }

function blocks(source: string) {
  const out: Block[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()
    const last = out.at(-1)
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)、]\s+(.*)$/.exec(line)
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const row = /^\s*\|(.*)\|\s*$/.exec(line)
    if (row) {
      const cells = row[1].split('|').map((cell) => cell.trim())
      // The |---|---| line only separates the header.
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
      if (last?.type === 'table') last.rows.push(cells)
      else out.push({ type: 'table', rows: [cells] })
    } else if (!line.trim()) {
      out.push({ type: 'p', lines: [] })
    } else if (heading) {
      out.push({ type: 'h', text: heading[1] })
    } else if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol'
      const text = (bullet ?? numbered)![1]
      if (last?.type === type) last.items.push(text)
      else out.push({ type, items: [text] })
    } else if (last?.type === 'p') {
      last.lines.push(line)
    } else {
      out.push({ type: 'p', lines: [line] })
    }
  }
  return out.filter((block) => block.type !== 'p' || block.lines.length > 0)
}

/** Renders the small Markdown subset the assistant uses, without injecting HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {blocks(text).map((block, index) => {
        const key = `b${index}`
        switch (block.type) {
          case 'h':
            return <p key={key} className="markdown-heading">{inline(block.text, key)}</p>
          case 'table': {
            const [head, ...body] = block.rows
            return (
              <div key={key} className="markdown-table">
                <table>
                  <thead><tr>{head.map((cell, i) => <th key={i}>{inline(cell, `${key}-h${i}`)}</th>)}</tr></thead>
                  <tbody>
                    {body.map((cells, r) => (
                      <tr key={r}>{cells.map((cell, i) => <td key={i}>{inline(cell, `${key}-${r}-${i}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          case 'ul':
          case 'ol': {
            const List = block.type
            return <List key={key}>{block.items.map((item, i) => <li key={i}>{inline(item, `${key}-${i}`)}</li>)}</List>
          }
          default:
            return (
              <p key={key}>
                {block.lines.flatMap((line, i) => i === 0 ? inline(line, `${key}-${i}`) : [<br key={`br${i}`} />, ...inline(line, `${key}-${i}`)])}
              </p>
            )
        }
      })}
    </div>
  )
}
