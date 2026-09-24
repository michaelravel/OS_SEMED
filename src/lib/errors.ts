type QueryResult = { error: unknown };

export class ServerOperationError extends Error {
  readonly code: string;

  constructor(code: string, publicMessage: string) {
    super(publicMessage);
    this.name = "ServerOperationError";
    this.code = code;
  }
}

export function ensureQuerySucceeded(
  result: QueryResult,
  publicMessage: string,
): void {
  if (result.error)
    throw new ServerOperationError("DATABASE_QUERY_FAILED", publicMessage);
}

export function ensureQueriesSucceeded(
  results: readonly QueryResult[],
  publicMessage: string,
): void {
  if (results.some((result) => result.error))
    throw new ServerOperationError("DATABASE_QUERY_FAILED", publicMessage);
}
