import type { BookmarkTreeSnapshotSummary } from '../shared/types'
import type { AIAction } from './openaiService'
import {
  compareCurrentTreeWithLatestSnapshot,
  createBookmarkTreeSnapshot,
} from './bookmarkSnapshotService'

function getExecutableActions(actions: AIAction[]): AIAction[] {
  return actions.filter((action) => action.type !== 'search_results')
}

export function isMajorAiChange(actions: AIAction[]): boolean {
  const executable = getExecutableActions(actions)
  const structuralCount = executable.filter((action) =>
    action.type === 'move' ||
    action.type === 'reorder' ||
    action.type === 'create_folder' ||
    action.type === 'delete'
  ).length

  const deleteCount = executable.filter((action) => action.type === 'delete').length
  return deleteCount > 0 || structuralCount >= 3
}

function buildActionSummary(actions: AIAction[]): string {
  const counts: Record<string, number> = {}
  for (const action of getExecutableActions(actions)) {
    counts[action.type] = (counts[action.type] || 0) + 1
  }

  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type.replace('_', ' ')}${count === 1 ? '' : 's'}`)
    .join(', ')
}

function describeLatestSnapshot(
  latestSnapshot: BookmarkTreeSnapshotSummary | null,
  matchesCurrentTree: boolean | null
): string {
  if (!latestSnapshot) {
    return 'No bookmark snapshot exists yet.'
  }

  const timestamp = new Date(latestSnapshot.createdAt).toLocaleString()
  if (matchesCurrentTree === true) {
    return `Your latest snapshot from ${timestamp} already matches the current tree.`
  }

  if (matchesCurrentTree === false) {
    return `Your latest snapshot from ${timestamp} is different from the current tree.`
  }

  return `Your latest snapshot from ${timestamp} could not be compared cleanly.`
}

export async function confirmSnapshotProtection(actions: AIAction[]): Promise<boolean> {
  if (!isMajorAiChange(actions)) {
    return true
  }

  const executable = getExecutableActions(actions)
  const snapshotAction = executable.find((action) => action.type === 'create_snapshot')
  const summary = buildActionSummary(actions)
  const { latestSnapshot, matchesCurrentTree } = await compareCurrentTreeWithLatestSnapshot()
  const comparisonLine = describeLatestSnapshot(latestSnapshot, matchesCurrentTree)

  if (snapshotAction) {
    return window.confirm(
      `This AI plan will make major bookmark changes (${summary}). ${comparisonLine} It already includes creating a snapshot${snapshotAction.title ? ` named "${snapshotAction.title}"` : ''} first. Continue?`
    )
  }

  const createSnapshotFirst = window.confirm(
    `This AI plan will make major bookmark changes (${summary}). ${comparisonLine} Create a fresh snapshot before continuing?`
  )

  if (createSnapshotFirst) {
    try {
      await createBookmarkTreeSnapshot(`Pre-AI change ${new Date().toLocaleString()}`)
      return true
    } catch (err) {
      return window.confirm(
        `Creating a snapshot failed: ${err instanceof Error ? err.message : 'Unknown error'}. Continue without creating a new snapshot?`
      )
    }
  }

  return window.confirm(
    `Continue without creating a new snapshot before applying these changes (${summary})?`
  )
}
