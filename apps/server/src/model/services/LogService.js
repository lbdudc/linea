import { Container } from "typedi";
import Log from "../entities/log.js";
import DataSource from "../connectors/DataSource.js";
import PermissionChecker from "./PermissionChecker.js";
import ProductRepository from "../repositories/ProductRepository.js";
import LineRepository from "../repositories/LineRepository.js";
import LogRepository from "../repositories/LogRepository.js";
import { compareVersions } from "./versionTags.js";
import { hostOf } from "../git/hosts.js";
import { ACCESS } from '@lbdudc/linea-git';
import { ProductNotFoundError } from '../errors/errors.js';

export default class LogService {
  dataSource = Container.get(DataSource);
  permissionChecker = Container.get(PermissionChecker);
  logRepository = Container.get(LogRepository);
  productRepository = Container.get(ProductRepository);
  lineRepository = Container.get(LineRepository);

  createLog = async ({ userId, productId, version, type, message, params, link, durationMs }) => {
    const session = await this.dataSource.startTransaction();
    try {
      const product = await this.productRepository.findById(productId);
      if (!product) throw new Error(`createLog: no product ${productId} to log against`);

      await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: product.repo.id, accessLevel: ACCESS.MAINTAINER, host: hostOf(product)});

      const line = await this.lineRepository.findById(product.lineId);

      const log = new Log({
        userId, productId, version, type, message, params, link, durationMs,
        productName: product.spec.basicData.name,
        lineId: product.lineId,
        lineName: line?.name,
      });
  
      await this.logRepository.save(log, { session });

      this.dataSource.commitTransaction(session);

      return log;
    } catch (error) {
      this.dataSource.abortTransaction(session);
      throw error;
    }
  }
  
  find = async ({ userId, id, version }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER, host: hostOf(product) });
    return this.logRepository.findByProductIdAndVersionOrderByCreatedAtAsc(id, version);
  }
  
  getDeploymentMetrics = async () => {
    return this.logRepository.computeDeploymentMetrics();
  }

  // Deployment history list. Kept global (no per-user scoping) to stay consistent with
  // getDeploymentMetrics, which already backs the page's KPI header.
  findDeployments = async ({ outcome, productId, lineId, from, to, search, page, rowsPerPage } = {}) => {
    return this.logRepository.findDeployments({ outcome, productId, lineId, from, to, search, page, rowsPerPage });
  }

  findLastSyncByProductIds = async ({ productIds }) => {
    return this.logRepository.findLastSyncByProductIds(productIds);
  }

  findVersions = async ({ userId, id }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER, host: hostOf(product) });
    const versions = await this.logRepository.findVersionsByProductId(product._id);
    return versions.sort((a, b) => compareVersions(b, a));
  }
}

Container.set(LogService, new LogService());
