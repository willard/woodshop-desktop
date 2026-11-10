-- Dump one account's projects from the Woodshop web app's Postgres database as a single JSON
-- document for `cargo run -p woodshop-store --example import_laravel`.
--
--   psql -h 127.0.0.1 -p 5433 -U woodshop -d woodshop -At -v email=you@example.com \
--        -f scripts/export-laravel.sql > laravel-projects.json
--
-- Timestamps are the app's UTC wall-clock times, exported as epoch milliseconds.
\set QUIET on
select json_build_object(
    'email', u.email,
    'projects', coalesce((
        select json_agg(json_build_object(
            'id', p.id,
            'name', p.name,
            'draft', p.draft,
            'createdAt', (extract(epoch from p.created_at at time zone 'UTC') * 1000)::bigint,
            'updatedAt', (extract(epoch from coalesce(p.draft_updated_at, p.updated_at) at time zone 'UTC') * 1000)::bigint,
            'deletedAt', (extract(epoch from p.deleted_at at time zone 'UTC') * 1000)::bigint,
            'thumbnailPath', p.thumbnail_path,
            'versions', coalesce((
                select json_agg(json_build_object(
                    'label', v.label,
                    'createdBy', v.created_by,
                    'createdAt', (extract(epoch from v.created_at at time zone 'UTC') * 1000)::bigint,
                    'spec', v.spec
                ) order by v.created_at desc, v.id desc)
                from project_versions v where v.project_id = p.id
            ), '[]'::json),
            'notes', coalesce((
                select json_agg(json_build_object(
                    'body', n.body,
                    'pinned', n.pinned,
                    'createdAt', (extract(epoch from n.created_at at time zone 'UTC') * 1000)::bigint
                ) order by n.created_at)
                from project_notes n where n.project_id = p.id
            ), '[]'::json)
        ) order by p.id)
        from projects p where p.user_id = u.id
    ), '[]'::json)
)
from users u where u.email = :'email';
