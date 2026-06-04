## 1. Banco: coluna quantidade_copias + RLS

- [x] 1.1 Criar `supabase/migrations/0007_quantidade_copias.sql` com `alter table public.fila_impressao add column quantidade_copias int not null default 1 check (quantidade_copias >= 1);` e comentário explicando o default 1 (retrocompatibilidade).
- [x] 1.2 Na mesma migration, recriar a policy `fila_impressao_anon_insert` (`drop policy if exists` + `create policy`) incluindo `quantidade_copias >= 1` no `with check`, preservando as condições existentes (`status='AGUARDANDO_PAGAMENTO'`, `mp_payment_id is null`, `paid_at is null`, `printed_at is null`).
- [x] 1.3 (produção) Rodar a `0007` no SQL Editor e confirmar com `\d fila_impressao` que a coluna existe com default 1 e check `>= 1`.

## 2. Tipos e cálculo de preço (frontend)

- [x] 2.1 Em `src/lib/types.ts`, adicionar `quantidade_copias: number` ao tipo `Pedido`.
- [x] 2.2 Em `src/lib/pricing.ts`, alterar `calcularValor` para `calcularValor(numPaginas, quantidadeCopias, modo, precos)` retornando `numPaginas * quantidadeCopias * precos[modo]`.

## 3. UI de checkout (ConfiguracaoImpressao)

- [x] 3.1 Em `src/components/impressao/ConfiguracaoImpressao.tsx`, adicionar estado controlado `quantidadeCopias` (default 1) e um campo `Input type="number" min={1}` com label "Quantidade de cópias".
- [x] 3.2 Normalizar a entrada no `onChange`: valores `< 1`, vazios ou não inteiros viram `1`.
- [x] 3.3 Calcular o total via `calcularValor(numPaginas, quantidadeCopias, MODO_COR, precos)` e exibir o valor recalculado ao mudar a quantidade.
- [x] 3.4 Propagar `quantidadeCopias` no `onConfirmar` (incluir `quantidadeCopias` nos args).

## 4. Criação do pedido (Impressao.tsx)

- [x] 4.1 Em `src/pages/Impressao.tsx`, receber `quantidadeCopias` em `confirmarConfiguracao` e incluir `quantidade_copias` no `insert` de `fila_impressao`.
- [x] 4.2 Guardar a quantidade no estado da página para exibição na tela de pagamento, se necessário, mantendo o valor autoritativo vindo do servidor.

## 5. Autoridade de preço no servidor (create-pix)

- [x] 5.1 Em `api/payments/create-pix.ts`, incluir `quantidade_copias` no `select` da linha do pedido.
- [x] 5.2 Calcular `valorCentavos = paginasReais * quantidadeCopias * preco.valor_centavos_por_pagina`, lendo a quantidade da linha (não do request) e tratando ausência/`< 1` com fallback 1.
- [x] 5.3 Ajustar a `description` do pagamento para mencionar a quantidade de cópias (ex.: "Impressão TITANS — 10 págs x 2 cópias PB").

## 6. Impressão de N cópias (worker)

- [x] 6.1 Em `print-worker/worker.py`, ler `quantidade_copias` do pedido em `processar` (fallback 1 quando ausente/None) e validar `>= 1`.
- [x] 6.2 Imprimir N cópias. (A 135w ignora `lp -n`/`-o copies`, então a versão final replica as páginas no próprio PDF via `replicar_pdf` e envia um único job, em vez de depender da opção de cópias do CUPS.)
- [x] 6.3 Atualizar o log de envio ao CUPS para registrar a quantidade de cópias.

## 7. Validação e deploy

- [x] 7.1 `npm run build` sem erros (tipos de `calcularValor`/`Pedido` consistentes).
- [x] 7.2 Testar no site: definir 2 cópias num PDF de N páginas, conferir total exibido = `N * 2 * preço` e que o valor do PIX bate com o exibido.
- [x] 7.3 Conferir na `fila_impressao` que `quantidade_copias` foi gravado e que `valor_centavos` (autoritativo do servidor) reflete o multiplicador.
- [x] 7.4 Atualizar o `print-worker` na máquina da sede e validar com um pedido de 2+ cópias que a impressora produz a quantidade correta.
