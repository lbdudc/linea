const routes = [{
    path: '/',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/IndexPage.vue') }
    ],
    meta: { requiresAuth: true } 
  },
  {
    path: '/add',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/LineCreationForm.vue') }
    ],
    meta: { requiresAuth: true } 
  },
  {
    path: '/login',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('components/user/LoginForm.vue') }
    ],
  },
  {
    path: '/lines',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/LineManagement.vue') }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/products',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/ProductManagement.vue') }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/cicd',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/DeploymentsPage.vue') }
    ],
    meta: { requiresAuth: true }
  },
  // the old addresses of the CI/CD view: it was the deployments, and the scheduler of syncs was apart
  { path: '/deployments', redirect: '/cicd' },
  { path: '/scheduler', redirect: '/cicd' },
  {
    path: '/lines/:id',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/LineDetail.vue'), props: true}
    ],
    meta: { requiresAuth: true } 
  },
  {
    path: '/lines/:id/new-product',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/ProductCreationForm.vue'), props: true}
    ],
    meta: { requiresAuth: true } 
  },
  {
    path: '/products/:id/rename',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { 
        path: '', 
        component: () => import('pages/ProductCreationForm.vue'), 
        props: (route) => ({
          ...route.params,
          renaming: true
        })
      }
    ],
    meta: { requiresAuth: true } 
  },
  {
    // the configuration of this LINEA, in sections (git hosts, plugins, people)
    path: '/settings/:section?',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/ConfigurationPage.vue') }
    ],
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    // the models of a product are in its "models" tab
    path: '/products/:id/models',
    redirect: (to) => ({ path: `/products/${to.params.id}`, query: { tab: 'models' } }),
  },
  {
    path: '/lines/:id/model',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/FeatureModelEditor.vue'), props: true}
    ],
    meta: { requiresAuth: true } 
  },
  {
    path: '/products/:id',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/ProductDetail.vue'), props: true}
    ],
    meta: { requiresAuth: true }
  },
  // modules and metamodels are managed apart: each has its list and its detail page
  // (the old page, with a selector for the kind, is `/modules`: links to it, and to `/packages/<kind>/<id>`, still work)
  { path: '/modules', redirect: (to) => (to.query.kind === 'metamodel' ? '/packages/metamodels' : '/packages/modules') },
  { path: '/metamodels', redirect: '/packages/metamodels' },
  { path: '/packages/module/:id', redirect: (to) => `/packages/modules/${to.params.id}` },
  { path: '/packages/metamodel/:id', redirect: (to) => `/packages/metamodels/${to.params.id}` },
  {
    path: '/packages/modules',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/modules/PackageRegistry.vue'), props: { kind: 'module' } }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/packages/metamodels',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/modules/PackageRegistry.vue'), props: { kind: 'metamodel' } }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/packages/modules/:id',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/modules/PackageDetail.vue'), props: (route) => ({ kind: 'module', id: route.params.id }) }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/packages/metamodels/:id',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/modules/PackageDetail.vue'), props: (route) => ({ kind: 'metamodel', id: route.params.id }) }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/lines/:id/metamodels',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/modules/LineMetamodels.vue'), props: true }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/lines/:id/modules',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/modules/LineModules.vue'), props: true }
    ],
    meta: { requiresAuth: true }
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('layouts/DashboardLayout.vue'),
    children: [
      { path: '', component: () => import('pages/ErrorNotFound.vue') }
    ],
    meta: { requiresAuth: true }
  }

]

export default routes
