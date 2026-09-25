import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  administrationActionPermissions,
  catalogPermission,
  orderActionPermissions,
  routePermissions,
} from "../src/lib/authorization-policy.ts";

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

function actionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `Server Action ausente: ${name}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("catálogo central associa cada operação protegida à permissão explícita", () => {
  assert.deepEqual(orderActionPermissions, {
    CREATE: "orders.create",
    RECONCILE: "orders.update",
    TRIAGE: "orders.triage",
    FORWARD: "orders.forward",
    ASSIGN: "orders.assign",
    REASSIGN: "orders.reassign",
    START_SERVICE: "orders.attend",
    ADD_SERVICE_ENTRY: "orders.attend",
    WAIT_INFORMATION: "orders.wait_information",
    RESUME: "orders.resume",
    COMPLETE: "orders.complete",
    CANCEL: "orders.cancel",
    REOPEN: "orders.reopen",
    EDIT: "orders.update",
    ADD_MESSAGE: "orders.view",
    UPLOAD_ATTACHMENT: "orders.view",
  });
  assert.equal(catalogPermission("drivers", "update"), "drivers.update");
  assert.equal(routePermissions.professionals, "professionals.view");
  assert.equal(
    administrationActionPermissions.DELETE_PROFESSIONAL,
    "professionals.delete",
  );
});

test("Server Actions verificam RBAC antes das RPCs e escritas", async () => {
  const orders = await read("src/app/actions/orders.ts");
  const attachments = await read("src/app/actions/attachments.ts");
  const administration = await read("src/app/actions/administration.ts");
  const expectedOrderActions = {
    createOrder: "CREATE",
    reconcileOrder: "RECONCILE",
    startTriage: "TRIAGE",
    forwardOrder: "FORWARD",
    assignOrder: "ASSIGN",
    reassignOrder: "REASSIGN",
    startService: "START_SERVICE",
    addServiceEntry: "ADD_SERVICE_ENTRY",
    waitForInformation: "WAIT_INFORMATION",
    resumeService: "RESUME",
    completeOrder: "COMPLETE",
    cancelOrder: "CANCEL",
    reopenOrder: "REOPEN",
    editOrderDetails: "EDIT",
    editOrderControlled: "EDIT",
    updateOrderLinksLegacy: "ASSIGN",
    addMessage: "ADD_MESSAGE",
  };

  for (const [action, permission] of Object.entries(expectedOrderActions)) {
    const body = actionBody(orders, action);
    const permissionIndex = body.indexOf(`orderActionPermissions.${permission}`);
    const mutationIndexes = [body.indexOf("db.rpc("), body.indexOf('.insert(')]
      .filter((index) => index >= 0);
    assert.ok(permissionIndex >= 0, `${action} não exige ${permission}`);
    assert.ok(
      mutationIndexes.length === 0 || permissionIndex < Math.min(...mutationIndexes),
      `${action} verifica a permissão depois da mutação`,
    );
  }
  assert.match(actionBody(orders, "changeStatus"), /legacyStatusPermission\(/);

  assert.match(
    actionBody(attachments, "uploadAttachment"),
    /orderActionPermissions\.UPLOAD_ATTACHMENT/,
  );
  assert.match(actionBody(administration, "saveCatalog"), /catalogPermission\(/);
  assert.match(
    actionBody(administration, "saveUnit"),
    /administrationActionPermissions\.(CREATE|UPDATE)_UNIT/,
  );
  for (const action of [
    "saveMembership",
    "prepareProfessionalIdentityChange",
    "restoreProfessionalIdentity",
  ]) {
    assert.match(
      actionBody(administration, action),
      /administrationActionPermissions\.MANAGE_PROFESSIONAL/,
    );
  }
  const professional = actionBody(administration, "saveProfessionalMembership");
  for (const permission of ["CREATE", "UPDATE", "DELETE", "MANAGE"])
    assert.match(
      professional,
      new RegExp(`administrationActionPermissions\\.${permission}_PROFESSIONAL`),
    );
  const deactivate = actionBody(
    administration,
    "deactivateProfessionalMembership",
  );
  assert.match(
    deactivate,
    /administrationActionPermissions\.DELETE_PROFESSIONAL/,
  );
  assert.ok(
    deactivate.indexOf("DELETE_PROFESSIONAL") <
      deactivate.indexOf('db.rpc("os_deactivate_professional_membership"'),
  );
});

test("componentes ocultam controles usando o contrato central", async () => {
  const shell = await read("src/components/shell.tsx");
  const layout = await read("src/app/(app)/layout.tsx");
  const units = await read("src/app/(app)/unidades/page.tsx");
  const catalogs = await read("src/app/(app)/cadastros/[kind]/page.tsx");
  const professionals = await read("src/app/(app)/usuarios/page.tsx");
  const orderPage = await read("src/app/(app)/ordens/[id]/page.tsx");
  const workflow = await read(
    "src/components/order-details/order-workflow-actions.tsx",
  );

  assert.match(layout, /permissions=\{\[\.\.\.permissions\]\}/);
  assert.match(shell, /visibleNavigationItems\(new Set\(permissions\), admin\)/);
  assert.match(units, /administrationActionPermissions\.CREATE_UNIT/);
  assert.match(units, /administrationActionPermissions\.UPDATE_UNIT/);
  assert.match(catalogs, /catalogPermission\(kind, "create"\)/);
  assert.match(catalogs, /catalogPermission\(kind, "update"\)/);
  for (const permission of ["CREATE", "UPDATE", "DELETE", "MANAGE"])
    assert.match(
      professionals,
      new RegExp(`administrationActionPermissions\\.${permission}_PROFESSIONAL`),
    );
  assert.match(orderPage, /db\.rpc\("os_order_available_actions"/);
  assert.match(workflow, /new Set\(actions\.map/);
  assert.doesNotMatch(workflow, /roleNames|role ===|admin/);
});

test("rotas privadas recusam acesso direto por permissão no servidor", async () => {
  const pages = {
    "src/app/(app)/painel/page.tsx": "routePermissions.dashboard",
    "src/app/(app)/ordens/page.tsx": "routePermissions.orders",
    "src/app/(app)/ordens/[id]/page.tsx": "routePermissions.orders",
    "src/app/(app)/ordens/nova/page.tsx": "routePermissions.newOrder",
    "src/app/(app)/unidades/page.tsx": "routePermissions.units",
    "src/app/(app)/usuarios/page.tsx": "routePermissions.professionals",
    "src/app/(app)/auditoria/page.tsx": "routePermissions.audit",
    "src/app/(app)/perfis/page.tsx": "routePermissions.accessProfiles",
  };
  for (const [path, permission] of Object.entries(pages)) {
    const source = await read(path);
    assert.match(source, /requirePagePermission\(/, `${path} não protege a URL`);
    assert.ok(source.includes(permission), `${path} não exige ${permission}`);
  }
  assert.match(
    await read("src/app/(app)/cadastros/[kind]/page.tsx"),
    /requirePagePermission\(catalogPermission\(kind, "view"\), db\)/,
  );
  assert.match(
    await read("src/app/anexos/[id]/route.ts"),
    /hasPermission\(routePermissions\.orders, db\)/,
  );
});

test("RPCs críticas repetem RBAC antes da implementação interna", async () => {
  const migration = await read(
    "supabase/migrations/202609250005_rbac_authorization.sql",
  );
  const required = [
    "orders.create",
    "orders.update",
    "orders.triage",
    "orders.forward",
    "orders.assign",
    "orders.reassign",
    "orders.attend",
    "orders.wait_information",
    "orders.resume",
    "orders.complete",
    "orders.cancel",
    "orders.reopen",
    "professionals.view",
    "professionals.create",
    "professionals.update",
    "professionals.delete",
    "professionals.manage",
  ];
  for (const permission of required)
    assert.ok(
      migration.includes(`'${permission}'`),
      `migration não aplica ${permission}`,
    );
  assert.match(migration, /can_write_order[\s\S]*has_permission\('orders\.view'\)/);
});
