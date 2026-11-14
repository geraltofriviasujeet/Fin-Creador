# Knowledge base: owner's runbook (dev)

Commands for the owner only; Claude and CI never run them. Placeholders: `<dev-project-ref>`
and `~/<private>/dev.env`. No key ever goes on the command line, in the repository or in chat.
Run from the repository root, Node 22.18 or later. File format and rules:
`supabase/knowledge/README.md`.

## 0. Before you start

PR #66's CI is green, and migration `20261113120000_knowledge_embed.sql` is applied to dev the
way you apply every migration (the ingestion writes its `link_permission_pending` column, and
the embed function calls its `roma_knowledge_embed`).

```sh
supabase migration list --linked
```

Works when: the `20261113120000` row shows the same version under Local and Remote.

## 1. Deploy the embed Edge Function to dev

```sh
supabase functions deploy embed --use-api --project-ref <dev-project-ref>
```

Works when: it ends by reporting `embed` as deployed to `<dev-project-ref>`, with no error.
`verify_jwt = false` comes from `supabase/config.toml`; the function checks every token itself.
No secrets to set: Supabase gives the function its URL, anon key and service-role key.

Check that it refuses a caller with no token:

```sh
curl -s -X POST https://<dev-project-ref>.supabase.co/functions/v1/embed
```

Works when: it prints `{"error":"unauthorized"}`.

## 2. Ingest the documents into dev

Once: create the env file outside the repository, readable only by you, with two lines
(`SUPABASE_URL=https://<dev-project-ref>.supabase.co` and `SUPABASE_SERVICE_ROLE_KEY=<the
key>`; Dashboard → Project Settings → API keys: a secret key (`sb_secret_...`) or the legacy
service-role key. The embed function accepts either, from its deploy of 2026-11-14 on):

```sh
umask 077; touch ~/<private>/dev.env; open -e ~/<private>/dev.env
```

Check the files first. `--check` reads and chunks them only: no key, no network, no writes.

```sh
npm run knowledge:ingest -- --check
```

Works when: one line per document, such as
`income-tax-old-regime-2026-27: own, draft, N passages`, then `23 documents read; nothing
written.` A bad file prints `<file>.md: <every problem>` and nothing else.

Then for real:

```sh
KNOWLEDGE_ENV_FILE=~/<private>/dev.env npm run knowledge:ingest
```

Works when: one line per new or changed document, such as
`compounding: written (draft, N passages)`, then `23 written, 0 unchanged, 0 retired.` on the
first run. Running it again straight away prints `0 written, 23 unchanged, 0 retired.` An error
prints one line with the document's slug and the reason, never the key or the text (for example
`compounding: POST /functions/v1/embed failed: 400 invalid_request (text_too_long)`), and exits
with code 1; fix the cause and run it again, it redoes only what is unfinished. Reason
`request_id_missing` means the function did not recognise the key as a service key; the line
ends with what the function saw (for example `bearer jwt:service_role, apikey sb_secret`, only
the kind of each token). Check the key in the env file and that the function is redeployed.

Check (SQL editor):

```sql
select status, count(*) from public.knowledge_documents group by status;
select count(*) from public.knowledge_chunks;
```

Works when: `draft | 23` and a chunk count equal to the sum of the passages printed.

## 3. Approve or retire documents

Status lives in each file's frontmatter, and the database follows it on the next run.

- **Approve** (after reading the document): change `status: draft` to `status: approved`,
  commit, then run `npm run knowledge:ingest -- --check` (works when that document's line shows
  `approved`) and `KNOWLEDGE_ENV_FILE=~/<private>/dev.env npm run knowledge:ingest` (works when
  it prints `<slug>: written (approved, N passages)`). Only approved documents are searchable;
  draft and retired ones never reach Roma.
- **Editing an approved document** re-embeds it on the next run, and it stays approved only if
  the file still says `approved`. Re-read it before keeping that status.
- **Retire**: set `status: retired` and run the script (works when it prints
  `<slug>: written (retired, N passages)`). This keeps the file, so it can come back by
  setting `draft` or `approved` again. Deleting the file also retires it (works when the
  summary shows `1 retired`); its row stays in the database, never deleted.

## 4. Evaluate retrieval (10.6c)

Measures whether each of 15 questions finds the document it should, and whether 3 questions
with no vetted material find nothing, at floors 0.70 to 0.88. Writes nothing. It calls the
deployed embed function and `match_knowledge_chunks` itself; the service role can't call that
function (execute is granted to signed-in users only), so it signs in as a test user.

Add three lines to `~/<private>/dev.env` (a test account on dev, never a real person's):

```text
SUPABASE_PUBLISHABLE_KEY=<dev publishable key>
KNOWLEDGE_EVAL_EMAIL=<test user email>
KNOWLEDGE_EVAL_PASSWORD=<test user password>
```

```sh
npm run knowledge:eval -- --check
KNOWLEDGE_ENV_FILE=~/<private>/dev.env npm run knowledge:eval
KNOWLEDGE_ENV_FILE=~/<private>/dev.env npm run knowledge:eval -- --include-drafts
```

Works when: a table of hit@1, hit@4 and "nothing found correctly" per floor, then each question's
top passages (document, similarity, passage length). Questions whose document is still a draft
are counted as skipped; `--include-drafts` ranks them in the script instead, reported apart.
Pick the floor with the best hit@4 that still finds nothing for the 3 "nothing" questions, and
set it as `KNOWLEDGE_MIN_SIMILARITY` (default 0.82; passages more than 0.05 below the top one are dropped) in the web app's environment.

## 5. Turn the knowledge base on in the web app (dev)

`KNOWLEDGE_ENABLED=true` (and `KNOWLEDGE_MIN_SIMILARITY` from step 4) in the dev web app's
environment, then redeploy. Off, every question goes to the records tools as before.

Prod later follows the same steps with `<prod-project-ref>` and a separate env file.
