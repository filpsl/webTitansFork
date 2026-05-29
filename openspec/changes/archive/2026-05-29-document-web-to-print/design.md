## Context

A documentação precisa cobrir uma feature distribuída por quatro subsistemas e três
ambientes de execução. O leitor-alvo é um membro da equipe TITANS com conhecimento técnico
mediano, que pode precisar: entender o sistema pela primeira vez, dar manutenção num
subsistema específico, ou operar/depurar a impressão na sede. A documentação não substitui
as specs do OpenSpec (que são a fonte canônica de requisitos); ela traduz e conecta.

Material de origem já disponível para a escrita:
- Propostas e designs arquivados em `openspec/changes/archive/2026-05-2*-*/`.
- Specs canônicas em `openspec/specs/{web-to-print-checkout,mercadopago-pix-integration,print-queue-storage,print-worker}/`.
- Código: `src/pages/Impressao.tsx`, `src/components/impressao/*`, `src/lib/{supabase,pricing,pdf-utils}.ts`, `src/hooks/usePedidoStatus.ts`, `api/**`, `supabase/migrations/*`, `print-worker/*`.

## Goals / Non-Goals

**Goals:**

- Produzir documentação navegável, em português, sob `docs/web-to-print/`.
- Um documento por área, com um índice que dá a visão geral e linka o resto.
- Detalhar cada subsistema o suficiente para manutenção: responsabilidades, arquivos,
  fluxo de dados, decisões e pontos de atenção.
- Incluir um runbook operacional (deploy do worker, tratamento de `ERRO`, re-fila).

**Non-Goals:**

- Reescrever os requisitos já cobertos pelas specs do OpenSpec (linkar, não duplicar).
- Documentar cada linha de código — foco em arquitetura, contratos e operação.
- Documentar a mudança de hardening (`harden-web-to-print-security`), ainda ativa.
- Gerar a documentação agora — isto é o plano; a escrita acontece no apply.

## Decisions

### Estrutura de arquivos: um diretório, um doc por área

Documentação em markdown sob `docs/web-to-print/`, dividida por preocupação para que cada
leitor vá direto ao que precisa:

```
docs/web-to-print/
  README.md            # índice + visão geral de 1 página, com o diagrama dos componentes
  01-arquitetura.md    # 4 componentes, 3 fronteiras de execução, fronteiras de segredos
  02-fluxo-pedido.md   # ciclo de vida do pedido + máquina de estados de `status`
  03-checkout.md       # frontend /impressao (upload, contagem, preço, pagamento, status)
  04-pagamento-pix.md  # Serverless Functions: create-pix e webhook (assinatura, idempotência)
  05-supabase.md       # fila_impressao, config_precos, bucket privado, RLS, Realtime
  06-print-worker.md   # worker Python: polling, claim, CUPS, systemd
  07-operacao.md       # runbook: instalar/atualizar o worker, ERRO, re-fila, monitoramento
  08-seguranca.md      # segredos por ambiente, service_role, validação de webhook
```

Alternativas consideradas: (a) um único README gigante — rejeitado por ficar difícil de
navegar; (b) READMEs espalhados em cada pasta de código — rejeitado porque a feature
cruza pastas e ambientes, e a visão de conjunto se perderia.

### Cada doc de subsistema segue a mesma anatomia

Para previsibilidade, os docs `03`–`06` seguem o mesmo esqueleto: **Responsabilidade**
(o que faz e o que não faz) → **Arquivos** (onde mora no repo) → **Fluxo** (passo a passo,
com diagrama quando ajudar) → **Decisões e pontos de atenção** → **Link para a spec
canônica**. Isso facilita escrever e ler.

### Diagramas em ASCII, versionáveis

Diagramas (componentes, máquina de estados) em ASCII dentro do markdown, para ficarem no
controle de versão e legíveis em qualquer editor — sem dependência de ferramenta externa
de diagramação. Reaproveitar os diagramas já produzidos durante o planejamento.

### A máquina de estados ganha documento próprio

O `status` de `fila_impressao` é o contrato que costura os quatro subsistemas, então o
fluxo do pedido + máquina de estados merece um documento dedicado (`02-fluxo-pedido.md`),
referenciado pelos docs de cada subsistema em vez de repetido em cada um.

## Risks / Trade-offs

- **Documentação diverge do código com o tempo** → Mitigação: linkar para as specs e para
  caminhos de arquivo reais; manter os docs em nível de arquitetura/contrato (que muda
  menos) e não de implementação linha a linha.
- **Sobreposição com as specs do OpenSpec** → Mitigação: regra explícita de "linkar, não
  duplicar"; cada doc de subsistema aponta para sua spec canônica.
- **Hardening em andamento pode mudar partes** (preço calculado no servidor, limpeza de
  bucket) → Mitigação: marcar no doc os pontos que o hardening vai alterar, sem
  documentá-lo em detalhe.

## Migration Plan

Mudança somente de documentação — sem deploy/rollback de runtime. Aplicar significa
escrever os arquivos do checklist de `tasks.md`, validar links e caminhos, e arquivar a
mudança.

## Open Questions

- A documentação deve incluir prints da UI do checkout? (Default assumido: não nesta
  primeira versão; texto + ASCII bastam. Revisar se a equipe pedir.)
