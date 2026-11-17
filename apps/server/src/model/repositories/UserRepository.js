import MongooseRepository from "./MongooseRepository.js";
import User from "../entities/user.js"
import { Container } from "typedi"

export default class UserRepository extends MongooseRepository {
    constructor() {
        super(User);
    }

    async findByUsername(username, options) {
        return await this.model.findOne({ username }, null, options);
    }

    /**
     * The user whose account on `host` is `hostUsername`: the one whose own host it is (`primary` stands for users that never said which
     * host theirs is), or who signed in to it as another identity.
     */
    async findByHostAccount({ host, hostUsername, primary }, options) {
        const own = [{ username: hostUsername, gitHost: host, hostUsername: { $exists: false } }, { hostUsername, gitHost: host }];
        if (host === primary) own.push({ username: hostUsername, gitHost: { $exists: false } }, { username: hostUsername, gitHost: null });
        return await this.model.findOne({ $or: [...own, { identities: { $elemMatch: { host, username: hostUsername } } }] }, null, options);
    }
}

Container.set(UserRepository, new UserRepository());