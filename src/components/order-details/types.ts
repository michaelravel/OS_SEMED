import type { Database } from "@/lib/database.types";
import type { Catalog, Order } from "@/lib/domain";

export type NamedOption = { id: string; name: string };
export type ResponsibleMembershipOption = NamedOption & {
  unit_id: string | null;
  user_id: string;
};
export type OrderDetail = Pick<
  Order,
  | "id"
  | "protocol"
  | "protocol_year"
  | "protocol_code"
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
  | "resume_status"
  | "waiting_reason"
  | "waiting_details"
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
export type OrderTimelineEvent =
  Database["public"]["Functions"]["os_order_timeline"]["Returns"][number];
export type OrderServiceEntryView = Pick<
  Database["public"]["Tables"]["os_order_service_entries"]["Row"],
  "id" | "entry_type" | "description" | "serviced_at" | "created_at"
>;
export type AvailableWorkflowAction =
  Database["public"]["Functions"]["os_order_available_actions"]["Returns"][number];
export type AttachmentPolicy =
  Database["public"]["Functions"]["os_attachment_policy"]["Returns"][number];
export type OrderHeaderData =
  Database["public"]["Functions"]["os_order_header"]["Returns"][number];
