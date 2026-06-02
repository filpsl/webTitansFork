## Context

O Web-to-Print (change `add-web-to-print`) está em produção: SPA Vite/React + funções serverless na Vercel + Supabase (Postgres + Storage + Realtime) + Mercado Pago (PIX). Checkout é anônimo (sem login), usando a anon key do Supabase com RLS.

Fluxo atual de criação de pedido:
1. Cliente conta páginas localmente (`pdfjs-dist`), escolhe cor, calcula preço.
2. Cliente faz `upload` do PDF para o bucket `pdfs-impressao` com a anon key.
3. Cliente faz `insert` em `fila_impressao` com `{ pdf_path, num_paginas, modo_cor, valor_centavos }` — **tudo client-side**, inclusive o preço.
4. Cliente chama `POST /api/payments/create-pix`, que lê `valor_centavos` da linha e cobra esse valor no MP.

Problemas que motivam esta mudança (ver `proposal.md`): preço definido pelo cliente, acúmulo ilimitado de PDFs/linhas, e upload irrestrito via anon key.

Restrições: planos **gratuitos** de Vercel e Supabase. Supabase free suporta `pg_cron`, `pg_net` e Edge Functions (Deno). Vercel Hobby tem cron limitado a 1x/dia — por isso a limpeza fica no Supabase, que permite agendamento horário.

## Goals / Non-Goals

**Goals:**
- Tanto a **contagem de páginas** quanto o **valor cobrado** são **sempre** determinados pelo servidor (lendo o PDF do Storage e os preços de `config_precos`); o cliente não consegue influenciar nenhum dos dois.
- Storage e tabela permanecem enxutos via limpeza automática, sem ação manual: não-pago apagado em **1h**, PDF de impresso removido em **7 dias**, e a linha de impresso apagada de vez em **6 meses**.
- O bucket rejeita uploads que não sejam PDF ou acima de 30 MB.
- RLS auditada: `anon` não define preço, não faz UPDATE/DELETE, não lê linhas alheias.
- Roteiro de testes de fraude/segurança reproduzível.

**Non-Goals:**
- Autenticação/contas de usuário.
- Rate limiting robusto por IP (inviável de forma stateful e barata em serverless free); mitigamos abuso via limites de bucket + limpeza agressiva.
- Migração de provedor de pagamento ou de hospedagem.

## Decisions

### D1. Autoridade de preço **e** de páginas no `create-pix`

O cliente passa a inserir o pedido **sem** `valor_centavos` (campo nullable, default null). O `num_paginas` que o cliente insere vira mera estimativa. O `create-pix` é a autoridade:
1. Lê `pdf_path` e `modo_cor` da linha.
2. **Baixa o PDF** do Storage com a service_role (`storage.from('pdfs-impressao').download(pdf_path)`).
3. **Conta as páginas** com `pdf-lib` (`(await PDFDocument.load(bytes)).getPageCount()`).
4. Busca os preços vigentes em `config_precos`.
5. Calcula `valor = paginasReais * config_precos[modo_cor]`.
6. Grava `num_paginas` (real) e `valor_centavos` na linha **e** cobra exatamente esse valor no MP.

Contar páginas ≠ renderizar: o `pdf-lib` só parseia a árvore de páginas (`/Count`), o que é da ordem de milissegundos mesmo para centenas de páginas. O custo real é o **download** do arquivo (ver D2). A RLS de INSERT exige `valor_centavos IS NULL`, e o `num_paginas` declarado nunca é usado para cobrança. Assim o cliente não influencia nem preço nem quantidade.

**Alternativa descartada — criar o pedido inteiro no servidor (`POST /api/orders`):** anon nem inseriria linha, mais robusto contra abuso de insert, mas reescreve mais o fluxo. Fica como evolução futura. O recompute+contagem no `create-pix` fecha a fraude financeira com alteração focada.

### D2. Viabilidade de baixar e parsear o PDF dentro dos 10s da Vercel

O `create-pix` roda no plano Hobby (10s, ~1024 MB). O gargalo é o download do PDF do Storage:
- Download Supabase→Vercel (regiões próximas): ~0,5–3s para arquivos de até algumas dezenas de MB.
- `pdf-lib` load + `getPageCount`: < 1s mesmo para 500 páginas; memória ~2–4× o tamanho do arquivo, confortável dentro de 1 GB para 30 MB.

**Decisão:** baixar o teto de upload de 50 MB → **30 MB** (no bucket e no cliente) para dar margem segura. Se um PDF não abrir no `pdf-lib` (corrompido/criptografado), o `create-pix` responde 422 e **não cobra** — melhor recusar do que cobrar errado.

**Defesa em profundidade (recomendado, fora do repo):** o script Python que imprime já abre o PDF — recomenda-se que também confira a contagem e marque `ERRO` se divergir, cobrindo PDFs adversariais que enganem o `pdf-lib`.

### D3. Limpeza via Edge Function + pg_cron (não Vercel Cron)

Uma Edge Function Deno `cleanup-fila` concentra a lógica (em TypeScript, com service_role). São **três regras**, uma retenção em dois estágios para os impressos:
- **Órfãos:** `SELECT` de `fila_impressao` onde `status='AGUARDANDO_PAGAMENTO' AND created_at < now() - interval '1 hour'` → remove os PDFs (`storage.remove([pdf_path...])`) → `DELETE` das linhas.
- **Impressos — estágio 1 (PDF aos 7 dias):** `status='IMPRESSO' AND printed_at < now() - interval '7 days' AND pdf_path IS NOT NULL` → remove os PDFs → `UPDATE` setando `pdf_path = NULL` (mantém a linha como histórico, sem o arquivo pesado).
- **Impressos — estágio 2 (linha aos 6 meses):** `status='IMPRESSO' AND printed_at < now() - interval '6 months'` → `DELETE` das linhas. Nesse ponto o `pdf_path` já é nulo (removido no estágio 1), então só resta apagar o registro. Decisão de retenção/LGPD: o histórico do pedido (protocolo, data, valor) não precisa viver para sempre.
- **Nunca** toca em `PAGO` não impresso.

Agendamento: `pg_cron` roda de **hora em hora** (`0 * * * *`) e dispara a função via `pg_net.http_post` para a URL da Edge Function, com header `Authorization: Bearer <CLEANUP_FUNCTION_SECRET>`. A função valida esse segredo e rejeita 401 se não bater.

**Por que Edge Function e não só SQL no pg_cron?** Deletar objetos do Storage não é SQL — precisa da API de Storage. A Edge Function faz DB + Storage num só lugar, com service_role. **Por que horário e não diário?** A retenção de 1h só faz sentido com varredura frequente; pg_cron permite horário no plano free (Vercel Hobby não).

**Alternativa descartada — pg_cron puro deletando só linhas:** deixaria os arquivos órfãos no Storage (o problema principal do usuário). Rejeitado.

### D4. Restrições no nível do bucket

Em vez de validar só no cliente (burlável), o bucket `pdfs-impressao` recebe na própria configuração:
- `file_size_limit = 31457280` (30 MB) — alinhado ao teto que o `create-pix` consegue baixar e parsear (D2)
- `allowed_mime_types = ['application/pdf']`

Assim, mesmo uma chamada direta à API de Storage com a anon key rejeita arquivos não-PDF ou grandes. O teto de 30 MB também é replicado no cliente (`pdf-utils.MAX_PDF_BYTES`). Combinado com a limpeza de 1h, limita o dano de upload abusivo.

### D5. Auditoria de RLS

Revisão explícita (com testes) das policies de `fila_impressao`:
- INSERT (anon): `WITH CHECK (status='AGUARDANDO_PAGAMENTO' AND valor_centavos IS NULL AND mp_payment_id IS NULL AND paid_at IS NULL AND printed_at IS NULL)`.
- SELECT (anon): mantém leitura por `id` (UUID opaco). Risco de enumeração é baixo (UUID v4), aceito.
- UPDATE/DELETE (anon): **sem policy** = negado. Confirmado por teste.
- `config_precos`: SELECT anon liberado (preços públicos); sem INSERT/UPDATE/DELETE anon.

### D6. Segredo da função de limpeza

`CLEANUP_FUNCTION_SECRET` é um valor aleatório longo, guardado: (a) como secret da Edge Function no Supabase, e (b) referenciado no comando `pg_net.http_post` do job pg_cron. Sem ele, qualquer um que descubra a URL da função poderia disparar limpezas. Validação em tempo constante na função.

## Risks / Trade-offs

- **[Janela de 1h apaga pedido sendo pago no limite]** → Se alguém gera o PIX e paga no minuto 59, o webhook precisa marcar `PAGO` antes da varredura. **Mitigação:** o webhook é quase instantâneo; a varredura só apaga `AGUARDANDO_PAGAMENTO` (se já virou `PAGO`, é preservado). Risco real mínimo; se preocupar, aumentar para 2h.
- **[num_paginas subdeclarado]** → **fechado** pela contagem server-side no `create-pix` (D1): o número declarado pelo cliente nunca é usado para cobrança. Risco residual só com PDFs adversariais que enganem o `pdf-lib`; mitigado em profundidade pela conferência no script Python (D2).
- **[Download do PDF estoura 10s para arquivos grandes]** → **Mitigação:** teto reduzido para 30 MB (D2/D4); PDFs que falhem ao abrir são rejeitados (422) sem cobrança. Latência extra de ~0,5–3s no clique "Pagar", aceitável.
- **[Edge Function exposta publicamente]** → URL pública poderia ser abusada para forçar limpezas. **Mitigação:** segredo compartilhado obrigatório (D6); a função não recebe parâmetros do chamador que alterem o escopo da limpeza.
- **[pg_net/pg_cron indisponíveis no projeto]** → se o projeto Supabase não tiver as extensões, o agendamento falha. **Mitigação:** habilitar via SQL na migração; se bloqueado, fallback documentado para Vercel Cron diário (pior granularidade).
- **[Recompute de preço quebra pedidos legados]** → linhas antigas têm `valor_centavos` preenchido pelo cliente. **Mitigação:** o recompute roda no `create-pix` de novos pedidos; pedidos já pagos não são afetados. Migração torna a coluna nullable sem apagar dados.
- **[allowed_mime_types depende do MIME informado no upload]** → cliente pode mentir o content-type. **Mitigação:** o `create-pix` tenta abrir o arquivo com `pdf-lib`; se não for um PDF de verdade, falha e rejeita (422). O `file_size_limit` também vale. Risco residual baixo.

## Migration Plan

Aplicar em produção (Supabase) na ordem:

1. Migração SQL `0002_security_hardening.sql`:
   - `ALTER TABLE fila_impressao ALTER COLUMN valor_centavos DROP NOT NULL;` + ajustar check para `valor_centavos IS NULL OR valor_centavos > 0`.
   - Recriar policy `fila_impressao_anon_insert` com `valor_centavos IS NULL`.
   - `UPDATE storage.buckets SET file_size_limit=31457280, allowed_mime_types=ARRAY['application/pdf'] WHERE id='pdfs-impressao';`
   - `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;`
2. Deploy da Edge Function `cleanup-fila` (`supabase functions deploy cleanup-fila`), com secret `CLEANUP_FUNCTION_SECRET` configurada.
3. Agendar o job pg_cron apontando para a URL da função com o secret.
4. Deploy do `create-pix` atualizado (via merge/PR na Vercel) com download+contagem de páginas (`pdf-lib`) e recompute de preço; e do `Impressao.tsx` sem `valor_centavos` e com teto de 30 MB.
5. Validar com o roteiro de testes do `tasks.md`.

**Rollback:** reverter o commit do `create-pix` (volta a cobrar `valor_centavos` da linha — mas como agora é null no insert, seria necessário também reverter a RLS; portanto fazer rollback do par migração+código junto). A Edge Function e o job pg_cron podem ser desabilitados isoladamente (`cron.unschedule`) sem afetar o checkout.

## Resolved Questions

Decididas em 2026-06-01:

- **Janela de não-pago:** mantida em **1h**. O PIX expira bem antes e o webhook marca `PAGO` quase instantaneamente, então o risco de apagar algo em pagamento é mínimo.
- **Reconferência de páginas no worker:** **já implementada** — o `print-worker` atual (`contar_paginas` via `pypdf` + verificação anti-fraude) já marca `ERRO` se a contagem real divergir de `num_paginas`. A defesa em profundidade contra PDFs adversariais já existe; nada a abrir.
- **Teto de tamanho:** **30 MB**, no bucket e no cliente. Dá margem segura para download+parse caberem nos 10s da Vercel. Se aparecerem PDFs maiores, medir o tempo real antes de subir.
- **Retenção de `IMPRESSO`:** retenção em **dois estágios** — PDF removido aos **7 dias**, linha apagada aos **6 meses** (ver D3). Mais conservador para LGPD do que manter o histórico indefinidamente.
