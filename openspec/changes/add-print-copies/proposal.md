## Why

Hoje o web-to-print imprime sempre **uma única cópia** do PDF (`lp -n 1` fixo no worker) e o valor do PIX considera só `num_paginas × valor_por_página`. Quem precisa de várias cópias do mesmo arquivo é obrigado a refazer o pedido e pagar N vezes, uma fricção desnecessária para o caso de uso mais comum da sede (provas, listas, apostilas).

## What Changes

- **Campo de quantidade de cópias no checkout.** A tela de configuração (`ConfiguracaoImpressao`) passa a ter um campo numérico "Quantidade de cópias" (mínimo 1, default 1). O total exibido passa a refletir `num_paginas × quantidade_copias × valor_por_página`.
- **Persistência da quantidade.** A `fila_impressao` ganha a coluna `quantidade_copias int not null default 1 check (quantidade_copias >= 1)`. A política de INSERT do anon é ampliada para validar `quantidade_copias >= 1`, mantendo o servidor como autoridade de preço.
- **Preço autoritativo no servidor.** O `create-pix` passa a multiplicar pela `quantidade_copias` do pedido ao calcular `valor_centavos`. A contagem de páginas continua sendo reconferida a partir do PDF real; a quantidade de cópias é lida da linha do pedido (não confiável vinda do cliente apenas como exibição).
- **Impressão de N cópias.** O `print-worker` passa a enviar `lp -n {quantidade_copias}` em vez de `-n 1`, imprimindo de fato a quantidade paga.
- **Sem breaking change.** Pedidos legados sem a coluna assumem `quantidade_copias = 1` (default), preservando o comportamento atual.

## Capabilities

### New Capabilities

(nenhuma)

### Modified Capabilities

- `web-to-print-checkout`: o checkout passa a coletar a quantidade de cópias e a calcular o total como `num_paginas × quantidade_copias × valor_por_página`.
- `mercadopago-pix-integration`: o valor da cobrança PIX passa a incluir o multiplicador de cópias (`num_paginas × quantidade_copias × valor_centavos_por_pagina`), calculado no servidor.
- `print-queue-storage`: a `fila_impressao` passa a armazenar `quantidade_copias` (default 1, `>= 1`), e a RLS de INSERT do anon valida o novo campo.
- `print-worker`: o worker passa a imprimir a quantidade de cópias do pedido (`lp -n quantidade_copias`) em vez de uma cópia fixa.

## Impact

- **Frontend:** `src/components/impressao/ConfiguracaoImpressao.tsx` (campo de quantidade + total multiplicado), `src/pages/Impressao.tsx` (propaga `quantidade_copias` no INSERT e na exibição), `src/lib/pricing.ts` (`calcularValor` passa a aceitar a quantidade), `src/lib/types.ts` (`Pedido` ganha `quantidade_copias`).
- **Backend:** `api/payments/create-pix.ts` (lê `quantidade_copias` do pedido e multiplica no `valor_centavos`; descrição do PIX menciona as cópias).
- **Worker:** `print-worker/worker.py` (`enviar_para_impressora` usa `-n quantidade_copias`).
- **Banco:** nova migration `0007_quantidade_copias.sql` (coluna + ajuste da policy de INSERT do anon).
- **Sem mudança** de segredos, do contrato do webhook ou do fluxo de status; sem breaking change para pedidos existentes.
