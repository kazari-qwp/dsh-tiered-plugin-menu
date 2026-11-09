/** Same directory boundaries as DSH's Workspace Tree, including Windows paths. */
function folderPath(path: string): string {
  const windows = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
  return (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '')
}

export function parentWorkspace<T extends { id: string; path: string }>(id: string, workspaces: T[]): T | undefined {
  const workspace = workspaces.find(item => item.id === id)
  if (!workspace) return undefined
  const path = folderPath(workspace.path)
  return workspaces.filter(item => {
    const parent = folderPath(item.path)
    return path !== parent && path.startsWith(`${parent}/`)
  }).sort((a, b) => folderPath(b.path).length - folderPath(a.path).length)[0]
}
