import UserRepository from "../repositories/UserRepository.js";
import { PermissionError, UserNotFoundError } from "../errors/errors.js";
import { getGitProvider } from "../git/index.js";
import { tokenFor, usernameOn } from "../git/hosts.js";
import { Container } from "typedi";

export default class PermissionChecker {
  userRepository = Container.get(UserRepository);

  // `host`: the git host of the project, when no provider is given (unset: the primary one)
  checkUserExistsAndHasPrivileges = async ({ userId, repoId, accessLevel, host }, git) => {
    const provider = git || getGitProvider({ host });
      try {
        const user = await this.userRepository.findById(userId);
        if (!user) {
          throw new UserNotFoundError();
        }
  
        const token = tokenFor(user, provider.kind);
        const level = await provider.getAccessLevel({ token, id: repoId, username: usernameOn(user, provider.kind) });

        if (level >= accessLevel || user.admin) {
          return user;
        } else {
          throw new PermissionError();
        }
      } catch (error) {
          // An expired/revoked git-host token must stay an auth error so the
          // caller can refresh and retry (and the client gets a 401 GIT_HOST_AUTH
          // instead of a misleading 403).
          if (provider.isAuthError(error) || error instanceof UserNotFoundError) throw error;
          console.error("[checkUserExistsAndHasPrivileges] error:", error.constructor.name, error.message);
          throw new PermissionError();
      }
  }

  /** Whether the person has that level: what a page asks to know if it may offer a change, not to allow one. */
  hasPrivileges = async (args, git) => {
    try {
      await this.checkUserExistsAndHasPrivileges(args, git);
      return true;
    } catch (error) {
      if (error instanceof PermissionError) return false;
      throw error;
    }
  }

}

Container.set(PermissionChecker, new PermissionChecker());