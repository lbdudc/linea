import { notify, errorMessage } from 'src/composables/useNotify'

export function offerRollbackUndo({ t, leftVersion, restore, again }) {
  if (!leftVersion) return
  notify({
    type: 'positive',
    timeout: 15000,
    message: t('generation.rollback_done', { version: leftVersion }),
    action: {
      label: t('generation.undo'),
      handler: async () => {
        try {
          if ((await restore(leftVersion)) === false) return
        } catch (error) {
          notify({ type: 'negative', message: errorMessage(error, t) })
          return
        }
        again()
      },
    },
  })
}
