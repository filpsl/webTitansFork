## Why

A impressora da sede (HP Laser MFP 131/133/135/138) era usada via **USB**, por uma fila CUPS
driverless (`HP_Laser_MFP_131_133_135_138`) que travava de tempos em tempos e cuspia várias
folhas com lixo (caracteres estranhos) — provável negociação de formato errada do driverless
por USB. Para resolver, a impressora foi ligada por **Wi-Fi** e ganhou uma nova fila CUPS
driverless de rede (IPP Everywhere) chamada `Titans_Laser`, cuja página de teste sai limpa.
Precisamos que o worker imprima preferencialmente pela fila Wi-Fi e, se ela estiver
indisponível **antes de o job ser aceito pelo CUPS**, faça failover automático para a fila
USB — **sem nunca arriscar imprimir o mesmo pedido duas vezes**.

## What Changes

- **Duas filas configuráveis**: fila primária (Wi-Fi, `Titans_Laser`) e fila de fallback
  (Cabo/USB, `HP_Laser_MFP_131_133_135_138`), via novas variáveis de ambiente
  `PRINTER_NAME` (primária) e `PRINTER_NAME_FALLBACK` (secundária; opcional). Mantém
  **retrocompatibilidade**: se `PRINTER_NAME_FALLBACK` não for definida, o worker opera só
  com a primária, exatamente como hoje.
- **Checagem de saúde da fila antes de enviar**: o worker verifica se a fila está habilitada
  e alcançável (`lpstat`) e escolhe a fila saudável antes de submeter, reduzindo a chance de
  mandar para uma fila morta.
- **Failover automático seguro, restrito à pré-submissão**: se a fila escolhida falhar
  **antes de o CUPS aceitar o job** (host `.local` não resolve, impressora inalcançável, fila
  desabilitada/rejeitando, `lp` retorna erro de submissão), o worker tenta a outra fila. Como
  o job nunca foi aceito, reenviar é seguro.
- **NÃO faz failover após o CUPS aceitar o job**: timeout em `aguardar_conclusao` (ou
  qualquer falha pós-aceitação) mantém o comportamento atual — cancela o job e marca `ERRO`
  para tratamento manual. Nunca reimprime automaticamente, evitando cópias duplicadas
  (lembrando que o worker já replica páginas para N cópias).
- **Logs explícitos** de qual fila foi usada e por que houve (ou não) failover.
- **Documentação corrigida**: o `print-worker/README.md` e os docs em `docs/web-to-print/`
  mandam usar `hp-setup`/USB (HPLIP), caminho **não suportado** por este modelo; passam a
  descrever a fila de rede `Titans_Laser` + fallback USB.

## Capabilities

### New Capabilities
<!-- Nenhuma capability nova: o comportamento muda dentro do worker existente. -->

### Modified Capabilities
- `print-worker`: o requisito de impressão passa de uma única fila CUPS (`PRINTER_NAME`) para
  uma fila primária Wi-Fi com fallback USB opcional, com checagem de saúde da fila e política
  de failover restrita à pré-submissão; e adiciona um requisito explícito de prevenção de
  impressão duplicada em failover (proibição de failover após o job ser aceito pelo CUPS).

## Impact

- **Código**: `print-worker/worker.py` — `Config` (nova var de fallback), `enviar_para_impressora`
  (parametrizar fila + distinguir erro de pré-submissão de erro pós-aceitação), `aguardar_conclusao`
  e `cancelar_job` (parametrizar fila), novo health-check de fila, e o fluxo de failover em `processar`.
- **Configuração**: `print-worker/.env.example` (nova `PRINTER_NAME_FALLBACK`).
- **Operação**: `print-worker/print-worker.service` (descrição do unit menciona o modelo/USB).
- **Docs**: `print-worker/README.md`, `docs/web-to-print/README.md`,
  `docs/web-to-print/01-arquitetura.md`, `docs/web-to-print/06-print-worker.md`,
  `docs/web-to-print/07-operacao.md` — refletir fila de rede `Titans_Laser` + fallback e
  remover instruções de `hp-setup`/HPLIP.
- **Spec**: `openspec/specs/print-worker/spec.md` (delta MODIFIED).
- **Sem mudanças** de schema do banco, RLS, Mercado Pago, frontend ou Vercel.
