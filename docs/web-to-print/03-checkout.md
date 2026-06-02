# 03 — Checkout (frontend)

[← Índice](README.md) · Spec canônica: [`web-to-print-checkout`](../../openspec/specs/web-to-print-checkout/spec.md)

## Responsabilidade

A página pública `/impressao` conduz o cliente por quatro etapas — upload, configuração,
pagamento e sucesso — fazendo upload do PDF direto ao Storage, criando o pedido e
acompanhando o status. **Não** processa pagamento nem imprime, e só usa a anon key.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `src/pages/Impressao.tsx` | Orquestra a máquina de passos (`UPLOAD → CONFIG → PAGAMENTO → SUCESSO`/`TIMEOUT`) e faz o upload + criação do pedido + chamada do PIX. |
| `src/components/impressao/UploadPDF.tsx` | Seleção/drag-drop do arquivo, validação e contagem de páginas. |
| `src/components/impressao/ConfiguracaoImpressao.tsx` | Escolha de modo de cor e exibição do preço. |
| `src/components/impressao/TelaPagamento.tsx` | Mostra QR Code, Copia e Cola, timer, e aguarda confirmação. |
| `src/components/impressao/TelaSucesso.tsx` | Tela final com o protocolo (8 primeiros caracteres do UUID). |
| `src/lib/pdf-utils.ts` | `validarArquivoPDF` (tipo + 50 MB) e `contarPaginas` (pdfjs-dist). |
| `src/lib/pricing.ts` | `fetchPrecos`, `calcularValor`, `formatBRL`. |
| `src/lib/supabase.ts` | Cliente Supabase do navegador (anon key, sem sessão persistida). |
| `src/hooks/usePedidoStatus.ts` | Realtime + polling do status do pedido. |
| `src/lib/types.ts` | `ModoCor`, `StatusPedido`, `Pedido`, `Precos`. |

## Fluxo, passo a passo

### 1. Upload (`UploadPDF`)

- Aceita arquivo por clique ou arraste. `validarArquivoPDF` rejeita o que não for
  `application/pdf` ou exceder **50 MB** (`MAX_PDF_BYTES`), com um toast de erro.
- `contarPaginas` carrega o PDF com `pdfjs-dist` **no navegador** e lê `pdf.numPages`. Se
  o arquivo for ilegível, mostra "Não foi possível ler este PDF." e limpa a seleção.
- Ao concluir, entrega `{ file, numPaginas }` para a página e avança para `CONFIG`.

> O worker do pdfjs é resolvido pelo Vite via `pdfjs-dist/build/pdf.worker.min.mjs?url`.

### 2. Configuração (`ConfiguracaoImpressao`)

- No mount, `fetchPrecos()` lê `config_precos` do Supabase (linhas `PB` e `COLORIDO`).
- O total é `calcularValor(numPaginas, modo, precos) = numPaginas * precos[modo]`, em
  centavos, recalculado ao trocar o modo. Exibição via `formatBRL` (`Intl` pt-BR).
- "Pagar com PIX" devolve `{ modoCor, valorCentavos }` para a página.

### 3. Criação do pedido + PIX (`Impressao.tsx → confirmarConfiguracao`)

1. Gera um caminho `pdfPath = <uuid>/<nome-sanitizado>.pdf` e faz
   `supabase.storage.from('pdfs-impressao').upload(...)` (sem `upsert`).
2. `INSERT` em `fila_impressao` com `pdf_path`, `num_paginas`, `modo_cor` — **sem**
   `valor_centavos` (a RLS exige que ele seja `NULL`; o preço é definido pelo servidor). O
   `status` cai em `AGUARDANDO_PAGAMENTO` por padrão. Recebe o `id` de volta.
3. `POST /api/payments/create-pix` com `{ pedidoId }`. A resposta (`qr_code_base64`,
   `qr_code_copia_cola`, `expiration_date_to`, `mp_payment_id`, e o `valor_centavos`/
   `num_paginas` **autoritativos do servidor**) leva ao passo `PAGAMENTO`.

Se qualquer passo falhar, um toast mostra o erro e o cliente permanece na configuração
(nenhum pedido "meio-criado" avança).

### 4. Pagamento (`TelaPagamento`)

- Renderiza o QR Code (`data:image/png;base64,...`), o botão "Copiar Copia e Cola" e um
  timer regressivo até a expiração.
- Usa `usePedidoStatus(pedidoId)`: quando o status vira `PAGO`, chama `onPago()` → tela de
  sucesso. Se estourar o timeout, chama `onTimeout()`.

### 5. Sucesso (`TelaSucesso`)

- Mostra "Pagamento confirmado!" e o **protocolo** = 8 primeiros caracteres do UUID, em
  maiúsculas, para o cliente apresentar na retirada.

## Acompanhamento de status (`usePedidoStatus`)

Combina dois mecanismos para robustez (detalhado em [02](02-fluxo-pedido.md)):

- **Realtime**: assina o canal `postgres_changes` filtrado por `id=eq.<pedidoId>` na
  tabela `fila_impressao`. Entrega a mudança em ~instantâneo quando o socket está de pé.
- **Polling (fallback)**: via TanStack Query, refaz a query a cada **5s** enquanto o
  status ainda não é `PAGO` e não estourou o timeout.
- **Timeout**: **10 minutos** (`TIMEOUT_MS`); depois disso, reporta `error = "TIMEOUT"`.

O status efetivo é `realtimeStatus ?? query.data` — o que chegar primeiro.

## Decisões e pontos de atenção

- **A opção COLORIDO ainda aparece na UI**, mas a 135w é monocromática. A remoção do
  COLORIDO do checkout é uma mudança companheira separada; até lá, pedidos COLORIDO são
  impressos em tons de cinza (com aviso no log do worker).
- **O preço é autoridade do servidor.** A tela de configuração mostra apenas uma
  *estimativa*; o cliente não envia `valor_centavos` no INSERT. O `create-pix` reconta as
  páginas do PDF e recalcula o valor (ver [04](04-pagamento-pix.md) e a capability
  `print-payment-integrity`).
- A leitura do próprio pedido depende de conhecer o `id` (UUID opaco); ver as ressalvas de
  RLS em [05](05-supabase.md) e [08](08-seguranca.md).

---

Anterior: [02 — Fluxo do pedido](02-fluxo-pedido.md) · Próximo: [04 — Pagamento PIX](04-pagamento-pix.md)
