begin;

create table public.sapgu_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false
);

create table sapgu.pages_invites (
  code uuid primary key default gen_random_uuid(),
  is_admin boolean not null default false,
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_at timestamptz
);
revoke all on sapgu.pages_invites from public, anon, authenticated;

create table public.sapgu_notebooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.sapgu_members(user_id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  subject text not null check (length(btrim(subject)) between 1 and 40),
  cover_style text not null default 'blue' check (cover_style in (
    'blue','coral','green','violet','gold','slate','hanji','linen','marble','gingham','orchard','moon','frame','waves','geo')),
  cover_image text check (length(cover_image) <= 6990508),
  updated_at timestamptz not null default now()
);
create index on public.sapgu_notebooks(owner_id, updated_at desc);

create table public.sapgu_chapters (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.sapgu_notebooks(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  position integer not null check (position >= 0)
);
create index on public.sapgu_chapters(notebook_id, position);

create table public.sapgu_pages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.sapgu_chapters(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 100),
  position integer not null check (position >= 0),
  paper_template text not null default 'lined' check (paper_template in (
    'lined','wide-lined','margin-lined','grid','fine-grid','dots','blank','cream','hanji',
    'cornell','two-column','weekly','music','handwriting','custom')),
  paper_image text check (length(paper_image) <= 6990508),
  ink_data jsonb not null default '[]' check (jsonb_array_length(ink_data) <= 5000),
  text_boxes jsonb not null default '[]' check (jsonb_array_length(text_boxes) <= 500),
  sticky_notes jsonb not null default '[]' check (jsonb_array_length(sticky_notes) <= 500),
  text_content text not null default '' check (length(text_content) <= 50000),
  recognized_text text not null default '' check (length(recognized_text) <= 50000),
  quiz_terms jsonb not null default '[]' check (jsonb_array_length(quiz_terms) <= 50),
  recognition_blocks jsonb not null default '[]' check (jsonb_array_length(recognition_blocks) <= 5000),
  uncertain_ranges jsonb not null default '[]' check (jsonb_array_length(uncertain_ranges) <= 5000),
  updated_at timestamptz not null default now(),
  check (paper_template <> 'custom' or paper_image is not null)
);
create index on public.sapgu_pages(chapter_id, position);

create table public.sapgu_preferences (
  owner_id uuid primary key default auth.uid() references public.sapgu_members(user_id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 1000000)
);

create table public.sapgu_study_sessions (
  owner_id uuid not null default auth.uid() references public.sapgu_members(user_id) on delete cascade,
  client_id text not null check (length(client_id) between 1 and 80),
  subject text not null check (subject in ('korean','english','math','science','social','etc')),
  mode text not null check (mode in ('normal','pomodoro','mock')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  primary key(owner_id, client_id),
  check (ended_at > started_at)
);
create index on public.sapgu_study_sessions(owner_id, started_at);

create table public.sapgu_views (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.sapgu_notebooks(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('map', 'reorder')),
  unit text not null check (unit in ('page', 'paragraph')),
  items jsonb not null check (jsonb_array_length(items) <= 100),
  updated_at timestamptz not null default now()
);
create index on public.sapgu_views(notebook_id, kind, updated_at desc);

create table public.sapgu_attempts (
  id uuid primary key,
  notebook_id uuid not null references public.sapgu_notebooks(id) on delete cascade,
  mode text not null check (mode in ('blank', 'card', 'speed')),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  results jsonb not null check (jsonb_array_length(results) between 1 and 150),
  created_at timestamptz not null default now()
);
create index on public.sapgu_attempts(notebook_id, created_at desc);

alter table public.sapgu_members enable row level security;
alter table public.sapgu_notebooks enable row level security;
alter table public.sapgu_chapters enable row level security;
alter table public.sapgu_pages enable row level security;
alter table public.sapgu_preferences enable row level security;
alter table public.sapgu_study_sessions enable row level security;
alter table public.sapgu_views enable row level security;
alter table public.sapgu_attempts enable row level security;

revoke all on public.sapgu_members, public.sapgu_notebooks, public.sapgu_chapters, public.sapgu_pages,
  public.sapgu_preferences, public.sapgu_study_sessions, public.sapgu_views, public.sapgu_attempts from public, anon, authenticated;
grant select on public.sapgu_members to authenticated;
grant select, insert, update, delete on public.sapgu_notebooks, public.sapgu_chapters, public.sapgu_pages to authenticated;
grant select, insert, update on public.sapgu_preferences to authenticated;
grant select, insert on public.sapgu_study_sessions to authenticated;
grant select, insert, update on public.sapgu_views to authenticated;
grant select, insert on public.sapgu_attempts to authenticated;

create policy members_self on public.sapgu_members for select to authenticated using (user_id = (select auth.uid()));
create policy notebooks_self on public.sapgu_notebooks for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy chapters_self on public.sapgu_chapters for all to authenticated
  using (exists (select 1 from public.sapgu_notebooks n where n.id = notebook_id and n.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.sapgu_notebooks n where n.id = notebook_id and n.owner_id = (select auth.uid())));
create policy pages_self on public.sapgu_pages for all to authenticated
  using (exists (select 1 from public.sapgu_chapters c where c.id = chapter_id))
  with check (exists (select 1 from public.sapgu_chapters c where c.id = chapter_id));
create policy preferences_self on public.sapgu_preferences for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy sessions_self on public.sapgu_study_sessions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy views_self on public.sapgu_views for all to authenticated
  using (exists (select 1 from public.sapgu_notebooks n where n.id = notebook_id))
  with check (exists (select 1 from public.sapgu_notebooks n where n.id = notebook_id));
create policy attempts_self on public.sapgu_attempts for all to authenticated
  using (exists (select 1 from public.sapgu_notebooks n where n.id = notebook_id))
  with check (exists (select 1 from public.sapgu_notebooks n where n.id = notebook_id));

create function public.sapgu_redeem_invite(invite_code uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid(); invite sapgu.pages_invites%rowtype;
begin
  if account is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account::text, 0));
  if exists (select from public.sapgu_members where user_id = account) then return; end if;
  select * into invite from sapgu.pages_invites
    where code = invite_code and redeemed_at is null and expires_at > now() for update;
  if not found then raise exception 'Invalid or expired invitation' using errcode = '22023'; end if;
  insert into public.sapgu_members (user_id, is_admin) values (account, invite.is_admin);
  update sapgu.pages_invites set redeemed_at = now() where code = invite.code;
end;
$$;

create function public.sapgu_create_invite() returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation uuid;
begin
  if not exists (select from public.sapgu_members where user_id = auth.uid() and is_admin) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  insert into sapgu.pages_invites default values returning code into invitation;
  return invitation;
end;
$$;

create function public.sapgu_new_notebook(book_title text, book_subject text, book_cover text, book_png text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare book uuid; chapter uuid;
begin
  insert into public.sapgu_notebooks(title, subject, cover_style, cover_image)
    values (btrim(book_title), btrim(book_subject), book_cover, book_png) returning id into book;
  insert into public.sapgu_chapters(notebook_id, title, position)
    values (book, '첫 번째 챕터', 0) returning id into chapter;
  insert into public.sapgu_pages(chapter_id, title, position) values(chapter, '첫 페이지', 0);
  return book;
end;
$$;

create function public.sapgu_new_chapter(book uuid, chapter_title text, after_chapter uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare chapter uuid; first_page uuid; next_position integer;
begin
  perform 1 from public.sapgu_notebooks where id = book for update;
  if not found then raise exception 'Notebook unavailable' using errcode = '42501'; end if;
  if after_chapter is null then
    select coalesce(max(position), -1) + 1 into next_position from public.sapgu_chapters where notebook_id = book;
  else
    select position + 1 into next_position from public.sapgu_chapters where id = after_chapter and notebook_id = book;
    if not found then raise exception 'Chapter unavailable' using errcode = '42501'; end if;
    update public.sapgu_chapters set position = position + 1 where notebook_id = book and position >= next_position;
  end if;
  insert into public.sapgu_chapters(notebook_id, title, position)
    values (book, coalesce(nullif(btrim(chapter_title), ''), '새 챕터'), next_position) returning id into chapter;
  insert into public.sapgu_pages(chapter_id, title, position) values(chapter, '첫 페이지', 0) returning id into first_page;
  return first_page;
end;
$$;

create function public.sapgu_new_page(parent_chapter uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare next_position integer; style text; image text; page_id uuid;
begin
  perform 1 from public.sapgu_chapters where id = parent_chapter for update;
  if not found then raise exception 'Chapter unavailable' using errcode = '42501'; end if;
  select position + 1, paper_template, paper_image into next_position, style, image
    from public.sapgu_pages where chapter_id = parent_chapter order by position desc, id desc limit 1;
  next_position := coalesce(next_position, 0);
  insert into public.sapgu_pages(chapter_id, title, position, paper_template, paper_image)
    values (parent_chapter, (next_position + 1) || '쪽', next_position, coalesce(style, 'lined'), image) returning id into page_id;
  return page_id;
end;
$$;

revoke all on function public.sapgu_redeem_invite(uuid), public.sapgu_create_invite(),
  public.sapgu_new_notebook(text,text,text,text), public.sapgu_new_chapter(uuid,text,uuid), public.sapgu_new_page(uuid)
  from public, anon, authenticated;
grant execute on function public.sapgu_redeem_invite(uuid), public.sapgu_create_invite(),
  public.sapgu_new_notebook(text,text,text,text), public.sapgu_new_chapter(uuid,text,uuid), public.sapgu_new_page(uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
