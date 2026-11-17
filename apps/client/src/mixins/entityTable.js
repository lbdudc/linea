/**
 * Shared list/delete plumbing for the management tables (Options API).
 * Mirrors `tableData` into a local `data` array, exposes the delete-dialog
 * state, and provides a generic row remover + name filter.
 *
 * Hosts must declare a `tableData: Array` prop.
 */
import { notify } from 'src/composables/useNotify'

export default {
  data() {
    return {
      data: [],
      selected: null,
      confirm_delete: false,
      deleteLoading: false,
      error: null,
    }
  },
  watch: {
    tableData(newVal) { this.data = newVal },
  },
  created() {
    this.data = this.tableData
  },
  methods: {
    filterByName(rows, terms) {
      const lower = (terms ?? '').toLowerCase()
      return rows.filter(row => (row.name ?? '').toLowerCase().includes(lower))
    },
    // Runs `deleteFn(id)`, drops the row from `data` on success.
    // Returns true on success, false on failure.
    async removeRow(deleteFn, id) {
      try {
        this.deleteLoading = true
        await deleteFn(id)
        this.data = this.data.filter(row => row._id !== id)
        return true
      } catch (error) {
        this.error = error.response?.data?.error
        // None of this mixin's consumers render `this.error` anywhere, so a failed
        // delete used to close the confirm dialog and leave the row sitting there
        // with zero feedback — silently indistinguishable from success.
        notify({
          type: 'negative',
          message: this.error ? this.$t(this.error) : this.$t('error_messages.internal_error'),
          position: 'bottom-right',
        })
        return false
      } finally {
        this.deleteLoading = false
        this.selected = null
      }
    },
  },
}
