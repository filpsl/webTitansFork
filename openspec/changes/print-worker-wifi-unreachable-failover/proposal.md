## Why

O failover Wi-Fi→USB do print-worker, entregue em `print-worker-dual-queue-failover`, **não dispara** quando a impressora HP Laser MFP 131/133/135/138 está com o Wi-Fi desligado. Em teste real, o CUPS **aceita o job no spool e devolve um job id imediatamente, ANTES de contatar o host mDNS `.local`** da fila Wi-Fi (`Titans_Laser`, IPP Everywhere). Como a fronteira anti-duplicação foi definida como "aceitação do job pelo CUPS", o job aceito mas travado cai, ~5 min depois, no ramo **pós-aceitação** que por design proíbe failover — logando `ERRO (failover deliberadamente evitado para não duplicar)` — e a fila USB de fallback **nunca é tentada**. O usuário fica sem impressão num cenário em que o failover era exatamente o que deveria acontecer.

## What Changes

- **Detecção real de alcançabilidade da fila primária ANTES de submeter**: o health-check atual (`fila_saudavel`, `lpstat -p` = `enabled`) não detecta host `.local` caído — uma fila IPP de rede continua reportada como `enabled`/idle mesmo com a impressora inalcançável. Adiciona-se uma verificação de alcançabilidade real do destino da fila (ex.: resolução do nome mDNS `.local` e/ou TCP-connect na porta IPP 631 do device-uri), com timeout curto. Se a primária estiver **comprovadamente inalcançável**, o worker escolhe a fila de fallback **sem nunca submeter à primária** — failover seguro de verdade, porque nada foi aceito.
- **Reclassificação do caso "host inalcançável" como PRÉ-SUBMISSÃO comprovadamente segura**: o invariante dominante (NUNCA imprimir o mesmo pedido duas vezes) é preservado. A correção apenas reconhece que, quando se prova que a impressora **não recebeu nenhum byte** (host nunca foi contatado), failover é seguro — em vez de tratar esse caso como pós-aceitação irreversível só porque o CUPS já devolveu um job id.
- **Investigação do estado do job no CUPS como sinal complementar de "nada impresso"**: avaliar `job-state-reasons` (ex.: `connecting-to-device`, `job-fetchable`) e o estado `processing`/idle da fila para, no design, decidir se um job aceito mas com o host comprovadamente nunca contatado pode ser **cancelado e ter failover** com segurança. A recomendação fecha entre a abordagem puramente pré-submissão (preferida) e essa, com os trade-offs explícitos no design.
- **Timeout/política de falha rápida na fila Wi-Fi** (a investigar no design): reduzir os ~5 min de espera atual (via opção de `lp`/CUPS ou polling de estado do job) para falhar cedo, sem afetar a fila USB.
- **Logs explícitos** do novo ramo: por que a primária foi considerada inalcançável e que o failover para a USB ocorreu **sem nada ter sido impresso**.
- **Retrocompatibilidade preservada**: instalações que definem apenas `PRINTER_NAME` (sem `PRINTER_NAME_FALLBACK`) continuam idênticas ao comportamento atual.
- Esta é primariamente uma **proposta de investigação + correção**; o design detalha a causa raiz comprovada no código e escolhe a abordagem recomendada com trade-offs. **Não implementa código** nesta etapa.

## Capabilities

### New Capabilities
<!-- Nenhuma capability nova: o comportamento muda dentro do worker existente. -->

### Modified Capabilities
- `print-worker`: o requisito de impressão com fila primária Wi-Fi + fallback USB passa a exigir uma **verificação de alcançabilidade real do destino da fila antes de submeter** (não apenas `enabled` no `lpstat -p`), e a política de failover passa a tratar o caso "host primário comprovadamente inalcançável (nenhum byte enviado)" como **pré-submissão segura → failover permitido**, mantendo a proibição de failover quando não há como afirmar que nada foi impresso.

## Impact

- **Código**: `print-worker/worker.py` — `fila_saudavel` (ou uma nova função de alcançabilidade) ganha verificação de destino real; possível leitura do device-uri da fila (`lpstat -v <fila>`) para extrair host/porta; `processar` passa a classificar "host inalcançável" como pré-submissão; possível ajuste em `aguardar_conclusao`/timeout da Wi-Fi. Mantém o estilo do worker (funções pequenas, sem silenciar exceções).
- **Configuração**: possivelmente `print-worker/.env.example` (ex.: timeout de alcançabilidade configurável), a confirmar no design.
- **Documentação**: `print-worker/README.md` e `docs/web-to-print/06-print-worker.md`/`07-operacao.md` — descrever o novo critério de failover por inalcançabilidade e o runbook de teste (desligar Wi-Fi → confirmar queda para USB sem duplicar).
- **Spec**: `openspec/specs/print-worker/spec.md` (delta MODIFIED).
- **Sem mudanças** de schema do banco, RLS, Mercado Pago, frontend ou Vercel. A máquina de estados `PAGO → IMPRIMINDO → IMPRESSO/ERRO` permanece intacta.
