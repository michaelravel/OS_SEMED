import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("interface administrativa usa o padrão existente e somente Server Actions", async () => {
  const page = await read("src/app/(app)/perfis/page.tsx");
  const actions = await read("src/app/actions/access-profiles.ts");
  const shell = await read("src/components/shell.tsx");
  const navigation = await read("src/lib/navigation.ts");
  const matrix = await read("src/components/permission-matrix.tsx");

  assert.match(page, /requirePagePermission\(routePermissions\.accessProfiles/);
  assert.match(page, /className="card table-wrap"/);
  assert.match(page, /className="form-grid"/);
  assert.match(page, /PermissionMatrix/);
  assert.match(page, /ActionSubmitButton/);
  assert.match(page, /confirmMessage=/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(navigation, /Perfis e Permissões/);
  assert.match(shell, /visibleNavigationItems/);
  assert.match(shell, /administrationLinks\.length > 0/);
  assert.match(matrix, /Selecionar todas/);
  assert.match(matrix, /Desmarcar todas/);
  assert.match(matrix, /Existem alterações não salvas/);
  assert.match(matrix, /Cancelar alterações/);
  assert.match(matrix, /Salvar permissões/);
  assert.match(matrix, /Operações da OS/);
  assert.match(matrix, /hasSensitiveChanges/);
  assert.doesNotMatch(matrix, /onChange=.*saveAccessProfilePermissions/s);

  for (const rpc of [
    "os_save_access_profile",
    "os_set_access_profile_permissions",
    "os_delete_access_profile",
  ])
    assert.match(actions, new RegExp(`db\\.rpc\\(\"${rpc}\"`));
  assert.match(
    actions,
    /administrationActionPermissions\.MANAGE_PROFESSIONAL/,
  );
});

test("página possui loading, erro, vazio, sucesso e responsividade", async () => {
  const page = await read("src/app/(app)/perfis/page.tsx");
  const loading = await read("src/app/(app)/perfis/loading.tsx");
  const error = await read("src/app/(app)/perfis/error.tsx");
  const styles = await read("src/styles/access-profiles.css");

  assert.match(page, /Nenhum perfil cadastrado/);
  assert.match(page, /notice success/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /Tentar novamente/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.permission-save-bar/);
});
