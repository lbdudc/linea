import { reactive } from 'vue'

export const searchDialog = reactive({ open: false })

export const openSearch = () => { searchDialog.open = true }
