## Why

A primeira versão do Web-to-Print (change `add-web-to-print`) está em produção e validada, mas foi construída priorizando o caminho feliz. Três problemas de segurança/operação ficaram em aberto:

1. **Fraude de preço e de contagem (crítico):** tanto o `valor_centavos` quanto o `num_paginas` são calculados no cliente e inseridos em `fila_impressao` via anon key. Um usuário malicioso pode (a) inserir `valor_centavos: 1` para um documento grande, ou (b) declarar `num_paginas: 1` para um PDF de 500 páginas. O `create-pix` cobra com base nesses valores — não há nenhuma autoridade no servidor sobre preço **nem** sobre quantidade de páginas.
2. **Acúmulo sem limite (operacional):** PDFs ficam para sempre no Supabase Storage e a tabela `fila_impressao` cresce indefinidamente. Pedidos `AGUARDANDO_PAGAMENTO` que nunca são pagos viram lixo permanente; PDFs já impressos nunca são removidos. No plano gratuito do Supabase isso esgota a cota de Storage.
3. **Abuso de upload (segurança):** qualquer pessoa com a anon key (que é pública, vai no bundle) pode subir PDFs ilimitados ao bucket `pdfs-impressao` sem nunca pagar, e nada valida tipo/tamanho do arquivo no nível do bucket.

Precisamos endurecer esses pontos antes de divulgar o serviço amplamente, além de documentar um roteiro de testes de segurança/fraude reproduzível.

## What Changes

- **Autoridade de preço e de páginas no servidor:** o `create-pix` passa a **baixar o PDF** do Storage (service_role), **contar as páginas** com `pdf-lib` (contagem é leve — só lê a árvore de páginas, não renderiza) e **recalcular** `valor_centavos = paginasReais × config_precos[modo_cor]`. Ignora completamente o `num_paginas` e o `valor_centavos` enviados pelo cliente. O cliente deixa de inserir `valor_centavos` (preenchido só pelo servidor); RLS de INSERT exige `valor_centavos IS NULL`. PDFs inválidos/criptografados (que o `pdf-lib` não consegue abrir) fazem o pedido ser rejeitado sem cobrança.
- **Limpeza automática (retenção):** uma Supabase Edge Function de limpeza, agendada via `pg_cron` (de hora em hora), que:
  - Apaga linha + PDF de pedidos `AGUARDANDO_PAGAMENTO` com mais de **1 hora**.
  - Apaga o PDF (mantém a linha como histórico, anula `pdf_path`) de pedidos `IMPRESSO` com `printed_at` há mais de **7 dias**.
  - **Nunca** apaga pedidos `PAGO` ainda não impressos.
- **Proteção contra abuso de upload:** o bucket `pdfs-impressao` passa a ter `file_size_limit` (30 MB) e `allowed_mime_types: ['application/pdf']` no nível do bucket; a limpeza de 1h limita a persistência de uploads órfãos. O teto cai de 50 MB para 30 MB para garantir que o `create-pix` consiga baixar e contar as páginas dentro do limite de 10s da Vercel.
- **Endurecimento de RLS:** revisão das policies para garantir que `anon` não consiga definir `valor_centavos`, nem fazer UPDATE/DELETE, nem ler linhas além do próprio `id`.
- **Guia de testes de segurança/fraude:** roteiro reproduzível (no `tasks.md`) cobrindo fraude de preço, RLS, Storage, webhook e limpeza.

## Capabilities

### New Capabilities

- `print-payment-integrity`: Garante que tanto a contagem de páginas quanto o valor cobrado sejam sempre determinados pelo servidor (lendo o PDF e os preços oficiais), nunca pelo cliente.
- `print-data-retention`: Limpeza periódica automática de pedidos não pagos antigos e de PDFs já impressos, mantendo Storage e tabela enxutos.
- `print-upload-abuse-protection`: Restrições de bucket (tipo/tamanho) e RLS que limitam upload abusivo via anon key.

### Modified Capabilities

<!-- As specs de `add-web-to-print` ainda não foram arquivadas para `openspec/specs/`,
então não há baseline para deltas MODIFIED. As novas regras são expressas como
ADDED nas capabilities acima; o comportamento de "cliente define o preço" da change
anterior é explicitamente substituído pela capability `print-payment-integrity`. -->

## Impact

- **Banco / Storage (migração nova):**
  - `valor_centavos` passa a ser nullable (check `IS NULL OR > 0`), preenchido pelo servidor.
  - Policy `fila_impressao_anon_insert` ajustada para exigir `valor_centavos IS NULL`.
  - Revisão das demais policies (SELECT por id, sem UPDATE/DELETE anon).
  - Bucket `pdfs-impressao` recebe `file_size_limit` e `allowed_mime_types`.
  - Extensões `pg_cron` e `pg_net` habilitadas; job agendado.
- **Edge Function nova:** `supabase/functions/cleanup-fila/` (Deno) usando service_role, protegida por segredo compartilhado.
- **Backend:** `api/payments/create-pix.ts` baixa o PDF do Storage, conta páginas com `pdf-lib`, recalcula o preço a partir de `config_precos` e grava `num_paginas` e `valor_centavos` autoritativos antes de cobrar.
- **Frontend:** `src/pages/Impressao.tsx` deixa de enviar `valor_centavos` no insert; tanto o número de páginas quanto o valor exibidos na tela de configuração passam a ser **estimativas client-side**, com a contagem e a cobrança reais vindas do servidor. O teto de tamanho no cliente (`pdf-utils.MAX_PDF_BYTES`) cai para 30 MB para casar com o bucket.
- **Dependência nova:** `pdf-lib` na função serverless (`api/`), para contar páginas no servidor.
- **Risco residual:** PDFs adversariais malformados poderiam, em tese, enganar a contagem do `pdf-lib`, mas contra a fraude comum (subdeclarar páginas) a contagem server-side fecha a porta. Recomenda-se que o script Python ainda confira a contagem na impressão como defesa em profundidade.
- **Segredos novos:** `CLEANUP_FUNCTION_SECRET` (compartilhado entre o pg_cron e a Edge Function).
