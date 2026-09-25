import { z } from "zod";

export type OrderFilterValues = {
  q: string;
  protocol: string;
  status: string;
  priority: string;
  category: string;
  origin: string;
  destination: string;
  requester: string;
  responsible: string;
  openedFrom: string;
  openedTo: string;
  completedFrom: string;
  completedTo: string;
  reopened: boolean;
  waiting: boolean;
};

type OrderCursor = { createdAt: string; id: string };

export function parseOrderProtocol(value: string) {
  const normalized = value.trim();
  const formal = normalized.match(/^OS\s*-?\s*0*([a-z0-9.-]+)\s*\/\s*(\d{4})$/i);
  if (formal) {
    const code = /^\d+$/.test(formal[1])
      ? String(Number(formal[1]))
      : formal[1].toUpperCase();
    return { protocol: null, code, year: Number(formal[2]) };
  }
  const legacy = normalized.match(/^(?:OS\s*-?\s*)?0*(\d+)$/i);
  if (!legacy) return null;
  const protocol = Number(legacy[1]);
  return Number.isSafeInteger(protocol) && protocol > 0
    ? { protocol, code: null, year: null }
    : null;
}

export function encodeOrderCursor(cursor: OrderCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeOrderCursor(value: string | undefined): OrderCursor | null {
  if (!value || value.length > 300) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).valueOf()) ||
      !z.uuid().safeParse(parsed?.id).success
    ) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function orderFilterUrlParams(values: OrderFilterValues) {
  const params = new URLSearchParams();
  const fields: Array<[string, string]> = [
    ["q", values.q],
    ["protocol", values.protocol],
    ["status", values.status],
    ["priority", values.priority],
    ["category", values.category],
    ["origin", values.origin],
    ["destination", values.destination],
    ["requester", values.requester],
    ["responsible", values.responsible],
    ["opened_from", values.openedFrom],
    ["opened_to", values.openedTo],
    ["completed_from", values.completedFrom],
    ["completed_to", values.completedTo],
  ];
  for (const [key, value] of fields) if (value) params.set(key, value);
  if (values.reopened) params.set("reopened", "1");
  if (values.waiting) params.set("waiting", "1");
  return params;
}
