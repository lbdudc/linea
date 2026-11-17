import MongooseRepository from "./MongooseRepository.js";
import Line from "../entities/line.js"
import { Container } from "typedi"
import { onHost } from "../git/hosts.js"

export default class LineRepository extends MongooseRepository {
    constructor() {
        super(Line);
    }

    async findByName(name, options) {
        return await this.model.findOne({ name }, null, options);
    }

    // project ids are only unique on a host: with `host`, only the lines of that one
    async findByRepoIdsOrderByCreatedAtDesc(projectIds, options, host) {
        return await Promise.all((await this.model
            .find({ repoId: { $in: projectIds }, ...(host ? { $and: [onHost(host)] } : {}) }, null, options)
            .sort({ createdAt: 'desc' })
        ));
    }

    // project ids are only unique on a host: with `host`, only the line of that one
    async findByRepoId(projectId, options, host) {
        return await this.model.findOne({ repoId: projectId, ...(host ? { $and: [onHost(host)] } : {}) }, null, options);
    }

    async findByNamespaceId(namespaceId, options, host) {
        return await this.model.findOne({ namespaceId, ...(host ? { $and: [onHost(host)] } : {}) }, null, options);
    }
}

Container.set(LineRepository, new LineRepository());