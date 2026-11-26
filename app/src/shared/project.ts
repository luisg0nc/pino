/** A folder with a board in it, as pino has it open. */
export interface ProjectInfo {
  /** `p` and 12 hex characters of a hash of the folder's real path: one URL segment, whatever the path is. */
  id: string
  /** The folder's real path. */
  dir: string
  name: string
}

/** A project opened before, as the first screen and the title bar list it. */
export interface RecentFolder {
  root: string
  /** The folder is no longer there. */
  missing: boolean
}
