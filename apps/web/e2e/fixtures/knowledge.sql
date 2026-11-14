-- E2E only: one fictional knowledge base document for the throwaway local Supabase in CI (never
-- a hosted project). Loaded by .github/workflows/ci.yml after `supabase start`. Its passage lies
-- on axis 0, where the mock embedder (apps/web/lib/ai/knowledge/embedder.ts) puts every
-- question except ones about crypto, which find nothing. The text is a test passage, not one
-- of the real documents.
\set ON_ERROR_STOP on

with doc as (
  insert into public.knowledge_documents
    (slug, title, content_kind, publisher, based_on_publisher, read_more_url, reuse_terms,
     reuse_terms_checked_on, published_on, verified_on, financial_year, status, approved_at, content_hash)
  values
    ('e2e-test-emergency-fund', 'Test explainer: emergency funds', 'own', 'FinCreador', 'Test Publisher', 'https://example.com/test-read-more',
     'Test document for the CI database only.', '2026-11-14', '2026-11-14', '2026-11-14', '2025-26', 'approved', now(), repeat('a', 64))
  returning id
)
insert into public.knowledge_chunks (document_id, seq, content, embedding)
select doc.id, 1,
       'Test passage: an emergency fund commonly covers three to six months of essential spending, such as ₹40,000 a month.',
       ('[1' || repeat(',0', 383) || ']')::extensions.vector
  from doc;
