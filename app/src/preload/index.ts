import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { APP } from '../shared/app'
import type { PinoBridge } from '../shared/bridge'

// Channel names are those of src/main/ipc.ts.
function subscribe<T>(channel: string, cb: (message: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, message: T) => cb(message)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/** An invoke whose rejection carries the message main gave, without what Electron puts before it. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
  }
}

const bridge: PinoBridge = {
  home: process.env.HOME ?? '',
  workspace: {
    current: () => invoke('workspace:current'),
    pick: () => invoke('workspace:pick'),
    open: (root) => invoke('workspace:open', root),
    suggested: () => invoke('workspace:suggested'),
    useSuggested: () => invoke('workspace:useSuggested'),
    recent: () => invoke('workspace:recent'),
    list: () => invoke('workspace:list')
  },
  project: {
    open: (name) => invoke('project:open', name),
    close: () => invoke('project:close'),
    thumb: (name) => invoke('project:thumb', name),
    saveThumb: (projectId, hash, png) => invoke('project:saveThumb', projectId, hash, png),
    create: (req) => invoke('project:create', req),
    pickPhotos: () => invoke('project:pickPhotos'),
    pickPdf: () => invoke('project:pickPdf'),
    readPhoto: (path) => invoke('project:readPhoto', path),
    pathOf: (file) => webUtils.getPathForFile(file),
    taken: () => invoke('project:taken'),
    onboard: (projectId, draft) => invoke('project:onboard', projectId, draft),
    previewPrompt: (name, draft) => invoke('project:previewPrompt', name, draft)
  },
  parts: {
    lookup: (lcsc) => invoke('parts:lookup', lcsc)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb) => subscribe('window:maximized', cb)
  },
  session: {
    current: (projectId) => invoke('session:current', projectId),
    start: (projectId, opts) => invoke('session:start', projectId, opts),
    trust: (projectId) => invoke('session:trust', projectId),
    stop: (sessionId) => invoke('session:stop', sessionId),
    onStatus: (cb) => subscribe('session:status', cb)
  },
  chat: {
    history: (sessionId) => invoke('chat:history', sessionId),
    lastConversation: (projectId) => invoke('chat:lastConversation', projectId),
    send: (sessionId, prompt) => invoke('chat:send', sessionId, prompt),
    answer: (sessionId, requestId, answer) => ipcRenderer.send('chat:answer', sessionId, requestId, answer),
    interrupt: (sessionId) => invoke('chat:interrupt', sessionId),
    setModel: (sessionId, model) => invoke('chat:setModel', sessionId, model),
    setMode: (sessionId, mode) => invoke('chat:setMode', sessionId, mode),
    setEffort: (sessionId, effort) => invoke('chat:setEffort', sessionId, effort),
    prompts: (projectId) => invoke('chat:prompts', projectId),
    models: () => invoke('chat:models'),
    onItem: (cb) => subscribe('chat:item', cb),
    onMeta: (cb) => subscribe('chat:meta', cb),
    onCapabilities: (cb) => subscribe('chat:capabilities', cb)
  },
  build: {
    state: (projectId) => invoke('build:state', projectId),
    rebuild: (projectId) => invoke('build:rebuild', projectId),
    result: (projectId, hash) => invoke('build:result', projectId, hash),
    file: (projectId, hash, name) => invoke('build:file', projectId, hash, name),
    routeFile: (projectId, key, name) => invoke('build:routeFile', projectId, key, name),
    onState: (cb) => subscribe('build:state', cb),
    engineInfo: () => invoke('build:engineInfo')
  },
  view: {
    tell: (projectId, view) => invoke('view:tell', projectId, view),
    onAsk: (cb) => subscribe('view:ask', cb),
    answer: (id, result) => ipcRenderer.send('view:answer', id, result)
  },
  route: {
    start: (projectId) => invoke('route:start', projectId),
    cancel: (projectId) => invoke('route:cancel', projectId)
  },
  fab: {
    state: (projectId) => invoke('fab:state', projectId),
    readiness: (projectId) => invoke('fab:readiness', projectId),
    release: (projectId) => invoke('fab:release', projectId),
    cancel: (projectId) => invoke('fab:cancel', projectId),
    profiles: () => invoke('fab:profiles'),
    showFolder: (projectId) => invoke('fab:showFolder', projectId),
    onState: (cb) => subscribe('fab:state', cb)
  },
  marks: {
    list: (projectId) => invoke('marks:list', projectId),
    add: (projectId, mark) => invoke('marks:add', projectId, mark),
    update: (projectId, id, patch) => invoke('marks:update', projectId, id, patch),
    remove: (projectId, id) => invoke('marks:remove', projectId, id),
    resolve: (projectId, id, note) => invoke('marks:resolve', projectId, id, note),
    onChange: (cb) => subscribe('marks:changed', cb)
  },
  cards: {
    read: (projectId) => invoke('cards:read', projectId),
    change: (projectId, change) => invoke('cards:change', projectId, change),
    brief: (projectId) => invoke('cards:brief', projectId),
    references: (projectId) => invoke('cards:references', projectId),
    reference: (projectId, file) => invoke('cards:reference', projectId, file),
    openLink: (projectId, cardId, nth) => invoke('cards:openLink', projectId, cardId, nth),
    seen: (projectId) => invoke('cards:seen', projectId),
    markSeen: (projectId) => invoke('cards:markSeen', projectId),
    restock: (projectId, cardId) => invoke('cards:restock', projectId, cardId),
    onChanged: (cb) => subscribe('cards:changed', cb),
    onBriefChanged: (cb) => subscribe('cards:briefChanged', cb)
  },
  notices: {
    onNotice: (cb) => subscribe('notice', cb)
  }
}

contextBridge.exposeInMainWorld(APP.bridge, bridge)
