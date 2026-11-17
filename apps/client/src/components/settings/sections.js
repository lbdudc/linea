import { defineAsyncComponent } from 'vue'

// The sections of the configuration view, in the order they are listed. A new kind of configuration is one entry here and one component.
export const sections = [
  { key: 'git-hosts', icon: 'pi-server', labelKey: 'git_hosts.nav', component: defineAsyncComponent(() => import('./GitHostsSection.vue')) },
  { key: 'plugins', icon: 'pi-objects-column', labelKey: 'plugins.nav', component: defineAsyncComponent(() => import('./PluginsSection.vue')) },
  { key: 'sign-in', icon: 'pi-shield', labelKey: 'instance.sign_in.nav', component: defineAsyncComponent(() => import('./SignInSection.vue')) },
  { key: 'modules', icon: 'pi-box', labelKey: 'instance.modules.nav', component: defineAsyncComponent(() => import('./ModulesSection.vue')) },
  { key: 'users', icon: 'pi-users', labelKey: 'users.nav', component: defineAsyncComponent(() => import('./UsersSection.vue')) },
  { key: 'audit', icon: 'pi-history', labelKey: 'audit.nav', component: defineAsyncComponent(() => import('./AuditSection.vue')) },
  { key: 'backup', icon: 'pi-download', labelKey: 'backup.nav', component: defineAsyncComponent(() => import('./BackupSection.vue')) },
]

export const sectionOf = (key) => sections.find((section) => section.key === key)
