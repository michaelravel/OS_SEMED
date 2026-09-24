import type { Database } from "@/lib/database.types";

export type NamedOption = { id: string; name: string };
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
