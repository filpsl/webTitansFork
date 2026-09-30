-- Complementos a `pedidos_3d` que o Prisma não expressa no schema: CHECK de
-- completude por tipo, RLS (sem policy — só a conexão do Prisma, dona da
-- tabela, escreve; o Data API do Supabase ficaria bloqueado por padrão) e o
-- bucket de Storage `arquivos-3d` (schema `storage`, fora do datamodel do
-- Prisma) com a policy que permite o navegador subir arquivo direto.

-- =====================================================================
-- 1. CHECK de completude por tipo
-- =====================================================================
ALTER TABLE "pedidos_3d"
  ADD CONSTRAINT "pedidos_3d_arquivos_completo" CHECK (
    "tipo" <> 'ARQUIVOS'
    OR (array_length("modelos_paths", 1) >= 1 AND array_length("fotos_paths", 1) >= 1)
  );

ALTER TABLE "pedidos_3d"
  ADD CONSTRAINT "pedidos_3d_modelagem_completo" CHECK (
    "tipo" <> 'MODELAGEM' OR "descricao" IS NOT NULL
  );

-- =====================================================================
-- 2. RLS — sem policy para anon/authenticated (mesmo padrão de
--    chamados_ajuda/reimpressao_tokens no outro projeto Supabase): só a role
--    dona da tabela (a conexão do Prisma via DATABASE_URL) lê/escreve.
-- =====================================================================
ALTER TABLE "pedidos_3d" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 3. Storage bucket privado + policy
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('arquivos-3d', 'arquivos-3d', false, 52428800) -- 50 MB
ON CONFLICT (id) DO NOTHING;

-- anon pode subir arquivos (INSERT) direto do navegador. SELECT/UPDATE/DELETE
-- negados — ninguém além do dono do bucket lê de volta por enquanto.
CREATE POLICY arquivos_3d_anon_insert
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'arquivos-3d');
