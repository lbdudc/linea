// bango's views of a model; what each one shows is in its README. A metamodel may bring views of its own (a class diagram for the data
// model, ...): they come after these, from the workbench.
export const BASIC_VIEWS = [
  { id: 'text', label: 'view_text', icon: 'pi-align-left' },
  { id: 'form', label: 'view_form', icon: 'pi-list' },
]

export const MODEL_VIEWS = [
  ...BASIC_VIEWS,
  { id: 'diagram', label: 'view_diagram', icon: 'pi-share-alt' },
  { id: 'ast', label: 'view_ast', icon: 'pi-sitemap' },
  { id: 'json', label: 'view_json', icon: 'pi-code' },
  { id: 'project-json', label: 'view_project_json', icon: 'pi-file-export' },
]
