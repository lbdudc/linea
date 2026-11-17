import ModulePicker from './ModulePicker.vue'
import MetamodelPicker from './MetamodelPicker.vue'
import { toMap } from './chosenPackages'

/** The kinds of line the creation form offers besides the plain one (the feature metamodel only). */
export const lineKinds = [
  {
    kind: 'project',
    order: 10,
    icon: 'pi-folder',
    label: 'modules.line_project',
    title: 'creation.title_project',
    hint: 'modules.line_project_hint',
    stepTitle: 'creation.step_contents_metamodels',
    picker: MetamodelPicker,
    initial: () => [],
    toPayload: (selection) => ({ metamodels: toMap(selection) }),
    // a project needs the metamodels it chose checked
    blocker: ({ report }) => (report === null ? 'creation.need_metamodels_check' : report.ok !== true ? 'creation.need_fit' : ''),
  },
  {
    kind: 'modular',
    order: 20,
    icon: 'pi-th-large',
    label: 'modules.line_modular',
    title: 'creation.title_modular',
    hint: 'modules.line_modular_hint',
    stepTitle: 'creation.step_contents_modules',
    picker: ModulePicker,
    initial: () => [],
    toPayload: (selection) => ({ modules: toMap(selection) }),
    // modules can be added later: with none chosen it can be created, with some they have to fit
    blocker: ({ selection, report }) => (selection.length && report?.ok !== true ? 'creation.need_fit' : ''),
  },
]
