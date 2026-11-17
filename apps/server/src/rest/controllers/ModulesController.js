import { Container } from 'typedi'
import { asyncHandler } from '../common/asyncHandler.js'
import ModularService from '../../model/services/modules/ModularService.js'
import PackageService from '../../model/services/modules/PackageService.js'
import RegistryService from '../../model/services/modules/RegistryService.js'
import LineService from '../../model/services/LineService.js'
import { singleFlight } from '../../model/services/singleFlight.js'
import { usageOf } from '../../model/services/modules/packageUsage.js'

const usageFlight = singleFlight()

/** The handlers of the registry of packages and of the modules of a line. */
export const createControllers = ({ packageService = new PackageService(), registryService = new RegistryService(), modularService = Container.get(ModularService), lineService = () => Container.get(LineService) } = {}) => {

  const package_ = {
    list: asyncHandler(async (req, res) => {
      res.status(200).send(await packageService.list({ userId: req.userId, kind: req.params.kind }))
    }),
    create: asyncHandler(async (req, res) => {
      res.status(201).send(await packageService.create({ ...req.body, userId: req.userId, kind: req.params.kind }))
    }),
    get: asyncHandler(async (req, res) => {
      res.status(200).send(await packageService.get({ userId: req.userId, kind: req.params.kind, id: req.params.id }))
    }),
    readFile: asyncHandler(async (req, res) => {
      const { path, ref } = req.query
      res.status(200).send(await packageService.readFile({ userId: req.userId, kind: req.params.kind, id: req.params.id, path, ref }))
    }),
    saveFile: asyncHandler(async (req, res) => {
      const { path, content, message } = req.body
      res.status(200).send(await packageService.saveFile({ userId: req.userId, kind: req.params.kind, id: req.params.id, path, content, message }))
    }),
    deleteFile: asyncHandler(async (req, res) => {
      const { path } = req.query
      res.status(200).send(await packageService.saveFile({ userId: req.userId, kind: req.params.kind, id: req.params.id, path, content: null }))
    }),
    saveFiles: asyncHandler(async (req, res) => {
      const { files, message } = req.body
      res.status(200).send(await packageService.saveFiles({ userId: req.userId, kind: req.params.kind, id: req.params.id, files, message }))
    }),
    trial: asyncHandler(async (req, res) => {
      res.status(200).send(await packageService.trial({ userId: req.userId, kind: req.params.kind, id: req.params.id, ref: req.body.ref, changes: req.body.changes ?? [], others: req.body.others ?? [], alongside: req.body.alongside ?? [] }))
    }),
    deriveTrial: asyncHandler(async (req, res) => {
      const { ref, changes, others, alongside, models, features, spec, include, contents, zip } = req.body
      res.status(200).send(await packageService.deriveTrial({ userId: req.userId, kind: req.params.kind, id: req.params.id, ref, changes: changes ?? [], others: others ?? [], alongside: alongside ?? [], models, features, spec, include, contents, zip }))
    }),
    checkTrial: asyncHandler(async (req, res) => {
      const { ref, changes, others, alongside, models, features } = req.body
      res.status(200).send(await packageService.checkTrial({ userId: req.userId, kind: req.params.kind, id: req.params.id, ref, changes: changes ?? [], others: others ?? [], alongside: alongside ?? [], models, features }))
    }),
    studio: asyncHandler(async (req, res) => {
      res.status(200).send(await packageService.studio({ userId: req.userId, kind: req.params.kind, id: req.params.id }))
    }),
    check: asyncHandler(async (req, res) => {
      res.status(200).send(await packageService.check({ userId: req.userId, kind: req.params.kind, id: req.params.id }))
    }),
    // the lines (and their products) that use a package, at which version: the lines the person can read
    // (it reads every line of the person: asks made while one is running share its result)
    usage: asyncHandler(async (req, res) => {
      const pkg = await packageService.get({ userId: req.userId, kind: req.params.kind, id: req.params.id })
      res.status(200).send(await usageFlight(`${req.userId}|${pkg.location}`, async () => {
        const lines = await lineService().findEnrolledLines({ userId: req.userId })
        return usageOf({ location: pkg.location, lines, pinsOf: (line) => modularService.linePins({ line, userId: req.userId }) })
      }))
    }),
    publish: asyncHandler(async (req, res) => {
      res.status(200).send(await packageService.publish({ userId: req.userId, kind: req.params.kind, id: req.params.id, bump: req.body?.bump }))
    }),
  }

  const registry = {
    status: asyncHandler(async (req, res) => {
      res.status(200).send(await registryService.status({ userId: req.userId }))
    }),
    entries: asyncHandler(async (req, res) => {
      res.status(200).send(await registryService.entries({ userId: req.userId, kind: req.query.kind }))
    }),
    suggestions: asyncHandler(async (req, res) => {
      res.status(200).send(await registryService.suggestions({ userId: req.userId, kind: req.query.kind }))
    }),
    register: asyncHandler(async (req, res) => {
      res.status(201).send(await registryService.register({ userId: req.userId, location: req.body.location }))
    }),
    unregister: asyncHandler(async (req, res) => {
      await registryService.unregister({ userId: req.userId, location: req.query.location })
      res.status(204).send()
    }),
  }

  const lineModules = {
    get: asyncHandler(async (req, res) => {
      res.status(200).send(await modularService.getLineModules({ id: req.params.id, userId: req.userId }))
    }),
    save: asyncHandler(async (req, res) => {
      res.status(200).send(await modularService.saveLineModules({ id: req.params.id, userId: req.userId, modules: req.body.modules, metamodels: req.body.metamodels, bump: req.body.bump || undefined }))
    }),
    check: asyncHandler(async (req, res) => {
      res.status(200).send(await modularService.checkLineModules({ id: req.params.id, userId: req.userId, modules: req.body?.modules, metamodels: req.body?.metamodels }))
    }),
    // What a line that does not exist yet would be made of: checked as the form changes (the modules of a modular SPL, the metamodels of a project)
    preview: asyncHandler(async (req, res) => {
      // the form asks again at every change of the modules and abandons the older request: the resolve of an abandoned one stops at its
      // next GitLab call instead of going on to the end (it would keep an already slow GitLab busy for nobody)
      const gone = new AbortController()
      res.on('close', () => { if (!res.writableEnded) gone.abort() })
      try {
        const { packages, ok, diagnostics, metamodels, featureModel } = await modularService.previewLine({
          userId: req.userId, name: req.body.name || 'new-spl', kind: req.body.kind || 'modular',
          metamodels: req.body.metamodels ?? {}, modules: req.body.modules ?? {}, signal: gone.signal,
        })
        res.status(200).send({ ok, diagnostics, metamodels, packages, featureModel })
      } catch (error) {
        // nobody is waiting for it: not an error worth an answer or a log line
        if (!gone.signal.aborted) throw error
      }
    }),
  }

  return { package: package_, registry, lineModules }
}
