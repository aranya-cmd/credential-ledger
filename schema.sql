-- Credential Ledger schema
-- Run this once in Supabase → SQL Editor → New query → Run

create extension if not exists pgcrypto;

create table if not exists firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  created_at timestamptz default now()
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete cascade,
  event_name text not null,
  project_category text,
  client_authority text,
  state text,
  created_at timestamptz default now()
);

create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references assignments(id) on delete cascade,
  wo_number text not null,
  status text,
  financial_year text,
  scope text,
  candidates_count numeric,
  camera_count numeric,
  centres_or_booths numeric,
  wo_value numeric,
  duration_deployment text,
  created_at timestamptz default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete cascade,
  title text not null,
  doc_type text,
  created_at timestamptz default now()
);

create table if not exists document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  work_order_id uuid references work_orders(id) on delete cascade,
  role text,
  fields_enriched text[],
  created_at timestamptz default now()
);

create table if not exists field_values (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references work_orders(id) on delete cascade,
  field_name text,
  value text,
  source_type text,
  source_document_id uuid references documents(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists flags (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  type text,
  work_order_id uuid references work_orders(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  resolved boolean default false,
  created_at timestamptz default now()
);

-- Row Level Security: every signed-in teammate can read/write everything.
-- This is a "shared team workspace" model, not per-user private data.
alter table firms enable row level security;
alter table assignments enable row level security;
alter table work_orders enable row level security;
alter table documents enable row level security;
alter table document_links enable row level security;
alter table field_values enable row level security;
alter table flags enable row level security;

create policy "authenticated full access" on firms
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on assignments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on work_orders
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on documents
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on document_links
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on field_values
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on flags
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
