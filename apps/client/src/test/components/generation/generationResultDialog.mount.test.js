import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import GenerationResultDialog from 'components/generation/GenerationResultDialog.vue'

const { service } = vi.hoisted(() => ({
  service: {
    getVersion: vi.fn(),
    getPipeline: vi.fn(),
    retryPipeline: vi.fn(),
    getJobTrace: vi.fn().mockResolvedValue({ trace: 'expected 3 features, received 2' }),
    versionZip: vi.fn(),
  },
}))
vi.mock('src/services/productService', () => ({ default: service }))

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const text = () => document.body.textContent.replace(/\s+/g, ' ')

const run = (extra = {}) => ({
  id: 'r1',
  productId: 'p1',
  name: 'Tienda',
  fromVersion: '1.0.0',
  toVersion: '1.0.1',
  status: 'success',
  messages: [],
  result: { changed: true, conflicts: false },
  deployable: true,
  startedAt: new Date(),
  ...extra,
})

const snapshot = {
  version: '1.0.1',
  spec: { basicData: { name: 'Tienda', version: '1.0.1' }, features: ['Core', 'Maps'] },
  models: { basic: 'a\nb' },
  previous: { version: '1.0.0', spec: { basicData: { name: 'Tienda', version: '1.0.0' }, features: ['Core'] }, models: { basic: 'a' } },
}

const failedPipeline = {
  pipeline: { id: 7, status: 'failed', webUrl: 'http://git/-/pipelines/7', createdAt: new Date().toISOString(), ref: 'main' },
  jobs: [
    { id: 1, name: 'build', stage: 'build', status: 'success', duration: 6, webUrl: '' },
    { id: 2, name: 'test', stage: 'test', status: 'failed', duration: 6, webUrl: '' },
    { id: 3, name: 'deploy', stage: 'deploy', status: 'skipped', duration: null, webUrl: '' },
  ],
  failed: { id: 2, name: 'test', trace: 'expected 3 features, received 2' },
}

const mounted = []
function mountDialog(runs) {
  const wrapper = mount(GenerationResultDialog, {
    attachTo: document.body,
    props: { visible: true, runs },
    global: { plugins: mountGlobalPlugins() },
  })
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  service.getVersion.mockResolvedValue(snapshot)
  service.getPipeline.mockResolvedValue({ pipeline: null, jobs: [], failed: null })
})
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const located = () => [...document.body.querySelectorAll('.gr__located-log')].map((row) => row.textContent)
const click = async (name) => {
  document.body.querySelector(`[name="${name}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await settle()
}

describe('GenerationResultDialog: from a drawing to its log', () => {
  const made = [
    { message: 'log.resolving_module', params: ['lbdudc/main-component', '1.0.0'], type: 'info' },
    { message: 'log.resolving_metamodel', params: ['lbdudc/basic-metamodel', '1.0.0', 'lbdudc/main-component'], type: 'info' },
    { message: 'log.checking_product', type: 'info' },
    { message: 'log.composing_platform', type: 'info' },
    { message: 'log.deriving_code', type: 'info' },
    { message: 'log.prettied_code', type: 'info' },
  ]

  it('opens the steps and marks what tells about the module that was clicked, and unmarks it on a second click', async () => {
    mountDialog([run({ status: 'running', messages: made })])
    await settle()
    const body = document.body.querySelector('[name="gr-log-body"]')
    expect(body.style.display).toBe('none')
    await click('gflow-node-main')
    expect(body.style.display).not.toBe('none')
    expect(located()).toHaveLength(1)
    expect(located()[0]).toContain('main-component')
    await click('gflow-node-main')
    expect(located()).toHaveLength(0)
  })

  it('marks all that a stage told', async () => {
    mountDialog([run({ status: 'running', messages: made })])
    await settle()
    await click('gflow-stage-derive')
    expect(located()).toHaveLength(2)
  })

  it('does not answer on a stage the log has not reached', async () => {
    mountDialog([run({ status: 'running', messages: made.slice(0, 2) })])
    await settle()
    const stage = document.body.querySelector('[name="gflow-stage-derive"]')
    expect(stage.getAttribute('role')).toBeNull()
    await click('gflow-stage-derive')
    expect(located()).toHaveLength(0)
    expect(document.body.querySelector('[name="gr-log-body"]').style.display).toBe('none')
  })

  it('takes the error to the stage that failed, and marks its notice', async () => {
    mountDialog([run({ status: 'error', result: null, messages: [...made.slice(0, 3), { message: 'error_messages.internal_error', type: 'error' }] })])
    await settle()
    await click('gflow-stage-check')
    expect(located()).toHaveLength(2)
    expect(document.body.querySelector('[name="gr-failed"]').className).toContain('gr__located')
  })

  it('marks any step of the one drawing and its log, in the same step', async () => {
    const messages = [
      ...made,
      { message: 'log.generated_product', type: 'success' },
      { message: 'log.created_branch', params: ['generation/1.0.1', 'bigbang'], type: 'info' },
      { message: 'log.commited_generation', params: ['generation/1.0.1'], type: 'info' },
      { message: 'log.created_merge_request', params: ['generation/1.0.1', 'bigbang'], type: 'info' },
      { message: 'log.merged_merge_request_deleted', params: ['generation/1.0.1', 'bigbang'], type: 'info' },
      { message: 'log.created_merge_request', params: ['bigbang', 'main'], type: 'info' },
      { message: 'log.merged_merge_request', params: ['bigbang', 'main'], type: 'success' },
    ]
    mountDialog([run({ messages })])
    await settle()
    await click('cflow-step-release')
    expect(located()).toHaveLength(1)
    expect(document.body.querySelector('[name="gr-deploy-log-body"]').style.display).not.toBe('none')
    expect(document.body.querySelector('[name="gr-pipeline"]').className).toContain('gr__located')
    expect(document.body.querySelectorAll('[name="commit-flow"]')).toHaveLength(1)
    await click('cflow-step-request')
    expect(located()).toHaveLength(1)
    expect(located()[0]).toContain('generation/1.0.1')
  })
})

describe('GenerationResultDialog', () => {
  it('summarises what changed against the previous version and opens its detail', async () => {
    mountDialog([run()])
    await settle()
    expect(service.getVersion).toHaveBeenCalledWith({ id: 'p1', version: '1.0.1', previous: '1.0.0' })
    const summary = document.body.querySelector('[name="gr-changes-summary"]')
    expect(summary).toBeTruthy()
    expect(summary.textContent).toContain('+1')
    expect(summary.textContent).toContain('1 modelos')
  })

  it('shows the jobs of a failed pipeline, opening the failed one to what it printed, and runs it again', async () => {
    service.getPipeline.mockResolvedValue(failedPipeline)
    const running = { ...failedPipeline, pipeline: { ...failedPipeline.pipeline, status: 'running' }, jobs: [], failed: null }
    service.retryPipeline.mockImplementation(async () => { service.getPipeline.mockResolvedValue(running); return running })
    mountDialog([run()])
    await settle()

    expect(document.body.querySelectorAll('.pjobs__job')).toHaveLength(3)
    // the failed job opens by itself and shows what it printed
    expect(document.body.querySelector('[name="pjob-trace-test"]').textContent).toContain('expected 3 features, received 2')

    document.body.querySelector('[name="gr-pipeline-retry"]').click()
    await settle()
    expect(service.retryPipeline).toHaveBeenCalledWith({ id: 'p1' })
    expect(document.body.querySelector('[name="gr-pipeline-failed"]')).toBeFalsy()
  })

  it('highlights going back when the pipeline failed, and says what it will make', async () => {
    service.getPipeline.mockResolvedValue(failedPipeline)
    const wrapper = mountDialog([run()])
    await settle()

    const back = document.body.querySelector('[name="gr-rollback"]')
    expect(back.textContent).toContain('v1.0.0')
    expect(back.className).not.toContain('p-button-text')

    back.click()
    await settle()
    expect(text()).toContain('se generará como v1.0.2')

    document.body.querySelector('[name="gr-rollback-confirm"]').click()
    expect(wrapper.emitted('rollback')[0][0]).toEqual({ productId: 'p1', version: '1.0.0' })
  })

  it('marks the version of what is queued as estimated and lets it leave the queue', async () => {
    const wrapper = mountDialog([
      run({ id: 'a', productId: 'pa', name: 'A', status: 'running', result: null }),
      run({ id: 'b', productId: 'pb', name: 'B', status: 'pending', result: null, fromVersion: '2.0.0', toVersion: '2.0.1' }),
    ])
    await settle()
    document.body.querySelector('[name="gr-row-pb"]').click()
    await settle()

    expect(document.body.querySelector('.gr__estimated')).toBeTruthy()
    expect(document.body.querySelector('[name="gr-row-pb"]').textContent).toContain('≈')

    document.body.querySelector('[name="gr-cancel-queued"]').click()
    expect(wrapper.emitted('cancel')[0]).toEqual(['b'])
  })

  describe('the steps of each stage', () => {
    const log = [{ type: 'info', message: 'log.resolving_module', params: ['gitlab:linea/modules/main-component', '0.4.0', []], createdAt: new Date() }]
    const isShown = (name) => document.body.querySelector(`[name="${name}-body"]`).style.display !== 'none'

    it('draws the generation, with its log closed until it is asked for', async () => {
      mountDialog([run({ status: 'running', result: null, messages: log })])
      await settle()
      expect(document.body.querySelector('[name="gflow-node-main"]')).toBeTruthy()
      expect(document.body.querySelector('[name="gflow-node-main"]').getAttribute('class')).toContain('gflow__node--downloading')
      expect(isShown('gr-log')).toBe(false)

      document.body.querySelector('[name="gr-log-toggle"]').click()
      await settle()
      expect(isShown('gr-log')).toBe(true)
      expect(document.body.querySelector('[name="gr-log-toggle"]').getAttribute('aria-expanded')).toBe('true')
    })

    it('opens the log of a generation that failed', async () => {
      mountDialog([run({ status: 'error', result: null, messages: [...log, { type: 'error', message: 'error_messages.internal_error', createdAt: new Date() }] })])
      await settle()
      expect(isShown('gr-log')).toBe(true)
    })

    it('tells the commit and the deployment together, after the generation', async () => {
      const at = new Date()
      mountDialog([run({
        status: 'running', result: null,
        messages: [
          ...log,
          { type: 'success', message: 'log.generated_product', params: ['1.0.1'], createdAt: at },
          { type: 'info', message: 'log.created_branch', params: ['generation/1.0.1', 'bigbang'], createdAt: at },
          { type: 'info', message: 'log.waiting_checks', createdAt: at },
        ],
      })])
      service.getLatestMergeRequest = vi.fn().mockResolvedValue(null)
      await settle()
      expect(document.body.querySelector('[name="gr-step-generate"]').className).toContain('gr__step-btn--done')
      expect(document.body.querySelector('[name="gr-step-commit"]')).toBeFalsy()
      expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--active')
      expect(document.body.querySelector('[name="cflow-step-branch"]').getAttribute('class')).toContain('cflow__node--done')
      expect(document.body.querySelector('[name="gr-deploy-log-count"]').textContent).toContain('2')
      expect(document.body.querySelector('[name="gr-log-count"]').textContent).toContain('2')
    })

    describe('when the checks did not pass', () => {
      const at = new Date()
      const version = '1.0.1'
      const failedLog = [
        { type: 'success', message: 'log.generated_product', params: [version], createdAt: at },
        { type: 'info', message: 'log.created_branch', params: ['generation/1.0.1', 'bigbang'], createdAt: at },
        { type: 'info', message: 'log.created_merge_request', params: ['bigbang', 'main'], createdAt: at },
        { type: 'info', message: 'log.waiting_checks', createdAt: at },
        { type: 'warning', message: 'log.checks_job_failed', params: ['client_build'], createdAt: at },
      ]
      const openRequest = {
        number: 7, state: 'opened', webUrl: 'http://git/mr/7', jobs: [],
        pipeline: { id: 3, status: 'failed' }, failed: { id: 2, name: 'client_build', trace: '' },
      }
      const failing = () => run({ status: 'warning', messages: failedLog, result: { changed: true, conflicts: false, checksFailed: { status: 'failed', job: 'client_build', url: '' } } })
      const click = async (name) => {
        document.body.querySelector(`[name="${name}"]`).click()
        await settle()
      }

      beforeEach(() => {
        service.getLatestMergeRequest = vi.fn().mockResolvedValue(openRequest)
        service.decideUpdate = vi.fn()
        service.retryPipeline = vi.fn().mockResolvedValue({})
      })

      it('asks nothing when it was decided before generating', async () => {
        const wrapper = mountDialog([run({ status: 'running', messages: failedLog, result: null })])
        await settle()
        await wrapper.setProps({ runs: [run({
          status: 'warning',
          messages: [...failedLog, { type: 'warning', message: 'log.update_rejected', params: ['1.0.1'], createdAt: at }],
          result: { changed: true, conflicts: false, checksFailed: null, checksDecision: 'reject' },
        })] })
        await settle()
        expect(document.body.querySelector('[name="update-decision"]')).toBeFalsy()
        expect(document.body.querySelector('[name="gr-download"]')).toBeFalsy()
        expect(text()).toContain('Actualización rechazada')
      })

      it('lets a person decide while checks that did not finish in time are still running', async () => {
        service.getLatestMergeRequest = vi.fn().mockResolvedValue({
          number: 7, state: 'opened', webUrl: 'http://git/mr/7', jobs: [], failed: null, awaitingDecision: true, pipeline: { id: 3, status: 'running' },
        })
        mountDialog([run({
          status: 'warning',
          messages: [...failedLog.slice(0, -1), { type: 'warning', message: 'log.checks_timeout', params: [30], createdAt: at }],
          result: { changed: true, conflicts: false, checksFailed: { status: 'timeout', job: null, url: '' } },
        })])
        await settle()
        expect(document.body.querySelector('[name="update-decision"]').textContent).toContain('no han terminado a tiempo')
        expect(document.body.querySelector('[name="decision-retry"]')).toBeFalsy()
        await click('decision-merge')
        expect(service.decideUpdate).not.toHaveBeenCalled()
        expect(document.body.querySelector('[name="decision-merge-cancel"]')).toBeTruthy()
      })

      it('does not offer a decision on checks that are simply running', async () => {
        service.getLatestMergeRequest = vi.fn().mockResolvedValue({
          number: 7, state: 'opened', webUrl: 'http://git/mr/7', jobs: [], failed: null, awaitingDecision: false, pipeline: { id: 3, status: 'running' },
        })
        mountDialog([failing()])
        await settle()
        expect(document.body.querySelector('[name="update-decision"]')).toBeFalsy()
      })

      it('counts as merged when merging anyway was the choice', async () => {
        mountDialog([run({
          status: 'success',
          messages: [...failedLog, { type: 'success', message: 'log.merged_merge_request', params: ['bigbang', 'main'], createdAt: at }],
          result: { changed: true, conflicts: false, checksFailed: null, checksDecision: 'merge' },
        })])
        await settle()
        expect(document.body.querySelector('[name="update-decision"]')).toBeFalsy()
        expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--done')
      })

      it('tells the steps of the deployment before its checks', async () => {
        mountDialog([failing()])
        await settle()
        const log = document.body.querySelector('[name="gr-deploy-log"]')
        const checks = document.body.querySelector('[name="mr-checks"]')
        expect(log.compareDocumentPosition(checks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      })

      it('waits for a decision at the deployment, with the options and the job that failed', async () => {
        mountDialog([failing()])
        await settle()
        expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--waiting')
        expect(document.body.querySelector('[name="update-decision"]').textContent).toContain('client_build')
        expect(text()).toContain('Los checks no han pasado')
        expect(text()).not.toContain('conflictos')
        expect(document.body.querySelector('[name="gr-spec-block"]')).toBeFalsy()
        expect(document.body.querySelector('[name="gr-download"]')).toBeFalsy()
        for (const option of ['decision-merge', 'decision-reject', 'decision-retry']) expect(document.body.querySelector(`[name="${option}"]`)).toBeTruthy()
      })

      it('asks once more before merging code that did not pass, and then merges it', async () => {
        service.decideUpdate.mockResolvedValue({ decision: 'merge', version, log: { type: 'success', message: 'log.merged_merge_request', params: ['bigbang', 'main'], version, createdAt: at }, deployment: { pending: false, version } })
        const wrapper = mountDialog([failing()])
        await settle()
        await click('decision-merge')
        expect(service.decideUpdate).not.toHaveBeenCalled()
        await click('decision-merge')
        expect(service.decideUpdate).toHaveBeenCalledWith({ id: 'p1', number: 7, decision: 'merge' })
        expect(document.body.querySelector('[name="update-decision"]')).toBeFalsy()
        expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--done')
        expect(document.body.querySelector('[name="cflow-step-release"]').getAttribute('class')).toContain('cflow__node--done')
        expect(wrapper.emitted('decided')[0][0]).toMatchObject({ decision: 'merge', productId: 'p1' })
      })

      it('lets go back from the confirmation without merging', async () => {
        mountDialog([failing()])
        await settle()
        await click('decision-merge')
        await click('decision-merge-cancel')
        expect(service.decideUpdate).not.toHaveBeenCalled()
        expect(document.body.querySelector('[name="decision-reject"]')).toBeTruthy()
      })

      it('rejects at once and leaves the deployment skipped', async () => {
        service.decideUpdate.mockResolvedValue({ decision: 'reject', version, log: { type: 'warning', message: 'log.update_rejected', params: [version], version, createdAt: at }, deployment: { pending: true, version: '1.0.0' } })
        mountDialog([failing()])
        await settle()
        await click('decision-reject')
        expect(service.decideUpdate).toHaveBeenCalledWith({ id: 'p1', number: 7, decision: 'reject' })
        expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--skipped')
        expect(document.body.querySelector('[name="cflow-step-release"]').getAttribute('class')).toContain('cflow__node--warning')
        expect(text()).toContain('Actualización rechazada')
      })

      it('keeps the options when the merge finds conflicts', async () => {
        service.decideUpdate.mockResolvedValue({ decision: 'merge', version, conflicts: true, log: { type: 'warning', message: 'log.conflicts_merge_request', params: ['bigbang', 'main'], version, createdAt: at } })
        mountDialog([failing()])
        await settle()
        await click('decision-merge')
        await click('decision-merge')
        expect(document.body.querySelector('[name="update-decision"]')).toBeTruthy()
      })

      it('runs the checks again from there', async () => {
        mountDialog([failing()])
        await settle()
        await click('decision-retry')
        expect(service.retryPipeline).toHaveBeenCalledWith({ id: 'p1' })
        expect(document.body.querySelector('[name="decision-merge"]')).toBeFalsy()
      })
    })

    it('tells a failure in the repository where it happened', async () => {
      const at = new Date()
      mountDialog([run({
        status: 'error', result: null,
        messages: [
          { type: 'success', message: 'log.generated_product', params: ['1.0.1'], createdAt: at },
          { type: 'error', message: 'error_messages.internal_error', createdAt: at },
        ],
      })])
      await settle()
      expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--failed')
      expect(document.body.querySelector('[name="gr-deploy-failed"]')).toBeTruthy()
      expect(document.body.querySelector('[name="gr-failed"]')).toBeFalsy()
      expect(isShown('gr-deploy-log')).toBe(true)
    })

    it('hides and shows the jobs of the pipeline', async () => {
      service.getPipeline.mockResolvedValue(failedPipeline)
      mountDialog([run()])
      await settle()
      expect(isShown('gr-jobs')).toBe(true)
      document.body.querySelector('[name="gr-jobs-toggle"]').click()
      await settle()
      expect(isShown('gr-jobs')).toBe(false)
    })
  })

  describe('following the pipeline', () => {
    const pipelineIn = (status) => ({
      pipeline: { id: 7, status, webUrl: '', createdAt: new Date().toISOString(), ref: 'main' }, jobs: [], failed: null,
    })

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('stops at a pipeline that waits to be started by hand, with the step over', async () => {
      service.getPipeline.mockResolvedValue(pipelineIn('manual'))
      mountDialog([run()])
      await vi.advanceTimersByTimeAsync(20000)
      expect(service.getPipeline).toHaveBeenCalledTimes(1)
      expect(document.body.querySelector('[name="gr-step-deploy"]').className).toContain('gr__step-btn--done')
    })

    it('does not ask again while the last answer has not come', async () => {
      service.getPipeline.mockReturnValue(new Promise(() => {}))
      mountDialog([run()])
      await vi.advanceTimersByTimeAsync(60000)
      expect(service.getPipeline).toHaveBeenCalledTimes(1)
    })

    it('asks less often with time and stops at a pipeline that never ends, saying so', async () => {
      service.getPipeline.mockImplementation(async () => pipelineIn('pending'))
      mountDialog([run()])
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
      const early = service.getPipeline.mock.calls.length
      expect(early).toBeGreaterThan(30)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(service.getPipeline.mock.calls.length - early).toBeLessThanOrEqual(11)

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      const finished = service.getPipeline.mock.calls.length
      expect(document.body.querySelector('[name="gr-pipeline-gave-up"]').textContent).toContain('dejado de consultar')
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(service.getPipeline.mock.calls.length).toBe(finished)
    }, 30000)
  })

  it('says a cancelled run was never touched', async () => {
    mountDialog([run({ status: 'cancelled', result: null })])
    await settle()
    expect(document.body.querySelector('[name="gr-cancelled"]')).toBeTruthy()
    expect(service.getVersion).not.toHaveBeenCalled()
  })

  it('collapses the list of a batch to the state of each one, and remembers it', async () => {
    localStorage.removeItem('linea.generation.listCollapsed')
    mountDialog([
      run({ id: 'a', productId: 'pa', name: 'Alfa' }),
      run({ id: 'b', productId: 'pb', name: 'Beta', status: 'error', result: null }),
    ])
    await settle()
    const list = () => document.body.querySelector('.gr-list')
    expect(list().className).not.toContain('gr-list--rail')
    expect(list().textContent).toContain('Alfa')

    document.body.querySelector('[name="gr-list-toggle"]').click()
    await settle()
    expect(list().className).toContain('gr-list--rail')
    expect(list().textContent).not.toContain('Alfa')
    // each one is still there, by its state, and can be told apart
    expect(document.body.querySelector('[name="gr-row-pb"]').getAttribute('aria-label')).toContain('Beta')
    expect(localStorage.getItem('linea.generation.listCollapsed')).toBe('1')
    localStorage.removeItem('linea.generation.listCollapsed')
  })
})

describe('GenerationResultDialog: a product that is not made of modules', () => {
  const metamodelsOnly = [
    { message: 'log.resolving_metamodel', params: ['gitlab:linea/metamodels/basic', '1.0.0', []], type: 'info' },
    { message: 'log.composing_platform', type: 'info' },
  ]

  it('says nothing of modules', async () => {
    mountDialog([run({ status: 'running', result: null, messages: metamodelsOnly })])
    await settle()
    expect(text()).not.toMatch(/m[oó]dulo/i)
    expect(document.body.querySelector('[name="gflow-node-basic"]')).toBeTruthy()
  })

  it('still tells the modules of one that is', async () => {
    mountDialog([run({ status: 'running', result: null, messages: [{ message: 'log.resolving_module', params: ['gitlab:linea/modules/main-component', '1.0.0', []], type: 'info' }] })])
    await settle()
    expect(text()).toMatch(/m[oó]dulos/i)
  })
})
