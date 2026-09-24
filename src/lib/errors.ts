type QueryResult = { error: unknown };

export function ensureQuerySucceeded(
  result: QueryResult,
  publicMessage: string,
): void {
  if (result.error) throw new Error(publicMessage);
}

export function ensureQueriesSucceeded(
  results: readonly QueryResult[],
  publicMessage: string,
): void {
  if (results.some((result) => result.error)) throw new Error(publicMessage);
}
