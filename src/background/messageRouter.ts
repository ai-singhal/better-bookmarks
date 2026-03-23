import type { ExtensionMessage } from '../shared/types'

export function setupMessageRouter() {
  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      handleMessage(message)
        .then(sendResponse)
        .catch((err) => {
          console.error('[MessageRouter] Error:', err)
          sendResponse({ error: err.message })
        })

      // Return true to indicate async response
      return true
    }
  )
}

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_BOOKMARK_TREE': {
      return chrome.bookmarks.getTree()
    }

    case 'GET_BOOKMARK_COUNT': {
      const tree = await chrome.bookmarks.getTree()
      return countNodes(tree)
    }

    case 'SEARCH_BOOKMARKS': {
      const query = message.payload as string
      return chrome.bookmarks.search(query)
    }

    case 'MOVE_BOOKMARK': {
      const { id, destination } = message.payload as {
        id: string
        destination: { parentId?: string; index?: number }
      }
      return chrome.bookmarks.move(id, destination)
    }

    case 'DELETE_BOOKMARK': {
      const { id } = message.payload as { id: string }
      return chrome.bookmarks.remove(id)
    }

    case 'CREATE_FOLDER': {
      const { parentId, title } = message.payload as {
        parentId: string
        title: string
      }
      return chrome.bookmarks.create({ parentId, title })
    }

    case 'OPEN_DASHBOARD': {
      return chrome.tabs.create({
        url: chrome.runtime.getURL('src/dashboard/index.html'),
      })
    }

    default:
      return { error: `Unknown message type: ${message.type}` }
  }
}

function countNodes(nodes: chrome.bookmarks.BookmarkTreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.url) count++
    if (node.children) count += countNodes(node.children)
  }
  return count
}
