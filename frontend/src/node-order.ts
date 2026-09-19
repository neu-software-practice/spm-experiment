export function insertAfter<T extends { id: string }>(
  items: T[],
  item: T,
  afterID?: string,
) {
  if (!afterID) return [...items, item]
  const anchorIndex = items.findIndex((candidate) => candidate.id === afterID)
  if (anchorIndex < 0) return [...items, item]
  return [
    ...items.slice(0, anchorIndex + 1),
    item,
    ...items.slice(anchorIndex + 1),
  ]
}
