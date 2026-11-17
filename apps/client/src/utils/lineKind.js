export const LINE_KINDS = [
  { kind: 'plain', icon: 'pi-file', label: 'modules.line_plain', severity: 'secondary' },
  { kind: 'project', icon: 'pi-folder', label: 'modules.line_project', severity: 'info' },
  { kind: 'modular', icon: 'pi-th-large', label: 'modules.line_modular', severity: 'success' },
]

/** The kind of a line; one that does not say is a plain one, as the server takes it. */
export const lineKindOf = (line) => LINE_KINDS.find(({ kind }) => kind === line?.kind) ?? LINE_KINDS[0]
