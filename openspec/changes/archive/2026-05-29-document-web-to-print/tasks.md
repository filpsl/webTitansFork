## 1. Preparação

- [x] 1.1 Criar o diretório `docs/web-to-print/`.
- [x] 1.2 Levantar as fontes: ler as propostas/designs arquivados, as 4 specs em
  `openspec/specs/` e mapear os arquivos de código de cada subsistema.

## 2. Índice e visão geral (`README.md`)

- [x] 2.1 Escrever a visão geral de uma página: o que a feature faz, para quem, e os 4
  subsistemas.
- [x] 2.2 Incluir o diagrama de componentes (navegador → Vercel → sede → Supabase) em
  ASCII.
- [x] 2.3 Montar o índice com links para todos os documentos `01`–`08`.

## 3. Arquitetura (`01-arquitetura.md`)

- [x] 3.1 Descrever os quatro componentes e suas responsabilidades.
- [x] 3.2 Descrever as três fronteiras de execução (navegador, Vercel, sede) e o que roda
  em cada uma.
- [x] 3.3 Explicar por que o PDF nunca passa pela Vercel (limites do plano gratuito) e por
  que a contagem é feita no cliente.
- [x] 3.4 Mapear quais segredos vivem em cada fronteira (anon vs service_role vs MP).

## 4. Fluxo do pedido e máquina de estados (`02-fluxo-pedido.md`)

- [x] 4.1 Narrar o caminho feliz de ponta a ponta (upload → pagamento → fila → impressão →
  sucesso).
- [x] 4.2 Incluir o diagrama da máquina de estados de `status` em ASCII.
- [x] 4.3 Documentar cada transição e quem a escreve (cliente, webhook, worker), incluindo
  claim atômico e recuperação de travados.
- [x] 4.4 Documentar os caminhos de exceção: `CANCELADO`, `ERRO`, timeout de pagamento.

## 5. Checkout — frontend (`03-checkout.md`)

- [x] 5.1 Responsabilidade e os arquivos (`src/pages/Impressao.tsx`,
  `src/components/impressao/*`, `src/lib/{supabase,pricing,pdf-utils}.ts`,
  `src/hooks/usePedidoStatus.ts`).
- [x] 5.2 Documentar as 4 etapas da UI (upload, configuração, pagamento, sucesso) e a
  validação de PDF (tipo, 50 MB).
- [x] 5.3 Explicar a contagem de páginas via `pdfjs-dist` e o cálculo de preço a partir de
  `config_precos`.
- [x] 5.4 Explicar o upload direto ao Storage e o acompanhamento de status (Realtime +
  polling de 5s) até a tela de sucesso.
- [x] 5.5 Linkar para a spec `web-to-print-checkout`.

## 6. Pagamento PIX — Serverless Functions (`04-pagamento-pix.md`)

- [x] 6.1 Responsabilidade e os arquivos (`api/payments/create-pix.ts`,
  `api/webhooks/mercadopago.ts`, `api/_lib/*`).
- [x] 6.2 Documentar `create-pix`: entrada/saída, idempotência via `X-Idempotency-Key`.
- [x] 6.3 Documentar o webhook: validação de assinatura HMAC (`x-signature`), janela
  anti-replay, idempotência do `UPDATE` e política de status HTTP (200 vs 401 vs 500).
- [x] 6.4 Explicar a transição para `PAGO`/`CANCELADO` via `service_role`.
- [x] 6.5 Linkar para a spec `mercadopago-pix-integration`.

## 7. Armazenamento Supabase (`05-supabase.md`)

- [x] 7.1 Documentar a tabela `fila_impressao` (campos, constraints de status) referenciando
  `supabase/migrations/0001_fila_impressao.sql` e `0004_print_worker.sql`.
- [x] 7.2 Documentar `config_precos` (preço por modo de cor, edição sem deploy).
- [x] 7.3 Documentar o bucket privado `pdfs-impressao` e suas policies.
- [x] 7.4 Documentar as políticas RLS (INSERT anônimo restrito, SELECT por id, bloqueio de
  UPDATE/DELETE anônimo) e o índice em `status`.
- [x] 7.5 Linkar para a spec `print-queue-storage`.

## 8. Print worker (`06-print-worker.md`)

- [x] 8.1 Responsabilidade e os arquivos (`print-worker/worker.py`, `requirements.txt`,
  `print-worker.service`, `README.md`).
- [x] 8.2 Documentar o loop: polling FIFO por `paid_at`, claim atômico (`PAGO →
  IMPRIMINDO`), recuperação de travados.
- [x] 8.3 Documentar download via `service_role`, reconferência de páginas com `pypdf`
  (defesa de fraude) e impressão via CUPS (`lp`).
- [x] 8.4 Documentar a conclusão (`IMPRESSO`/`printed_at`) e os caminhos de `ERRO`.
- [x] 8.5 Linkar para a spec `print-worker`.

## 9. Operação — runbook (`07-operacao.md`)

- [x] 9.1 Instalar o worker na sede (CUPS/HPLIP, venv, `.env` 0600, systemd) resumindo o
  `print-worker/README.md`.
- [x] 9.2 Atualizar o worker após uma correção (cópia/pull + restart do serviço).
- [x] 9.3 Diagnosticar pedidos em `ERRO`: onde ver logs (`journalctl`), causas comuns.
- [x] 9.4 Recolocar pedido na fila ou marcar como `IMPRESSO` via SQL, conforme o caso.
- [x] 9.5 Monitoramento: o que observar no dia a dia.

## 10. Segurança (`08-seguranca.md`)

- [x] 10.1 Mapear segredos por ambiente e onde a `service_role` é usada (Vercel + sede,
  nunca no cliente).
- [x] 10.2 Documentar a validação de assinatura do webhook e a janela anti-replay.
- [x] 10.3 Documentar as garantias de RLS e os cuidados com o `.env` da sede (0600, usuário
  de serviço dedicado, rotação se vazar).

## 11. Fechamento

- [x] 11.1 Revisar todos os links internos e caminhos de arquivo citados.
- [x] 11.2 Conferir consistência com as specs (sem duplicação de requisitos).
- [x] 11.3 Arquivar a mudança via `/opsx:archive document-web-to-print` e commitar a
  documentação.
