export class RepositoryConflictError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'RepositoryConflictError';
    this.code = code;
    this.status = 409;
  }
}

export function isDuplicateUserError(err) {
  return err?.code === 'USER_EMAIL_EXISTS';
}

export function mapSqliteUniqueConstraint(err, code, message) {
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return new RepositoryConflictError(code, message, { cause: err });
  }
  return err;
}

export function mapPostgresUniqueConstraint(err, code, message) {
  if (err?.code === '23505') {
    return new RepositoryConflictError(code, message, { cause: err });
  }
  return err;
}
