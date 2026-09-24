// Contrato do schema os_* da migration 202609230001. Regenerar após mudanças no banco.
import type { Catalog, Membership, Order, Unit } from "./domain";
type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};
type Profile = { id: string; name: string };
type Message = {
  id: string;
  order_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
type Attachment = {
  id: string;
  order_id: string;
  uploaded_by: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};
type OrderEvent = {
  id: number;
  order_id: string;
  actor: string | null;
  from_status: string | null;
  to_status: string;
  reason: string;
  created_at: string;
};
type Audit = {
  id: number;
  actor: string | null;
  entity: string;
  record_id: string;
  action: string;
  created_at: string;
  before_data: Json | null;
  after_data: Json | null;
};
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type Database = {
  public: {
    Tables: {
      os_units: Table<Unit & { legacy_id: string | null }, "name">;
      os_profiles: Table<Profile, "id" | "name">;
      os_memberships: Table<Membership, "user_id" | "role">;
      os_catalogs: Table<Catalog, "legacy_id" | "kind" | "name">;
      os_orders: Table<Order & { updated_at: string }, "title">;
      os_messages: Table<Message, "order_id" | "body">;
      os_attachments: Table<
        Attachment,
        "id" | "order_id" | "name" | "path" | "mime_type" | "size_bytes"
      >;
      os_order_events: Table<OrderEvent>;
      os_audit: Table<Audit>;
      os_import_records: Table<
        { source: string; source_id: string; payload: Json },
        "source" | "source_id" | "payload"
      >;
    };
    Views: Record<string, never>;
    Functions: {
      os_change_status: {
        Args: { target: string; next_status: string; reason: string };
        Returns: undefined;
      };
      os_assign_order: {
        Args: {
          target: string;
          target_unit: string;
          target_responsible: string | null;
          target_opened_by: string | null;
          target_category: string;
        };
        Returns: undefined;
      };
      os_edit_order: {
        Args: {
          target: string;
          new_title: string;
          new_priority: string;
          detail_patch: Json;
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
