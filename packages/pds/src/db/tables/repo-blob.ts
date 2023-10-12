export interface RepoBlob {
  cid: string
  recordUri: string
  repoRev: string | null
  did: string
  takedownId: string | null
}

export const tableName = 'repo_blob'

export type PartialDB = { [tableName]: RepoBlob }