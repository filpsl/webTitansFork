## 1. Migração SQL de endurecimento

- [ ] 1.1 Criar `supabase/migrations/0002_security_hardening.sql`.
- [ ] 1.2 Tornar `valor_centavos` nullable: `ALTER TABLE fila_impressao ALTER COLUMN valor_centavos DROP NOT NULL;` e ajustar o check para `CHECK (valor_centavos IS NULL OR valor_centavos > 0)`.
- [ ] 1.3 Recriar a policy `fila_impressao_anon_insert` adicionando `valor_centavos IS NULL` no `WITH CHECK`.
- [ ] 1.4 Aplicar restrições no bucket: `UPDATE storage.buckets SET file_size_limit = 31457280, allowed_mime_types = ARRAY['application/pdf'] WHERE id = 'pdfs-impressao';` (30 MB)
- [ ] 1.5 Habilitar extensões: `CREATE EXTENSION IF NOT EXISTS pg_cron;` e `CREATE EXTENSION IF NOT EXISTS pg_net;` (no schema apropriado, geralmente `extensions`).
- [ ] 1.6 Rodar a migração no SQL Editor do Supabase (produção) e confirmar sem erros.

## 2. Autoridade de preço e de páginas no servidor

- [ ] 2.1 Adicionar `pdf-lib` às dependências do `package.json`.
- [ ] 2.2 Em `api/payments/create-pix.ts`, baixar o PDF do Storage via `supabaseAdmin.storage.from('pdfs-impressao').download(pedido.pdf_path)`.
- [ ] 2.3 Contar páginas com `pdf-lib`: `(await PDFDocument.load(await blob.arrayBuffer())).getPageCount()`. Envolver em try/catch → se falhar (PDF inválido/criptografado), responder **422** sem cobrar.
- [ ] 2.4 Buscar os preços em `config_precos` via `supabaseAdmin`.
- [ ] 2.5 Calcular `valorCentavos = paginasReais * preco[pedido.modo_cor]` no servidor; **não** usar `num_paginas` nem `valor_centavos` vindos do cliente.
- [ ] 2.6 Cobrar `valorCentavos / 100` no MP (em vez de `pedido.valor_centavos`).
- [ ] 2.7 Persistir `num_paginas` (real) e `valor_centavos` na linha (junto com `mp_payment_id`).
- [ ] 2.8 Tratar caso `config_precos` não retornar o `modo_cor` esperado → 500 com log.

## 3. Frontend: parar de enviar preço, alinhar limite

- [ ] 3.1 Em `src/pages/Impressao.tsx`, remover `valor_centavos` do objeto do `insert` em `fila_impressao` (enviar só `pdf_path`, `num_paginas`, `modo_cor`).
- [ ] 3.2 Manter o cálculo client-side de páginas/valor apenas como **estimativa visual** na tela de configuração (deixar claro que a contagem e o valor finais são confirmados no servidor/PIX).
- [ ] 3.3 Após `create-pix`, exibir na tela de pagamento o `valor` que veio do servidor (já é o caso, mas confirmar que não usa o valor local).
- [ ] 3.4 Em `src/lib/pdf-utils.ts`, reduzir `MAX_PDF_BYTES` de 50 MB para **30 MB** (casar com o `file_size_limit` do bucket) e ajustar a mensagem de erro.

## 4. Edge Function de limpeza

- [ ] 4.1 Criar `supabase/functions/cleanup-fila/index.ts` (Deno) usando `@supabase/supabase-js` com `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] 4.2 Validar o header `Authorization: Bearer <CLEANUP_FUNCTION_SECRET>` (comparação em tempo constante); 401 se não bater.
- [ ] 4.3 Limpeza de órfãos: selecionar `AGUARDANDO_PAGAMENTO` com `created_at < now()-1h`, coletar `pdf_path`, `storage.remove([...])`, depois `delete` das linhas.
- [ ] 4.4 Limpeza de impressos: selecionar `IMPRESSO` com `printed_at < now()-7d` e `pdf_path not null`, `storage.remove([...])`, depois `update set pdf_path = null`.
- [ ] 4.5 Nunca tocar em `PAGO` não impresso (garantir pelos filtros).
- [ ] 4.6 Retornar um resumo JSON (`{ orfaos_removidos, pdfs_impressos_removidos }`) e logar.
- [ ] 4.7 Configurar a secret: `supabase secrets set CLEANUP_FUNCTION_SECRET=<valor-aleatorio-longo>`.
- [ ] 4.8 Deploy: `supabase functions deploy cleanup-fila`.

## 5. Agendamento via pg_cron

- [ ] 5.1 Criar SQL de agendamento (pode ir em `0002` ou num `0003_schedule_cleanup.sql`) usando `cron.schedule(...)` + `net.http_post(...)` apontando para a URL da Edge Function.
- [ ] 5.2 Passar o header `Authorization: Bearer <CLEANUP_FUNCTION_SECRET>` na chamada `http_post`.
- [ ] 5.3 Agendar de hora em hora: `'0 * * * *'`.
- [ ] 5.4 Conferir o job: `SELECT * FROM cron.job;` e, após uma hora, `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;`.

## 6. Atualizar documentação do contrato

- [ ] 6.1 Atualizar o README interno do change `add-web-to-print` (ou criar um neste change) anotando: preço agora é server-side; recomendação do script Python reconferir `num_paginas` na impressão; nova env `CLEANUP_FUNCTION_SECRET`.

## 7. Guia de testes de segurança/fraude (reproduzível)

### 7.1 Fraude de preço e de páginas
- [ ] 7.1.1 Com a anon key, tentar `insert` em `fila_impressao` com `valor_centavos = 1` → deve ser **rejeitado** pela RLS.
- [ ] 7.1.2 Criar um pedido normal (sem `valor_centavos`), chamar `create-pix`, e conferir no MP/Supabase que o valor cobrado = `páginas reais × preço`, não 1 centavo.
- [ ] 7.1.3 Tentar `update` da linha mudando `valor_centavos` com anon key → deve ser **negado**.
- [ ] 7.1.4 **Fraude de páginas:** criar um pedido com um PDF de várias páginas mas declarando `num_paginas=1`; chamar `create-pix` e conferir que ele cobra pela contagem **real** do arquivo, não por 1 página, e grava o `num_paginas` correto.
- [ ] 7.1.5 Subir um arquivo que não é PDF de verdade (renomeado) e chamar `create-pix` → deve responder **422** sem criar cobrança no MP.

### 7.2 RLS / acesso indevido
- [ ] 7.2.1 Com anon key, tentar `update ... set status='PAGO'` → negado.
- [ ] 7.2.2 Com anon key, tentar `delete` de uma linha → negado.
- [ ] 7.2.3 Confirmar que `select` por `id` conhecido funciona, mas não há como listar todas as linhas sem id.

### 7.3 Storage / upload
- [ ] 7.3.1 Tentar `upload` de um `.png` (content-type image/png) → rejeitado pelo bucket.
- [ ] 7.3.2 Tentar `upload` de um arquivo > 50 MB → rejeitado.
- [ ] 7.3.3 Tentar `storage.list()` com anon → vazio/403.
- [ ] 7.3.4 Tentar `GET` público de um objeto do bucket → negado (privado).

### 7.4 Webhook (regressão da change anterior)
- [ ] 7.4.1 `POST` no webhook sem `x-signature` → 401, banco intacto.
- [ ] 7.4.2 `POST` com assinatura inválida → 401.
- [ ] 7.4.3 Reentrega de um pagamento já `IMPRESSO` → 200, status permanece `IMPRESSO` (idempotência).

### 7.5 Limpeza / retenção
- [ ] 7.5.1 Criar um pedido `AGUARDANDO_PAGAMENTO`, forçar `created_at` para 2h atrás, invocar a função → linha e PDF removidos.
- [ ] 7.5.2 Criar um pedido `PAGO` não impresso com data antiga, invocar a função → **preservado**.
- [ ] 7.5.3 Criar um pedido `IMPRESSO` com `printed_at` de 8 dias atrás, invocar a função → PDF removido, linha mantida com `pdf_path` null.
- [ ] 7.5.4 Invocar a URL da função **sem** o `CLEANUP_FUNCTION_SECRET` → 401, nada apagado.

### 7.6 Fraude de páginas (risco residual conhecido)
- [ ] 7.6.1 Documentar/abrir issue no repo do script Python: reconferir contagem de páginas do PDF na impressão e marcar `ERRO` se divergir de `num_paginas`.

## 8. Deploy e validação

- [ ] 8.1 Rodar a migração `0002` em produção (Supabase).
- [ ] 8.2 Deploy da Edge Function + secret + agendamento pg_cron.
- [ ] 8.3 Abrir PR com as mudanças de `create-pix.ts` e `Impressao.tsx`; mergear para `main`.
- [ ] 8.4 Executar o guia de testes da seção 7 contra produção (ou preview com credenciais de produção).
- [ ] 8.5 Após 1–2 horas, conferir `cron.job_run_details` e o nível de uso do Storage no painel do Supabase.
