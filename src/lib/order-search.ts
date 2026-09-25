import { z } from "zod";
import { fieldLimits } from "./application-config";
import {
  isOrderStatus,
  priorities,
  type OrderPriority,
} from "./domain";
import {
  decodeOrderCursor,
  parseOrderProtocol,
  type OrderFilterValues,
} from "./order-search-core";

export {
  encodeOrderCursor,
  orderFilterUrlParams,
  parseOrderProtocol,
} from "./order-search-core";
export type { OrderFilterValues } from "./order-search-core";

export type OrderSearchParams = {
  q?: string;
  protocol?: string;
  status?: string;
  priority?: string;
  category?: string;
  origin?: string;
  destination?: string;
  requester?: string;
  responsible?: string;
  opened_from?: string;
  opened_to?: string;
  completed_from?: string;
  completed_to?: string;
  reopened?: string;
  waiting?: string;
  cursor?: string;
  direction?: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/g;

function text(value: string | undefined, limit: number = fieldLimits.search) {
  return (value ?? "").replace(controlCharacters, "").trim().slice(0, limit);
}

function uuid(value: string | undefined) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : "";
}

function dateValue(value: string | undefined) {
  if (!value || !datePattern.test(value)) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

function dateBoundary(value: string, nextDay = false) {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (nextDay) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return `${parsed.toISOString().slice(0, 10)}T00:00:00-03:00`;
}

export function parseOrderSearchParams(params: OrderSearchParams) {
  const q = text(params.q).replace(/[%_\\]/g, "");
  const protocolInput = text(params.protocol, 50);
  const explicitProtocol = protocolInput ? parseOrderProtocol(protocolInput) : null;
  const qProtocol = !protocolInput && q ? parseOrderProtocol(q) : null;
  const protocol = explicitProtocol ?? qProtocol;
  const invalidProtocol = Boolean(protocolInput && !explicitProtocol);
  const status = params.status && isOrderStatus(params.status) ? params.status : "";
  const priority = priorities.includes(params.priority as OrderPriority)
    ? (params.priority as OrderPriority)
    : "";
  const values: OrderFilterValues = {
    q,
    protocol: protocolInput,
    status,
    priority,
    category: uuid(params.category),
    origin: uuid(params.origin),
    destination: uuid(params.destination),
    requester: uuid(params.requester),
    responsible: uuid(params.responsible),
    openedFrom: dateValue(params.opened_from),
    openedTo: dateValue(params.opened_to),
    completedFrom: dateValue(params.completed_from),
    completedTo: dateValue(params.completed_to),
    reopened: params.reopened === "1",
    waiting: params.waiting === "1",
  };
  const cursor = decodeOrderCursor(params.cursor);
  const direction: "next" | "previous" =
    params.direction === "previous" ? "previous" : "next";

  return {
    values,
    cursor,
    direction,
    args: {
      search_text: qProtocol ? null : q || null,
      target_protocol: invalidProtocol ? -1 : protocol?.protocol ?? null,
      target_protocol_code: protocol?.code ?? null,
      target_protocol_year: protocol?.year ?? null,
      target_status: status || null,
      target_priority: priority || null,
      target_category: values.category || null,
      target_origin_unit: values.origin || null,
      target_destination_unit: values.destination || null,
      target_requester: values.requester || null,
      target_responsible: values.responsible || null,
      opened_from: dateBoundary(values.openedFrom),
      opened_until: dateBoundary(values.openedTo, true),
      completed_from: dateBoundary(values.completedFrom),
      completed_until: dateBoundary(values.completedTo, true),
      only_reopened: values.reopened,
      only_waiting: values.waiting,
      cursor_created_at: cursor?.createdAt ?? null,
      cursor_id: cursor?.id ?? null,
      cursor_direction: direction,
    },
  };
}
