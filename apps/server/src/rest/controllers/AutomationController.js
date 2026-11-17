import { Container } from 'typedi';
import AutomationService from '../../model/services/AutomationService.js';
import ProductService from '../../model/services/ProductService.js';
import LineCiService from '../../model/services/LineCiService.js';
import { asyncHandler } from '../common/asyncHandler.js';

export default class AutomationController {
  automationService = Container.get(AutomationService);
  productService = Container.get(ProductService);
  lineCiService = Container.get(LineCiService);

  syncProduct = async (req, res, next) => {
    try {
      const io = req.app.get('io');
      const run = await this.productService.syncProduct(
        { id: req.params.id, userId: req.userId, behavior: req.body?.behavior },
        async (event) => { io?.to(req.userId).emit('sync', event); },
      );
      res.status(200).send(run);
    } catch (error) {
      next(error);
    }
  };

  listProductSyncs = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.listSyncs({ id: req.params.id, userId: req.userId, limit: req.query.limit }));
  });

  getProductAutomation = asyncHandler(async (req, res) => {
    res.status(200).send(await this.automationService.getProductAutomation({ id: req.params.id, userId: req.userId }));
  });

  saveProductAutomation = asyncHandler(async (req, res) => {
    res.status(200).send(await this.automationService.saveProductAutomation({ id: req.params.id, userId: req.userId, sync: req.body.sync, generation: req.body.generation }));
  });

  getLineSync = asyncHandler(async (req, res) => {
    res.status(200).send(await this.automationService.getLineSync({ id: req.params.id, userId: req.userId }));
  });

  saveLineSync = asyncHandler(async (req, res) => {
    res.status(200).send(await this.automationService.saveLineSync({ id: req.params.id, userId: req.userId, sync: req.body.sync }));
  });

  listLineSyncs = asyncHandler(async (req, res) => {
    res.status(200).send(await this.automationService.listLineSyncs({ id: req.params.id, userId: req.userId, limit: req.query.limit }));
  });

  getLineCi = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineCiService.getCi({ id: req.params.id, userId: req.userId }));
  });

  saveLineCi = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineCiService.saveCi({ id: req.params.id, userId: req.userId, config: req.body }));
  });

  listLineMergeRequests = asyncHandler(async (req, res) => {
    res.status(200).send(await this.automationService.listLineMergeRequests({ id: req.params.id, userId: req.userId }));
  });
}

Container.set(AutomationController, new AutomationController());
