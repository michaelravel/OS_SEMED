// Contrato do schema os_* até a migration 202609240005. Regenerar após mudanças no banco.
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
  storage_status: string;
  inspection_status: string;
  content_sha256: string | null;
  storage_verified_at: string | null;
  inspected_at: string | null;
  quarantined_at: string | null;
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
      os_complete_order: {
        Args: { target: string; solution: string };
        Returns: undefined;
      };
      os_cancel_order: {
        Args: { target: string; justification: string };
        Returns: undefined;
      };
      os_reopen_order: {
        Args: { target: string; justification: string };
        Returns: undefined;
      };
      os_order_available_actions: {
        Args: { target: string };
        Returns: { next_status: string; operation: string }[];
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
      os_save_unit: {
        Args: {
          target: string | null;
          unit_name: string;
          unit_type: string;
          unit_address: string;
          unit_coordinates: string;
          unit_active: boolean;
        };
        Returns: string;
      };
      os_save_catalog: {
        Args: {
          target: string | null;
          catalog_kind: string;
          catalog_name: string;
          catalog_data: Json;
          catalog_active: boolean;
        };
        Returns: string;
      };
      os_save_membership: {
        Args: {
          target: string | null;
          target_user: string;
          target_unit: string | null;
          target_role: string;
          target_active: boolean;
          target_name: string;
        };
        Returns: string;
      };
      os_grant_admin: {
        Args: {
          target_user: string;
          target_name: string;
          replaced_membership: string | null;
        };
        Returns: string;
      };
      os_revoke_admin: {
        Args: { target: string };
        Returns: undefined;
      };
      os_reclassify_admin: {
        Args: {
          target: string;
          target_unit: string | null;
          target_role: string;
          target_active: boolean;
          target_name: string;
        };
        Returns: undefined;
      };
      os_attachment_policy: {
        Args: Record<PropertyKey, never>;
        Returns: {
          max_file_bytes: number;
          max_attachments_per_order: number;
          max_bytes_per_order: number;
          max_bytes_per_user_per_order: number;
          allowed_mimes: string[];
          allowed_extensions: string[];
        }[];
      };
      os_begin_attachment_upload: {
        Args: {
          target_order: string;
          attachment_id: string;
          original_name: string;
          declared_mime: string;
          declared_size: number;
          sha256: string;
        };
        Returns: string;
      };
      os_complete_attachment_upload: {
        Args: { target: string };
        Returns: string;
      };
      os_abort_attachment_upload: {
        Args: { target: string };
        Returns: string;
      };
      os_attachment_reconciliation: {
        Args: Record<PropertyKey, never>;
        Returns: {
          issue: string;
          path: string;
          attachment_id: string | null;
          order_id: string | null;
          metadata_size: number | null;
          storage_size: number | null;
          storage_status: string | null;
          created_at: string | null;
        }[];
      };
      os_reconcile_attachment: {
        Args: { target: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
