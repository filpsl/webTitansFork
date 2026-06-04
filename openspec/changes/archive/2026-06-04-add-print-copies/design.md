## Context

O web-to-print já está em produção com um fluxo fechado: o cliente sobe o PDF, o navegador conta as páginas (pdfjs-dist), o front insere um pedido em `fila_impressao` (anon key, RLS restrita), e `api/payments/create-pix.ts` é a **autoridade de preço** — ele rebaixa o PDF, reconta as páginas com `pdf-lib` e calcula `valor_centavos = num_paginas_reais * config_precos[modo].valor_centavos_por_pagina`. O `print-worker/worker.py` consome pedidos `PAGO`, reconfere as páginas e imprime com `lp -d <printer> -n 1`.

Hoje a quantidade de cópias é implicitamente **1** em três pontos independentes: o cálculo de preço (`create-pix` e `pricing.calcularValor`), a UI (`ConfiguracaoImpressao`) e a impressão (`worker.py`, `-n 1`). Esta mudança introduz `quantidade_copias` como um dado de primeira classe que atravessa todos esses pontos sem quebrar pedidos legados.

## Goals / Non-Goals

**Goals:**
- Permitir ao usuário escolher a quantidade de cópias no checkout.
- O PIX cobrar exatamente `num_paginas × quantidade_copias × valor_por_pagina`, com o servidor como autoridade.
- O worker imprimir de fato a quantidade paga.
- Zero impacto em pedidos já existentes (default 1).

**Non-Goals:**
- Suporte a configurações por cópia diferentes (frente-e-verso, agrupamento, intervalos de páginas) — fora de escopo.
- Reabrir COLORIDO no checkout (a 135w segue mono; o multiplicador funciona igual para qualquer modo).
- Limite máximo de cópias por política de negócio — adotamos apenas o piso (>= 1); um teto pode vir em iteração futura se houver abuso.

## Decisions

**1. Coluna `quantidade_copias int not null default 1 check (>= 1)` na `fila_impressao`.**
Default 1 torna a migração retrocompatível: pedidos legados e qualquer INSERT que não informe o campo continuam valendo 1 cópia. O check garante o piso no banco, independentemente de validação no front. Alternativa descartada: campo nullable tratado como 1 no código — rejeitada porque espalharia o fallback por front, `create-pix` e worker, contrariando "fail fast" e DRY.

**2. Servidor permanece a única autoridade de preço.**
O front envia `quantidade_copias` no INSERT (precisa para a impressão e para a UI), mas o valor cobrado é recalculado em `create-pix` lendo `quantidade_copias` **da linha**, não do request. Isso preserva a propriedade já existente de que o cliente não dita o preço. A RLS de INSERT ganha `quantidade_copias >= 1` para fechar a borda no banco.

**3. `calcularValor(numPaginas, quantidadeCopias, modo, precos)` ganha o multiplicador.**
A assinatura de `src/lib/pricing.ts` muda para incluir a quantidade. É uma função pequena e pura; o único chamador é `ConfiguracaoImpressao`. Alternativa descartada: multiplicar fora da função no componente — rejeitada porque deixaria a regra de preço dividida entre dois lugares.

**4. Worker usa `lp -n <quantidade_copias>`.**
`enviar_para_impressora` passa a receber a quantidade e a interpolar no argumento `-n`. O CUPS lida nativamente com cópias; não precisamos duplicar o arquivo nem loopar. Fallback para 1 quando o campo vier ausente/None (defensivo para linhas legadas lidas via `select *`).

**5. UI: input numérico controlado com mínimo 1.**
Campo `type="number"` com `min={1}` e normalização no `onChange` (valores `< 1`, vazios ou não inteiros viram 1). O total exibido deriva de `calcularValor`. Mantém o padrão visual já usado em `ConfiguracaoImpressao` (shadcn/ui).

## Risks / Trade-offs

- **Divergência entre o total exibido no front e o valor cobrado** → O front e o `create-pix` usam a mesma fórmula (`paginas × copias × preço`); o servidor reconfere as páginas reais. Se as páginas reais divergirem da contagem do cliente, o valor cobrado pode diferir do exibido — comportamento já existente e intencional (servidor é autoridade). Cópias não introduzem novo risco aqui porque a quantidade vem da mesma linha.
- **Cópias muito altas (custo/abuso ou fila longa)** → Sem teto neste escopo. Mitigação: o piso `>= 1` está garantido; um teto configurável pode ser adicionado depois se necessário. O `PRINT_TIMEOUT` do worker (180s) pode estourar para tiragens grandes — aceitável por ora, monitorar via logs e ajustar a env se preciso.
- **Migração aplicada em produção fora de ordem** → A migration `0007` apenas adiciona coluna com default e amplia a policy de INSERT (drop/create idempotente). Rollback: dropar a coluna e restaurar a policy anterior; nenhum dado legado depende dela.

## Migration Plan

1. Criar `supabase/migrations/0007_quantidade_copias.sql`: `alter table ... add column quantidade_copias ...` + `drop policy`/`create policy` da `fila_impressao_anon_insert` incluindo `quantidade_copias >= 1`.
2. Aplicar a `0007` no SQL Editor de produção (a coluna entra com default 1; pedidos em voo continuam válidos).
3. Deploy do frontend + `create-pix` via `feat/Impressora`.
4. Atualizar o `print-worker` na máquina da sede (pull + restart do serviço systemd).
5. Rollback: reverter o deploy; se necessário, `alter table ... drop column quantidade_copias` e restaurar a policy anterior.
