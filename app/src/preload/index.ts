import { contextBridge, ipcRenderer } from 'electron'
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
  project: {
    pick: () => invoke('project:pick'),
    open: (dir) => invoke('project:open', dir),
    current: () => invoke('project:current'),
    recent: () => invoke('project:recent'),
    close: () => invoke('project:close')
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
    onState: (cb) => subscribe('build:state', cb)
  },
  notices: {
    onNotice: (cb) => subscribe('notice', cb)
  }
}

contextBridge.exposeInMainWorld(APP.bridge, bridge)
