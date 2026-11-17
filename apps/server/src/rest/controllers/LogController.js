import { Container } from "typedi";
import LogService from "../../model/services/LogService.js";
import { asyncHandler } from '../common/asyncHandler.js';

export default class LogController {
  logService = Container.get(LogService);

  getMetrics = asyncHandler(async (req, res) => {
    const metrics = await this.logService.getDeploymentMetrics();
    res.status(200).send(metrics);
  });

  listDeployments = asyncHandler(async (req, res) => {
    const deployments = await this.logService.findDeployments({ ...req.query });
    res.status(200).send(deployments);
  });

  find = asyncHandler(async (req, res) => {
    const log = await this.logService.find({userId: req.userId, ...req.params});
    res.status(200).send(log);
  });

  findVersions = asyncHandler(async (req, res) => {
    const versions = await this.logService.findVersions({userId: req.userId, ...req.params});
    res.status(200).send(versions);
  });
}

Container.set(LogController, new LogController());
