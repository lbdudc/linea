// gitlab-commando ships no declarations: just what the GitLab provider uses of it.
declare module 'gitlab-commando' {
  export class GitLabError extends Error {
    status?: number
  }
  export class GitLabAuthError extends Error {
    status?: number
  }
  export class GitLabSession {
    constructor(url: string)
    rollback(): Promise<void>
    requestAccessToken(code: string, clientId: string | undefined, clientSecret: string | undefined, redirectUri: string): Promise<any>
    refreshAccessToken(refreshToken: string, clientId: string | undefined, clientSecret: string | undefined, redirectUri: string): Promise<any>
    getUserData(token: string): Promise<any>
    createGroup(token: string, name: string, parentId?: number | string): Promise<any>
    deleteGroup(token: string, id: number | string): Promise<any>
    renameGroup(token: string, id: number | string, name: string): Promise<any>
    createProject(token: string, name: string, namespaceId?: number | string, topics?: string[], branch?: string): Promise<any>
    deleteProject(token: string, id: number | string): Promise<any>
    renameProject(token: string, id: number | string, name: string): Promise<any>
    setDefaultBranch(token: string, id: number | string, branch: string): Promise<any>
    getProjectMembers(token: string, id: number | string): Promise<any[]>
    getFile(token: string, id: number | string, path: string, ref: string): Promise<any>
    createFile(token: string, id: number | string, path: string, branch: string, content: string): Promise<any>
    saveFile(token: string, id: number | string, path: string, branch: string, content: string): Promise<any>
    commit(token: string, id: number | string, actions: unknown[], message: string, branch: string): Promise<any>
    createBranch(token: string, id: number | string, branch: string, ref: string): Promise<any>
    createTag(token: string, id: number | string, tag: string, ref: string): Promise<any>
    createMergeRequest(token: string, id: number | string, title: string, source: string, target: string): Promise<any>
    createOrRenameMergeRequest(token: string, id: number | string, title: string, source: string, target?: string): Promise<any>
  }
}
