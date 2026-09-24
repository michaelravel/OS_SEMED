import { queryLimits } from "./application-config";

export function pageNumber(value?: string) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0
    ? Math.min(page, queryLimits.maximumPage)
    : 1;
}

export function pageRange(page: number) {
  const from = (page - 1) * queryLimits.pageSize;
  return { from, to: from + queryLimits.pageSize - 1 };
}
