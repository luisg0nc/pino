import type { ProjectInfo } from './project'

/** A folder of the workspace, as the page of projects and the title bar list it. `empty`: it has neither file. */
export interface ListedProject { name: string; dir: string; board: boolean; brief: boolean; empty: boolean }
/** The folder of boards that is open. */
export interface WorkspaceInfo { root: string; name: string; projects: ListedProject[] }
/** What a folder given to pino opened: a workspace, and the project of it when the folder was one. */
export interface OpenFolder { workspace: WorkspaceInfo; project: ProjectInfo | null }
