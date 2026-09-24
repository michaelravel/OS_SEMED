-- Fortalecimento incremental de anexos. Mantém bucket privado e download assinado.
-- O banco é a fonte dos limites; a aplicação consulta os mesmos valores por RPC.
begin;

create table os_private.attachment_policy (
  singleton boolean primary key default true check(singleton),
  max_file_bytes bigint not null check(max_file_bytes > 0),
  max_attachments_per_order integer not null check(max_attachments_per_order > 0),
  max_bytes_per_order bigint not null check(max_bytes_per_order >= max_file_bytes),
  max_bytes_per_user_per_order bigint not null check(max_bytes_per_user_per_order >= max_file_bytes),
  allowed_mimes text[] not null,
  allowed_extensions text[] not null
);
revoke all on os_private.attachment_policy from public, anon, authenticated;

insert into os_private.attachment_policy(
  max_file_bytes,max_attachments_per_order,max_bytes_per_order,
  max_bytes_per_user_per_order,allowed_mimes,allowed_extensions
) values(
  3145728,20,31457280,15728640,
  array[
    'application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  array['.pdf','.jpg','.jpeg','.png','.webp','.txt','.csv','.xlsx','.docx']
);

alter table public.os_attachments
  add column storage_status text not null default 'ready'
    check(storage_status in ('pending','unverified','ready','missing','quarantined')),
  add column inspection_status text not null default 'not_scanned'
    check(inspection_status in ('not_scanned','pending','clean','rejected','error')),
  add column content_sha256 text,
  add column storage_verified_at timestamptz,
  add column inspected_at timestamptz,
  add column quarantined_at timestamptz;

alter table public.os_attachments
  add constraint os_attachments_sha256_check
    check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$') not valid,
  add constraint os_attachments_safe_name_check
    check(
      name = btrim(name) and length(name) between 1 and 180 and
      name !~ '[[:cntrl:]]' and position('/' in name) = 0 and position(chr(92) in name) = 0
    ) not valid;

update storage.buckets set
  public = false,
  file_size_limit = (select max_file_bytes from os_private.attachment_policy where singleton),
  allowed_mime_types = (select allowed_mimes from os_private.attachment_policy where singleton)
where id = 'os-attachments';

create function public.os_attachment_policy()
returns table(
  max_file_bytes bigint,
  max_attachments_per_order integer,
  max_bytes_per_order bigint,
  max_bytes_per_user_per_order bigint,
  allowed_mimes text[],
  allowed_extensions text[]
) language sql stable security definer set search_path = '' as $$
  select p.max_file_bytes,p.max_attachments_per_order,p.max_bytes_per_order,
    p.max_bytes_per_user_per_order,p.allowed_mimes,p.allowed_extensions
  from os_private.attachment_policy p where p.singleton;
$$;

create function public.os_begin_attachment_upload(
  target_order uuid,
  attachment_id uuid,
  original_name text,
  declared_mime text,
  declared_size bigint,
  sha256 text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  policy os_private.attachment_policy%rowtype;
  target_path text := target_order::text || '/' || attachment_id::text;
  current_count integer;
  order_bytes bigint;
  user_bytes bigint;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  select * into policy from os_private.attachment_policy where singleton;
  if declared_size not between 1 and policy.max_file_bytes or
     not (declared_mime = any(policy.allowed_mimes)) or
     length(original_name) not between 1 and 180 or original_name <> btrim(original_name) or
     original_name ~ '[[:cntrl:]]' or position('/' in original_name) > 0 or
     position(chr(92) in original_name) > 0 or sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Anexo inválido';
  end if;
  if not (case declared_mime
    when 'application/pdf' then lower(original_name) like '%.pdf'
    when 'image/jpeg' then lower(original_name) like any(array['%.jpg','%.jpeg'])
    when 'image/png' then lower(original_name) like '%.png'
    when 'image/webp' then lower(original_name) like '%.webp'
    when 'text/plain' then lower(original_name) like '%.txt'
    when 'text/csv' then lower(original_name) like '%.csv'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then lower(original_name) like '%.xlsx'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then lower(original_name) like '%.docx'
    else false end) then raise exception 'Extensão incompatível'; end if;

  perform 1 from public.os_orders o
  where o.id = target_order and os_private.can_write_order(o.id)
  for update;
  if not found then raise exception 'Acesso negado'; end if;

  select count(*),coalesce(sum(a.size_bytes),0),
    coalesce(sum(a.size_bytes) filter(where a.uploaded_by = auth.uid()),0)
  into current_count,order_bytes,user_bytes
  from public.os_attachments a
  where a.order_id = target_order and a.storage_status <> 'missing';

  if current_count >= policy.max_attachments_per_order then
    raise exception 'Limite de anexos da ordem atingido';
  end if;
  if order_bytes + declared_size > policy.max_bytes_per_order then
    raise exception 'Limite total de anexos da ordem atingido';
  end if;
  if user_bytes + declared_size > policy.max_bytes_per_user_per_order then
    raise exception 'Limite de anexos do usuário nesta ordem atingido';
  end if;

  insert into public.os_attachments(
    id,order_id,uploaded_by,name,path,mime_type,size_bytes,
    storage_status,inspection_status,content_sha256
  ) values(
    attachment_id,target_order,auth.uid(),original_name,target_path,declared_mime,
    declared_size,'pending','not_scanned',sha256
  );
  return target_path;
end;
$$;

create function public.os_complete_attachment_upload(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  attachment public.os_attachments%rowtype;
  object_size bigint;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  select a.* into attachment from public.os_attachments a
  where a.id = target and a.uploaded_by = auth.uid()
    and a.storage_status in ('pending','unverified')
    and os_private.can_write_order(a.order_id)
  for update;
  if not found then raise exception 'Reserva de anexo não encontrada'; end if;

  select case when coalesce(s.metadata ->> 'size','') ~ '^[0-9]+$'
    then (s.metadata ->> 'size')::bigint end
  into object_size
  from storage.objects s
  where s.bucket_id = 'os-attachments' and s.name = attachment.path;
  if not found then raise exception 'Objeto do anexo não encontrado'; end if;
  if object_size is null then raise exception 'Tamanho do objeto indisponível'; end if;
  if object_size is not null and object_size <> attachment.size_bytes then
    update public.os_attachments set
      storage_status = 'quarantined', inspection_status = 'error',
      quarantined_at = now(), storage_verified_at = now()
    where id = target;
    return 'quarantined';
  end if;

  update public.os_attachments set
    storage_status = 'ready', storage_verified_at = now()
  where id = target;
  return 'ready';
end;
$$;

create function public.os_abort_attachment_upload(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  attachment public.os_attachments%rowtype;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  select a.* into attachment from public.os_attachments a
  where a.id = target and a.uploaded_by = auth.uid() and a.storage_status = 'pending'
  for update;
  if not found then return 'unchanged'; end if;

  if exists(
    select 1 from storage.objects s
    where s.bucket_id = 'os-attachments' and s.name = attachment.path
  ) then
    update public.os_attachments set storage_status = 'unverified' where id = target;
    return 'requires_reconciliation';
  end if;
  delete from public.os_attachments where id = target;
  return 'metadata_removed';
end;
$$;

create function public.os_attachment_reconciliation()
returns table(
  issue text,
  path text,
  attachment_id uuid,
  order_id uuid,
  metadata_size bigint,
  storage_size bigint,
  storage_status text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  return query
  with compared as (
    select
      case
        when a.id is null then 'object_without_metadata'
        when s.name is null then 'metadata_without_object'
        when a.storage_status in ('pending','unverified') then 'upload_not_finalized'
        when coalesce(s.metadata ->> 'size','') !~ '^[0-9]+$' then 'storage_size_unavailable'
        when coalesce(s.metadata ->> 'size','') ~ '^[0-9]+$'
          and (s.metadata ->> 'size')::bigint <> a.size_bytes then 'size_mismatch'
      end as issue,
      coalesce(a.path,s.name) as path,
      a.id as attachment_id,
      a.order_id,
      a.size_bytes::bigint as metadata_size,
      case when coalesce(s.metadata ->> 'size','') ~ '^[0-9]+$'
        then (s.metadata ->> 'size')::bigint end as storage_size,
      a.storage_status,
      a.created_at
    from public.os_attachments a
    full join storage.objects s
      on s.bucket_id = 'os-attachments' and s.name = a.path
    where s.name is null or s.bucket_id = 'os-attachments'
  )
  select c.issue,c.path,c.attachment_id,c.order_id,c.metadata_size,
    c.storage_size,c.storage_status,c.created_at
  from compared c where c.issue is not null order by c.path;
end;
$$;

create function public.os_reconcile_attachment(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  attachment public.os_attachments%rowtype;
  object_size bigint;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  select * into attachment from public.os_attachments where id = target for update;
  if not found then raise exception 'Anexo não encontrado'; end if;

  select case when coalesce(s.metadata ->> 'size','') ~ '^[0-9]+$'
    then (s.metadata ->> 'size')::bigint end
  into object_size
  from storage.objects s
  where s.bucket_id = 'os-attachments' and s.name = attachment.path;
  if not found then
    update public.os_attachments set storage_status = 'missing',
      storage_verified_at = now() where id = target;
    return 'missing';
  end if;
  if object_size is null then
    update public.os_attachments set storage_status = 'unverified',
      storage_verified_at = now() where id = target;
    return 'unverified';
  end if;
  if object_size is not null and object_size <> attachment.size_bytes then
    update public.os_attachments set storage_status = 'quarantined',
      inspection_status = 'error', quarantined_at = now(),
      storage_verified_at = now() where id = target;
    return 'quarantined';
  end if;
  update public.os_attachments set storage_status = 'ready',
    storage_verified_at = now() where id = target;
  return 'ready';
end;
$$;

drop policy attachments_read on public.os_attachments;
drop policy attachments_insert on public.os_attachments;
drop policy attachments_cleanup on public.os_attachments;
create policy attachments_read on public.os_attachments for select to authenticated using(
  storage_status = 'ready' and inspection_status <> 'rejected'
  and os_private.can_read_order_id(order_id)
);
revoke insert, update, delete on public.os_attachments from authenticated;

drop policy os_files_read on storage.objects;
drop policy os_files_insert on storage.objects;
create function os_private.can_upload_attachment_object(target_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_attachments a
    where a.path = target_path and a.uploaded_by = (select auth.uid())
      and a.storage_status = 'pending' and a.inspection_status <> 'rejected'
      and os_private.can_write_order(a.order_id)
  );
$$;
create policy os_files_read on storage.objects for select to authenticated using(
  bucket_id = 'os-attachments' and exists(
    select 1 from public.os_attachments a
    where a.path = storage.objects.name and a.storage_status = 'ready'
      and a.inspection_status <> 'rejected'
      and os_private.can_read_order_id(a.order_id)
  )
);
create policy os_files_insert on storage.objects for insert to authenticated with check(
  bucket_id = 'os-attachments' and os_private.can_upload_attachment_object(storage.objects.name)
);

drop trigger attachments_audit on public.os_attachments;
create trigger attachments_audit after insert or update or delete on public.os_attachments
  for each row execute function os_private.audit_change();

revoke all on function public.os_attachment_policy() from public, anon;
revoke all on function public.os_begin_attachment_upload(uuid,uuid,text,text,bigint,text) from public, anon;
revoke all on function public.os_complete_attachment_upload(uuid) from public, anon;
revoke all on function public.os_abort_attachment_upload(uuid) from public, anon;
revoke all on function public.os_attachment_reconciliation() from public, anon;
revoke all on function public.os_reconcile_attachment(uuid) from public, anon;
revoke all on function os_private.can_upload_attachment_object(text) from public, anon;
grant execute on function public.os_attachment_policy() to authenticated;
grant execute on function public.os_begin_attachment_upload(uuid,uuid,text,text,bigint,text) to authenticated;
grant execute on function public.os_complete_attachment_upload(uuid) to authenticated;
grant execute on function public.os_abort_attachment_upload(uuid) to authenticated;
grant execute on function public.os_attachment_reconciliation() to authenticated;
grant execute on function public.os_reconcile_attachment(uuid) to authenticated;
grant execute on function os_private.can_upload_attachment_object(text) to authenticated;

commit;
