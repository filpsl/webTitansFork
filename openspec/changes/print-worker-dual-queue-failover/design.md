## Context

O worker (`print-worker/worker.py`) imprime hoje numa única fila CUPS lida de `PRINTER_NAME`.
O fluxo de impressão de um pedido é:

1. `enviar_para_impressora(cfg, caminho)` chama `lp -d <fila> <arquivo>` e extrai o **job id**
   da saída do CUPS (`request id is ...`). O sucesso desta etapa significa **o CUPS aceitou o
   job** — ele entrou na spool e será impresso.
2. `aguardar_conclusao(cfg, job_id)` faz polling com `lpstat -o` até o job sumir da fila ou
   estourar `PRINT_TIMEOUT`.
3. Sucesso → `IMPRESSO`; timeout → cancela o job e marca `ERRO`.

A impressora não respeita a opção de cópias do CUPS, então o worker já **materializa N cópias
no próprio PDF** (`replicar_pdf`) e envia um único job. Isso é central para o risco abordado
aqui: uma reimpressão indevida não desperdiça uma folha, mas potencialmente **dezenas**.

A mudança física: a fila USB driverless (`HP_Laser_MFP_131_133_135_138`) travava e imprimia
lixo; a nova fila Wi-Fi driverless IPP Everywhere (`Titans_Laser`) imprime limpo e passa a ser
a primária. A USB vira fallback. O device-uri da fila Wi-Fi usa o nome mDNS `.local` (não o IP),
porque o IP é DHCP na rede da faculdade (`10.74.x.x`) e muda.

**Restrições:**
- Sem mudanças de schema/estado: a máquina de estados continua `PAGO → IMPRIMINDO → IMPRESSO/ERRO`.
- Retrocompatibilidade: instalações que só definem `PRINTER_NAME` continuam funcionando.
- Estilo do worker: funções pequenas, erros tratados explicitamente, sem silenciar exceções.

## Goals / Non-Goals

**Goals:**
- Imprimir preferencialmente pela fila Wi-Fi (`Titans_Laser`) e cair para a USB **apenas quando
  for comprovadamente seguro** (nada foi impresso ainda).
- Escolher a fila por uma checagem de saúde antes de submeter, reduzindo envios para fila morta.
- **Garantir que failover nunca cause cópia duplicada.** Este é o requisito dominante: na dúvida,
  preferir `ERRO` (intervenção manual) a reimprimir.
- Logar de forma inequívoca qual fila foi usada e por que houve (ou não) failover.

**Non-Goals:**
- Não introduzir retry automático após o job ser aceito pelo CUPS.
- Não balancear carga entre filas nem imprimir em ambas.
- Não alterar `replicar_pdf`, a contagem de páginas, o claim atômico ou a recuperação de travados.
- Não detectar qualidade física da folha (continua fora do escopo do CUPS).
- Não suportar mais de duas filas.

## Decisions

### Decisão 1 — Duas filas por variável de ambiente, fallback opcional

`Config` passa a ter `printer_name` (primária, obrigatória — retrocompat com a var atual) e
`printer_name_fallback` (opcional). A lista efetiva de filas a tentar é
`[primária] + ([fallback] se definida)`. Sem fallback definido, o comportamento é idêntico ao
de hoje (uma fila, sem failover).

**Alternativa considerada:** uma única var `PRINTER_NAMES` separada por vírgula. Rejeitada:
quebra a retrocompatibilidade do nome `PRINTER_NAME` e torna ambígua a ordem de prioridade.

### Decisão 2 — Funções de CUPS parametrizadas por fila

`enviar_para_impressora`, `aguardar_conclusao` e `cancelar_job` passam a receber o **nome da
fila** como parâmetro explícito em vez de lê-lo de `cfg.printer_name`. Isso mantém cada função
com responsabilidade única e permite o fluxo de failover orquestrar as tentativas. `processar`
deixa de assumir uma fila fixa.

### Decisão 3 — Health-check antes de submeter (escolha de fila)

Antes de submeter, o worker checa a saúde da fila candidata com `lpstat -p <fila>`: a fila deve
existir e estar **enabled** (não "disabled"). Para a fila Wi-Fi, isso também cobre indiretamente
o host inalcançável quando o CUPS marca a fila como parada. O worker tenta a primeira fila
saudável; se a primária estiver insalubre, já parte para a fallback **sem submeter à primária**.

Health-check é **best-effort para escolha**, não a garantia de segurança — a garantia vem da
Decisão 4. Mesmo que o health-check diga "saudável" e a submissão falhe, o classificador de erro
decide com segurança.

**Alternativa considerada:** pingar o host `.local` diretamente. Rejeitada: duplica a lógica que
o CUPS já faz, e o estado da fila no CUPS é a fonte de verdade para "dá para imprimir agora?".

### Decisão 4 — Classificação de erro: PRÉ-SUBMISSÃO vs PÓS-ACEITAÇÃO (núcleo anti-duplicação)

O ponto pivô é **a aceitação do job pelo CUPS** (sucesso de `lp`, com job id extraído):

- **Falha de PRÉ-SUBMISSÃO** = a falha ocorre **antes** de `lp` aceitar o job. Casos: fila
  insalubre no health-check; `lp` retorna `returncode != 0` (host `.local` não resolve,
  impressora inalcançável, fila desabilitada/rejeitando, erro de submissão); ou `lp` retorna 0
  mas **não foi possível extrair o job id** (tratado como não-aceito por precaução). Nestes
  casos é **seguro afirmar que nada foi impresso** → o worker pode tentar a próxima fila.
- **Falha de PÓS-ACEITAÇÃO** = qualquer falha **depois** de o CUPS aceitar o job. Caso
  principal: timeout em `aguardar_conclusao`. Aqui **não há como garantir que nada saiu no
  papel** → **proibido failover**. Mantém o comportamento atual: cancela o job e marca `ERRO`.

A implementação usa uma **exceção/sinal dedicado** para "falha de pré-submissão" (ex.: uma
exceção `FalhaPreSubmissao`), distinta de qualquer falha após a aceitação. O orquestrador de
failover só captura a falha de pré-submissão; nunca a de pós-aceitação. Isso torna o invariante
explícito no código e impossível de violar por engano.

**Alternativa considerada:** failover por timeout também, "só uma vez". Rejeitada — viola
diretamente o requisito crítico: se o Wi-Fi imprimiu mas o `lpstat` demorou a refletir,
reenviar pela USB duplica o documento inteiro (e todas as N cópias).

### Decisão 5 — Orquestração do failover em `processar`

Pseudo-fluxo (substitui o bloco atual de envio/espera):

```
filas = filas_candidatas(cfg)              # [primária] (+ [fallback] se houver)
para indice, fila em enumerate(filas):
    se not fila_saudavel(fila):
        log "fila <fila> insalubre, pulando"
        continua                            # falha de pré-submissão implícita
    tente:
        job_id = enviar_para_impressora(fila, caminho)   # aceitação do CUPS
    exceto FalhaPreSubmissao como e:
        log "submissão à <fila> falhou (pré-submissão): <e>"
        continua                            # seguro: nada impresso → próxima fila
    # A PARTIR DAQUI o job foi ACEITO: sem failover.
    log "aceito pela fila <fila> (job <job_id>)"
    se aguardar_conclusao(fila, job_id):
        marcar IMPRESSO; retorna
    senão:
        log "timeout na <fila> após aceitação → ERRO (sem failover, evita duplicar)"
        cancelar_job(fila, job_id); marcar ERRO; retorna

# Esgotou todas as filas só com falhas de pré-submissão:
log "nenhuma fila aceitou o job → ERRO"
marcar ERRO
```

Invariantes garantidos:
- Failover só acontece em falha de **pré-submissão** (job nunca aceito).
- Uma vez aceito o job, **nenhuma outra fila é tentada** — o pedido resolve em `IMPRESSO` ou
  `ERRO` naquela fila.
- Esgotar as filas sem nenhuma aceitação → `ERRO` (nada foi impresso; seguro re-filar manual).

### Decisão 6 — Logs de auditoria

Cada decisão de fila gera log INFO/WARNING explícito: qual fila foi escolhida, se houve
failover e o motivo (saúde/erro de submissão), e — em pós-aceitação — que o failover foi
**deliberadamente evitado** para não duplicar. Operação na sede depende desse rastro
(`journalctl`).

## Prevenção de impressão duplicada (falsos negativos)

Esta é a seção de design dominante. O risco: um **falso negativo** — o job do Wi-Fi de fato
**imprimiu**, mas o worker *achou* que falhou — leva, num failover ingênuo, a reimprimir tudo
pela USB. Como o worker materializa N cópias no PDF (`replicar_pdf`), uma duplicação pode
significar dezenas de folhas desperdiçadas.

**Decisão e justificativa:**

O failover é **estritamente proibido depois que o CUPS aceita o job**. A fronteira é a
aceitação pelo `lp` (job id obtido). Antes dela, podemos **afirmar com segurança que nada foi
impresso**: o CUPS sequer recebeu o trabalho. Depois dela, **não podemos afirmar nada** sobre
o estado físico do papel — o job pode ter impresso por completo, parcialmente, ou nada — então
reenviar é inseguro por definição.

Por isso:

- **Failover só em falhas de pré-submissão** (host `.local` não resolve, impressora
  inalcançável, fila parada/desabilitada/rejeitando, `lp` falha na submissão, ou job id não
  extraível). São casos onde o trabalho nunca foi aceito → reenviar pela outra fila é seguro.
- **Sem failover em falhas de pós-aceitação** (timeout de `aguardar_conclusao`, ou qualquer
  erro após obter o job id). Mantém-se o comportamento atual: cancelar o job e marcar `ERRO`
  para tratamento manual. Pior caso aceitável: uma folha/job não confirmado vira `ERRO` e um
  humano decide — **nunca** uma reimpressão automática.
- **Health-check antes de submeter** reduz a probabilidade de chegar a uma submissão que
  falha "no meio", escolhendo desde o início uma fila idle/enabled/alcançável.
- **Viés para `ERRO` na dúvida:** se `lp` retorna 0 mas o job id não é extraível, tratamos
  como pré-submissão (seguro tentar a outra fila) **somente** porque sem job id não há job
  rastreável aceito; se ainda assim houver dúvida sobre impressão física, o operador trata o
  `ERRO` manualmente em vez de o worker reimprimir.

Trade-off assumido: em troca de **zero risco de duplicação automática**, aceitamos que alguns
falsos negativos pós-aceitação (raros) exijam intervenção manual via `ERRO`. Dado o custo
assimétrico (dezenas de folhas vs. um clique no Supabase), é a troca correta.

## Risks / Trade-offs

- **[Falso negativo pós-aceitação vira `ERRO` mesmo tendo impresso]** → Por design. Mitigação:
  log claro do job id e da fila; runbook orienta o operador a marcar `IMPRESSO` manualmente se
  confirmar que a folha saiu, em vez de re-filar para `PAGO`.
- **[Health-check `lpstat -p` pode reportar "enabled" para uma fila Wi-Fi cujo host caiu]** →
  A garantia anti-duplicação não depende do health-check; se a submissão falhar, o
  classificador de pré-submissão cobre o caso e o failover é seguro.
- **[Nome `.local` (mDNS) não resolve por falha de Avahi/rede]** → É uma falha de
  pré-submissão (host não resolve) → failover seguro para a USB. Documentar dependência de
  mDNS no README/runbook.
- **[Operador define `PRINTER_NAME_FALLBACK` igual à primária]** → Failover "para a mesma
  fila" é inócuo (no-op de segurança), mas confunde logs. Mitigação: documentar que devem ser
  filas distintas; opcionalmente ignorar fallback idêntico à primária.
- **[Regressão para instalações sem fallback]** → Mitigada por retrocompatibilidade: sem
  `PRINTER_NAME_FALLBACK`, o caminho é uma única fila, igual ao atual.

## Migration Plan

1. Criar a fila Wi-Fi na máquina da sede (já feito):
   `lpadmin -p Titans_Laser -E -v ipp://NOME.local/ipp/print -m everywhere` e imprimir teste.
2. Atualizar `worker.py` (filas, health-check, classificação de erro, failover) e
   `.env.example`.
3. No `.env` da sede: `PRINTER_NAME=Titans_Laser` e
   `PRINTER_NAME_FALLBACK=HP_Laser_MFP_131_133_135_138`.
4. `systemctl restart print-worker`; validar nos logs a escolha da fila Wi-Fi e um failover
   forçado (ex.: desligar o Wi-Fi da impressora e confirmar queda para a USB **sem duplicar**).
5. Atualizar a documentação (README do worker + `docs/web-to-print/*`).

**Rollback:** remover `PRINTER_NAME_FALLBACK` do `.env` e apontar `PRINTER_NAME` para a fila
que estiver boa; o worker volta ao modo de fila única. Reverter `worker.py` se necessário.

## Open Questions

- A USB driverless deve permanecer instalada como fallback **apesar** do histórico de lixo, ou
  o fallback ideal seria uma segunda fila de rede? (Premissa atual: manter a USB como rede de
  segurança, já que o failover só dispara quando o Wi-Fi está comprovadamente fora.)
- Vale ignorar `PRINTER_NAME_FALLBACK` quando idêntica à primária, ou apenas documentar?
