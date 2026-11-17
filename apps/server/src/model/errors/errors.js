import { PackageNotFoundError, PackageNotAllowedError, PackageVersionExistsError } from '@lbdudc/linea-git';
class IncorrectCredentialsError extends Error {
  }

  class UserNotFoundError extends Error {
  }

  class LineNotFoundError extends Error {
  }

  class ProductNotFoundError extends Error {
  }

  // git could not open a repository (wrong credentials for it, host down...): what git said is the detail
  class RepositoryAccessError extends Error {
  }

  class AlreadyExistentUserError extends Error {
  }

  class AlreadyExistentLineError extends Error {
  }

  class AlreadyExistentProductError extends Error {
  }

  class PermissionError extends Error {
  }

  class LinePlatformNotFoundError extends Error {
  }

  class LineNotModularError extends Error {
    constructor(message = 'This line has no spl.json: it was made before lines had one, and is not supported any more.') {
      super(message);
    }
  }

  class LineModularReadOnlyError extends Error {
  }

  class RestoreBlockedError extends Error {
    constructor(message = 'What contains it waits to be deleted too: that has to come back first.') {
      super(message);
    }
  }

  class LineDeletedError extends Error {
    constructor(message = 'The line of this product was deleted.') {
      super(message);
    }
  }

  const isLineDeleted = (line) => !line || Boolean(line.deletedAt);

  const assertLineAlive = (line) => {
    if (isLineDeleted(line)) throw new LineDeletedError();
  };

  class RegistryNotConfiguredError extends Error {
    constructor(message = 'No registry is configured (LINEA_REGISTRY).') {
      super(message);
    }
  }

  class NoDeployedSnapshotError extends Error {
    constructor(message = 'The last generation did not keep the specification it derived from.') {
      super(message);
    }
  }

class NoPipelineError extends Error {
  constructor(message = 'The repository has no pipeline to run again.') {
    super(message);
  }
}

class NoPendingUpdateError extends Error {
  constructor(message = 'That merge request is not an update waiting for a decision.') {
    super(message);
  }
}

class MembersOnHostError extends Error {
  constructor(host) {
    super(`The members of this line are managed on ${host}, not here.`);
    this.code = 'MEMBERS_ON_HOST';
  }
}

class TooManyAttemptsError extends Error {
  constructor(message) {
    super(message);
    this.code = 'TOO_MANY_ATTEMPTS';
  }
}

export { RestoreBlockedError, LineDeletedError, isLineDeleted, assertLineAlive, MembersOnHostError, TooManyAttemptsError, NoPipelineError, NoPendingUpdateError, NoDeployedSnapshotError, RegistryNotConfiguredError, LineNotModularError, LineModularReadOnlyError, IncorrectCredentialsError, UserNotFoundError, LineNotFoundError, ProductNotFoundError, RepositoryAccessError, AlreadyExistentUserError, AlreadyExistentLineError, AlreadyExistentProductError, PermissionError, LinePlatformNotFoundError };

// the errors of the registry are the library's: the server and the CLI raise (and map) the same ones
export { PackageNotFoundError, PackageNotAllowedError, PackageVersionExistsError };
