import MongooseRepository from "./MongooseRepository.js";
import Product from "../entities/product.js"
import { Container } from "typedi"
import { onHost } from "../git/hosts.js"

export default class ProductRepository extends MongooseRepository {
    constructor() {
        super(Product);
    }

    async findByName(name, lineId, options) {
        if (lineId == null) {
          throw new TypeError('ProductRepository.findByName requires lineId (ADR-032: uniqueness is per-line, not global).');
        }
        return await this.model.findOne({ 'spec.basicData.name': name, lineId }, null, options);
    }

    async findByLineId(lineId, options) {
        return await this.model.find({ lineId }, null, options);
    }

    // project ids are only unique on a host: with `host`, only the products of that one
    async findByRepoId(projectId, options, host) {
        return await this.model.findOne({ 'repo.id': projectId, ...(host ? { $and: [onHost(host)] } : {}) }, null, options);
    }
    
    async countByLineId(lineId) {
        return await this.model.countDocuments({ lineId });
    }

    async deleteByLineId(lineId, options) {
        return await this.model.deleteMany({ lineId }, options);
    }

    async findByRepoIdsOrderByCreatedAtDesc(projectIds, options, host) {
        return await Promise.all((await this.model
            .find({ 'repo.id': { $in: projectIds }, ...(host ? { $and: [onHost(host)] } : {}) }, null, options)
            .sort({ createdAt: 'desc' })
        ));
    }
}

Container.set(ProductRepository, new ProductRepository());