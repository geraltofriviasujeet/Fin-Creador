# Roma's knowledge base documents

One Markdown file per document, `<slug>.md`, loaded into `knowledge_documents` and
`knowledge_chunks` by `scripts/ingest-knowledge.ts`. Rules: `docs/sprint-plan.md`, Sprint 10,
"10.6 knowledge base: scope and handoff", and the decisions of 2026-11-10.

## File format

A frontmatter block of flat `key: value` lines, then the text (Markdown; `##` headings help
retrieval because a heading stays with the paragraph after it).

```text
---
slug: what-is-an-sip                # the file name without .md
title: What is an SIP?
kind: own                           # official | own
publisher: FinCreador               # own: always FinCreador; official: the publisher
source_url:                         # official only: the page the text was taken from
based_on_publisher: <publisher>     # own only
read_more_url: https://...          # own only: the official page, shown as "read more"
link_permission_pending: false      # own only: true (and no read_more_url) while the publisher's
                                    # permission to link is pending
reuse_terms: <what the publisher's terms say, and for own why the text could not be reused>
reuse_terms_url: https://...
reuse_terms_checked_on: 2026-11-13
published_on: 2026-11-13            # the page's date (official) or when we wrote it (own)
verified_on: 2026-11-13             # last checked against the source
financial_year: 2026-27             # only when figures depend on the year
status: draft                       # draft | approved | retired; the owner sets approved
---
```

`official` documents carry the publisher's text unchanged, only where their terms permit reuse.
Everything else is an `own` explainer in our words. The script refuses a file that breaks the
attribution rule or any other column rule, before writing anything.

## Ingesting (owner only)

Step by step, with what each command prints: `docs/knowledge-runbook.md`.

1. Deploy the embed function once per project: `supabase functions deploy embed`.
2. Keep an env file outside the repository with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   (the key the project gives its Edge Functions).
3. `npm run knowledge:ingest -- --check` reads and chunks the files without any network.
4. `KNOWLEDGE_ENV_FILE=~/<private>/dev.env npm run knowledge:ingest`.

Only new or changed files (by SHA-256) are re-embedded; a file removed from this folder is
retired, not deleted. Approve a document by setting `status: approved` after review and running
the script again. Node 22.18 or later (runs TypeScript directly).
