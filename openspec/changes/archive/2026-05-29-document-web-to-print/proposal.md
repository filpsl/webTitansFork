## Why

A feature web-to-print foi entregue em duas mudanças (`add-web-to-print` e
`add-print-worker`), abrange quatro subsistemas (checkout, pagamento, Supabase e worker)
e roda em três ambientes diferentes (navegador, Vercel, máquina da sede). É muita coisa,
e hoje só existe documentação fragmentada nas propostas originais e nas specs do OpenSpec
— nada voltado para um membro da equipe que precise **entender ou manter** o sistema sem
reler tudo. Esta mudança planeja a produção de uma documentação humana, detalhada e
navegável da feature inteira.

## What Changes

- Criação de um conjunto de documentos em prosa sob `docs/web-to-print/`, um por área,
  cobrindo arquitetura, fluxo do pedido, cada subsistema, operação e segurança.
- Um `README.md` índice que serve de ponto de entrada e amarra os documentos.
- Esta é uma mudança **somente de documentação**: nenhum código, schema, RLS ou worker é
  alterado. As specs do OpenSpec (`web-to-print-checkout`, `mercadopago-pix-integration`,
  `print-queue-storage`, `print-worker`) permanecem a fonte canônica dos requisitos; a
  documentação os explica em linguagem acessível e mostra como as peças se conectam.
- **Escopo deste change**: o *plano* (esta proposta, o design e as tarefas). A escrita de
  cada documento é executada na fase de apply, seguindo o checklist de `tasks.md`.

## Capabilities

### New Capabilities

- `web-to-print-docs`: define o conjunto de documentação que o repositório DEVE conter
  para a feature web-to-print — quais documentos existem, o que cada um cobre e o nível de
  detalhe esperado. É um requisito sobre artefatos de documentação, não sobre o software.

### Modified Capabilities

<!-- Nenhuma. As quatro capabilities de implementação não mudam de comportamento. -->

## Impact

- **Documentação nova**: diretório `docs/web-to-print/` com ~8 arquivos markdown.
- **Sem mudança de código**: nada em `src/`, `api/`, `supabase/` ou `print-worker/`.
- **Fontes a consultar na escrita**: as propostas/designs arquivados em
  `openspec/changes/archive/`, as specs em `openspec/specs/`, e o código real em
  `src/components/impressao/`, `src/lib/`, `api/`, `supabase/migrations/` e
  `print-worker/`.
- **Público-alvo**: membros da equipe TITANS (atuais e futuros) que precisem operar,
  depurar ou estender a feature.
