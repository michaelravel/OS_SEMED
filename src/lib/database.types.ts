// Contrato do schema os_* até a migration 202609250004. Regenerar após mudanças no banco.
import type {
  Catalog,
  Membership,
  Order,
  OrderOperation,
  WorkflowAction,
  Unit,
} from "./domain";
type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};
export type Profile = { id: string; name: string };
export type AccessProfile = {
  id: string;
  key: string;
  name: string;
  description: string;
  active: boolean;
  is_system: boolean;
  legacy_role: string;
  created_at: string;
  updated_at: string;
};
export type Permission = {
  id: string;
  key: string;
  module: string;
  action: string;
  description: string;
  created_at: string;
};
export type AccessProfilePermission = {
  access_profile_id: string;
  permission_id: string;
  created_at: string;
};
export type Professional = {
  id: string;
  institutional_email: string | null;
  name: string;
  registration: string;
  job_title: string;
  active: boolean;
  auth_user_id: string | null;
  previous_auth_user_id: string | null;
  identity_linked_at: string | null;
  identity_unlinked_at: string | null;
  created_at: string;
  updated_at: string;
};
export type Message = {
  id: string;
  order_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
export type Attachment = {
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
  service_entry_id: number | null;
  created_at: string;
};
export type OrderEvent = {
  id: number;
  order_id: string;
  actor: string | null;
  from_status: string | null;
  to_status: string;
  reason: string;
  event_type: string | null;
  actor_membership_id: string | null;
  metadata: Json | null;
  operation: OrderOperation | "advance" | null;
  created_at: string;
};
export type OrderServiceEntry = {
  id: number;
  order_id: string;
  author_id: string | null;
  author_membership_id: string | null;
  entry_type: string;
  description: string;
  serviced_at: string;
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
      os_access_profiles: Table<AccessProfile, "key" | "name" | "legacy_role">;
      os_permissions: Table<Permission, "key" | "module" | "action" | "description">;
      os_access_profile_permissions: Table<
        AccessProfilePermission,
        "access_profile_id" | "permission_id"
      >;
      os_professionals: Table<Professional, "name">;
      os_memberships: Table<Membership, "role">;
      os_catalogs: Table<Catalog, "legacy_id" | "kind" | "name">;
      os_orders: Table<Order & { updated_at: string }, "title">;
      os_messages: Table<Message, "order_id" | "body">;
      os_attachments: Table<
        Attachment,
        "id" | "order_id" | "name" | "path" | "mime_type" | "size_bytes"
      >;
      os_order_events: Table<OrderEvent>;
      os_order_service_entries: Table<
        OrderServiceEntry,
        "order_id" | "entry_type" | "description" | "serviced_at"
      >;
      os_audit: Table<Audit>;
      os_identity_events: Table<{
        id: number;
        professional_id: string | null;
        actor_auth_user_id: string | null;
        event_type: string;
        email_domain: string | null;
        metadata: Json;
        created_at: string;
      }>;
      os_import_records: Table<
        { source: string; source_id: string; payload: Json },
        "source" | "source_id" | "payload"
      >;
    };
    Views: Record<string, never>;
    Functions: {
      os_has_permission: {
        Args: { permission_key: string };
        Returns: boolean;
      };
      os_current_permissions: {
        Args: Record<string, never>;
        Returns: { permission_key: string }[];
      };
      os_save_access_profile: {
        Args: {
          target: string | null;
          profile_name: string;
          profile_description: string;
          profile_active: boolean;
          profile_legacy_role: string;
        };
        Returns: string;
      };
      os_set_access_profile_permissions: {
        Args: { target: string; permission_keys: string[] };
        Returns: undefined;
      };
      os_delete_access_profile: {
        Args: { target: string };
        Returns: undefined;
      };
      os_open_order: {
        Args: {
          order_title: string;
          target_unit: string;
          target_category: string;
          order_priority: string;
          order_details: Json;
          target_driver: string | null;
          target_vehicle: string | null;
          target_route: string | null;
        };
        Returns: string;
      };
      os_reconcile_order: {
        Args: {
          target: string;
          expected_version: number;
          target_unit: string;
          target_opened_by: string;
          target_category: string;
        };
        Returns: undefined;
      };
      os_start_triage: {
        Args: { target: string; expected_version: number };
        Returns: undefined;
      };
      os_forward_order: {
        Args: {
          target: string;
          expected_version: number;
          destination_unit: string;
        };
        Returns: undefined;
      };
      os_reassign_order: {
        Args: {
          target: string;
          expected_version: number;
          responsible_membership: string;
          justification: string;
        };
        Returns: undefined;
      };
      os_start_service: {
        Args: { target: string; expected_version: number };
        Returns: undefined;
      };
      os_add_service_entry: {
        Args: {
          target: string;
          expected_version: number;
          entry_kind: string;
          entry_description: string;
          serviced_on: string;
        };
        Returns: number;
      };
      os_wait_for_information: {
        Args: {
          target: string;
          expected_version: number;
          wait_reason: string;
          wait_details: string;
        };
        Returns: undefined;
      };
      os_resume_service: {
        Args: { target: string; expected_version: number };
        Returns: undefined;
      };
      os_change_status: {
        Args: { target: string; next_status: string; reason: string };
        Returns: undefined;
      };
      os_complete_order: {
        Args: { target: string; expected_version: number; solution: string };
        Returns: undefined;
      };
      os_cancel_order: {
        Args: {
          target: string;
          expected_version: number;
          justification: string;
        };
        Returns: undefined;
      };
      os_reopen_order: {
        Args: {
          target: string;
          expected_version: number;
          justification: string;
        };
        Returns: undefined;
      };
      os_order_available_actions: {
        Args: { target: string };
        Returns: { operation: WorkflowAction }[];
      };
      os_order_can_collaborate: {
        Args: { target: string };
        Returns: boolean;
      };
      os_order_header: {
        Args: { target: string };
        Returns: {
          category_name: string | null;
          requester_name: string | null;
          origin_unit_name: string | null;
          destination_unit_name: string | null;
          responsible_name: string | null;
        }[];
      };
      os_order_timeline: {
        Args: { target: string; page_size: number; page_offset: number };
        Returns: {
          event_id: number;
          event_type: string | null;
          created_at: string;
          actor_name: string;
          actor_role: string | null;
          actor_unit_name: string | null;
          summary: string | null;
          from_status: string | null;
          to_status: string;
          total_count: number;
        }[];
      };
      os_order_filter_options: {
        Args: Record<PropertyKey, never>;
        Returns: {
          option_kind: string;
          option_id: string;
          option_name: string;
        }[];
      };
      os_search_orders: {
        Args: {
          search_text: string | null;
          target_protocol: number | null;
          target_protocol_code: string | null;
          target_protocol_year: number | null;
          target_status: string | null;
          target_priority: string | null;
          target_category: string | null;
          target_origin_unit: string | null;
          target_destination_unit: string | null;
          target_requester: string | null;
          target_responsible: string | null;
          opened_from: string | null;
          opened_until: string | null;
          completed_from: string | null;
          completed_until: string | null;
          only_reopened: boolean;
          only_waiting: boolean;
          cursor_created_at: string | null;
          cursor_id: string | null;
          cursor_direction: "next" | "previous";
          page_size: number;
        };
        Returns: {
          id: string;
          protocol: number;
          protocol_year: number | null;
          protocol_code: string | null;
          title: string;
          status: string;
          priority: string;
          created_at: string;
          has_previous: boolean;
          has_next: boolean;
        }[];
      };
      os_assign_order: {
        Args:
          | {
              target: string;
              expected_version: number;
              responsible_membership: string;
            }
          | {
              target: string;
              target_unit: string;
              target_responsible: string | null;
              target_opened_by: string | null;
              target_category: string;
            };
        Returns: undefined;
      };
      os_edit_order_controlled: {
        Args: {
          target: string;
          expected_version: number;
          new_title: string;
          new_priority: string;
          priority_justification: string;
          detail_patch: Json;
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
      os_claim_professional_identity: {
        Args: Record<PropertyKey, never>;
        Returns: {
          result: string;
          professional_id: string | null;
          active_memberships: number;
        }[];
      };
      os_record_identity_denial: {
        Args: { denial_type: string; denied_domain: string };
        Returns: undefined;
      };
      os_professional_memberships: {
        Args: { page_size?: number; page_offset?: number };
        Returns: {
          membership_id: string | null;
          professional_id: string;
          professional_name: string;
          institutional_email: string | null;
          registration: string;
          job_title: string;
          professional_active: boolean;
          identity_linked: boolean;
          relink_pending: boolean;
          unit_id: string | null;
          role: string | null;
          membership_active: boolean | null;
          total_count: number;
        }[];
      };
      os_save_professional_membership: {
        Args: {
          target_membership: string | null;
          target_professional: string | null;
          professional_email: string;
          professional_name: string;
          professional_registration: string;
          professional_position: string;
          target_unit: string | null;
          target_role: string;
          professional_active: boolean;
          membership_active: boolean;
        };
        Returns: string;
      };
      os_deactivate_professional_membership: {
        Args: { target_membership: string };
        Returns: undefined;
      };
      os_prepare_professional_identity_change: {
        Args: { target_professional: string; new_email: string; justification: string };
        Returns: undefined;
      };
      os_restore_professional_identity: {
        Args: { target_professional: string; justification: string };
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
