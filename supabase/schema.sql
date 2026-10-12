create extension if not exists pgcrypto;

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null default '',
  brand text not null default '',
  stock integer not null default 0 check (stock >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  sold integer not null default 0 check (sold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sku)
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  work_date date not null default current_date,
  plate text not null,
  make text not null,
  model text not null,
  customer text not null,
  phone text,
  status text not null default 'Devam ediyor',
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

create table if not exists public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  part_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  supplier text not null,
  invoice_date date not null default current_date,
  total numeric(12, 2) not null default 0 check (total >= 0),
  status text not null default 'Ödendi',
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

create table if not exists public.purchase_invoice_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.purchase_invoices(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  part_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.draft_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  status text not null default 'draft' check (status in ('draft', 'received')),
  created_at timestamptz not null default now(),
  received_at timestamptz
);

create table if not exists public.draft_order_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draft_id uuid not null references public.draft_orders(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  part_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

alter table public.parts enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_items enable row level security;
alter table public.purchase_invoices enable row level security;
alter table public.purchase_invoice_items enable row level security;
alter table public.draft_orders enable row level security;
alter table public.draft_order_items enable row level security;

create policy "Users manage their parts" on public.parts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their work orders" on public.work_orders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their work order items" on public.work_order_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their invoices" on public.purchase_invoices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their invoice items" on public.purchase_invoice_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their drafts" on public.draft_orders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their draft items" on public.draft_order_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.parts, public.work_orders, public.work_order_items,
  public.purchase_invoices, public.purchase_invoice_items, public.draft_orders, public.draft_order_items
to authenticated;

create or replace function public.create_work_order(
  p_plate text,
  p_make text,
  p_model text,
  p_customer text,
  p_phone text,
  p_items jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_item jsonb;
  v_part public.parts%rowtype;
  v_part_id uuid;
  v_quantity integer;
  v_total numeric(12, 2) := 0;
begin
  if v_user is null then raise exception 'Oturum açmanız gerekiyor.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'En az bir parça seçin.'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity <= 0 then raise exception 'Parça adedi sıfırdan büyük olmalı.'; end if;
    select * into v_part from public.parts where id = v_part_id and user_id = v_user for update;
    if not found then raise exception 'Seçilen parça bulunamadı.'; end if;
    if v_part.stock < v_quantity then raise exception '% için yeterli stok yok.', v_part.name; end if;
    v_total := v_total + v_part.price * v_quantity;
  end loop;

  insert into public.work_orders (user_id, code, plate, make, model, customer, phone, total)
  values (v_user, 'IS-' || to_char(current_date, 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
          upper(trim(p_plate)), trim(p_make), trim(p_model), trim(p_customer), nullif(trim(p_phone), ''), v_total)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_part from public.parts where id = v_part_id and user_id = v_user for update;
    update public.parts set stock = stock - v_quantity, sold = sold + v_quantity, updated_at = now() where id = v_part_id;
    insert into public.work_order_items (user_id, work_order_id, part_id, part_name, quantity, unit_price)
    values (v_user, v_order_id, v_part_id, v_part.name, v_quantity, v_part.price);
  end loop;
  return v_order_id;
end;
$$;

create or replace function public.create_purchase_invoice(p_supplier text, p_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_invoice_id uuid;
  v_item jsonb;
  v_part public.parts%rowtype;
  v_part_id uuid;
  v_quantity integer;
  v_cost numeric(12, 2);
  v_total numeric(12, 2) := 0;
begin
  if v_user is null then raise exception 'Oturum açmanız gerekiyor.'; end if;
  if nullif(trim(p_supplier), '') is null then raise exception 'Tedarikçi adı gerekli.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'En az bir parça satırı ekleyin.'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_quantity <= 0 or v_cost < 0 then raise exception 'Adet veya alış fiyatı geçersiz.'; end if;
    select * into v_part from public.parts where id = v_part_id and user_id = v_user for update;
    if not found then raise exception 'Faturadaki bir parça envanterde bulunamadı.'; end if;
    v_total := v_total + v_quantity * v_cost;
  end loop;

  insert into public.purchase_invoices (user_id, code, supplier, total)
  values (v_user, 'AL-' || to_char(current_date, 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), trim(p_supplier), v_total)
  returning id into v_invoice_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_cost := (v_item->>'unit_cost')::numeric;
    select * into v_part from public.parts where id = v_part_id and user_id = v_user for update;
    update public.parts set stock = stock + v_quantity, cost = v_cost, updated_at = now() where id = v_part_id;
    insert into public.purchase_invoice_items (user_id, invoice_id, part_id, part_name, sku, quantity, unit_cost)
    values (v_user, v_invoice_id, v_part_id, v_part.name, v_part.sku, v_quantity, v_cost);
  end loop;
  return v_invoice_id;
end;
$$;

create or replace function public.create_stock_draft()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_draft_id uuid;
  v_part public.parts%rowtype;
begin
  if v_user is null then raise exception 'Oturum açmanız gerekiyor.'; end if;
  if not exists (select 1 from public.parts where user_id = v_user and stock <= minimum_stock) then
    raise exception 'Kritik seviyede parça bulunmuyor.';
  end if;
  insert into public.draft_orders (user_id, code) values
    (v_user, 'SIP-' || to_char(current_date, 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
  returning id into v_draft_id;
  for v_part in select * from public.parts where user_id = v_user and stock <= minimum_stock for update loop
    insert into public.draft_order_items (user_id, draft_id, part_id, part_name, sku, quantity, unit_cost)
    values (v_user, v_draft_id, v_part.id, v_part.name, v_part.sku,
            greatest(v_part.minimum_stock * 2 - v_part.stock, v_part.minimum_stock), v_part.cost);
  end loop;
  return v_draft_id;
end;
$$;

create or replace function public.receive_stock_draft(p_draft_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.draft_order_items%rowtype;
begin
  if v_user is null then raise exception 'Oturum açmanız gerekiyor.'; end if;
  perform 1 from public.draft_orders where id = p_draft_id and user_id = v_user and status = 'draft' for update;
  if not found then raise exception 'Taslak sipariş bulunamadı veya daha önce stoğa işlendi.'; end if;
  for v_item in select * from public.draft_order_items where draft_id = p_draft_id and user_id = v_user loop
    if v_item.part_id is null then raise exception '% envanterden silinmiş; sipariş stoğa aktarılamadı.', v_item.part_name; end if;
    update public.parts set stock = stock + v_item.quantity, updated_at = now()
    where id = v_item.part_id and user_id = v_user;
    if not found then raise exception '% envanterde bulunamadı.', v_item.part_name; end if;
  end loop;
  update public.draft_orders set status = 'received', received_at = now()
  where id = p_draft_id and user_id = v_user;
end;
$$;

revoke all on function public.create_work_order(text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.create_purchase_invoice(text, jsonb) from public, anon;
revoke all on function public.create_stock_draft() from public, anon;
revoke all on function public.receive_stock_draft(uuid) from public, anon;
grant execute on function public.create_work_order(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.create_purchase_invoice(text, jsonb) to authenticated;
grant execute on function public.create_stock_draft() to authenticated;
grant execute on function public.receive_stock_draft(uuid) to authenticated;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['parts', 'work_orders', 'work_order_items', 'purchase_invoices', 'purchase_invoice_items', 'draft_orders', 'draft_order_items'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end
$$;
