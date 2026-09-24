import type { Database } from "@/lib/database.types";
import type { Catalog, Order } from "@/lib/domain";

export type NamedOption = { id: string; name: string };
export type OrderDetail = Pick<
  Order,
  | "id"
  | "protocol"
  | "version"
  | "title"
  | "status"
  | "priority"
  | "resolution"
  | "unit_id"
  | "destination_unit_id"
  | "opened_by"
  | "responsible_id"
  | "category_id"
  | "driver_id"
  | "vehicle_id"
  | "route_id"
  | "details"
  | "opened_at"
>;
export type OrderCatalog = Pick<Catalog, "id" | "kind" | "name">;
export type OrderMessage = Pick<
  Database["public"]["Tables"]["os_messages"]["Row"],
  "id" | "body" | "created_at" | "author_id"
>;
export type OrderAttachment = Pick<
  Database["public"]["Tables"]["os_attachments"]["Row"],
  "id" | "name" | "size_bytes"
>;
export type OrderEvent = Pick<
  Database["public"]["Tables"]["os_order_events"]["Row"],
  "id" | "from_status" | "to_status" | "reason" | "created_at"
>;
export type WorkflowAction =
  Database["public"]["Functions"]["os_order_available_actions"]["Returns"][number];
export type AttachmentPolicy =
  Database["public"]["Functions"]["os_attachment_policy"]["Returns"][number];
