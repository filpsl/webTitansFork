## Context

A proposta anterior (`print-worker-dual-queue-failover`, já implementada — ver `worker.py` no commit "feat(print-worker): failover Wi-Fi primária + USB fallback (anti-duplicação)") introduziu duas filas CUPS: a primária Wi-Fi `Titans_Laser` (IPP Everywhere, device-uri com nome mDNS `.local`) e a fallback USB `HP_Laser_MFP_131_133_135_138`. O failover foi restringido à **pré-submissão**, com a fronteira de segurança definida como **a aceitação do job pelo CUPS** (sucesso de `lp` + job id extraído de `request id is ...`).

### Estado atual do código (fatos verificados em `print-worker/worker.py`)

- `enviar_para_impressora(fila, caminho)` (linhas ~216-235): roda `lp -d <fila> <arquivo>`; se `returncode != 0` ou se o job id não é extraível, levanta `FalhaPreSubmissao`; caso contrário retorna o job id. **Esse retorno é o ponto que o design anterior chama de "aceitação pelo CUPS".**
- `fila_saudavel(fila)` (linhas ~192-213): roda `lpstat -p <fila>` e considera saudável se `returncode == 0` e a saída não contém `"disabled"`. **Não verifica alcançabilidade real do destino.**
- `processar` (linhas ~315-369): itera `filas_candidatas`; pula fila insalubre; captura `FalhaPreSubmissao` para failover; após obter job id, o comentário "A PARTIR DAQUI o CUPS aceitou o job: sem failover" (linha ~338) marca o ponto de não-retorno. No timeout de `aguardar_conclusao`, cai no ramo das linhas ~351-360 que loga exatamente `ERRO (failover deliberadamente evitado para não duplicar)` e **não tenta a USB**.
- `aguardar_conclusao(cfg, fila, job_id)` (linhas ~238-252): polling de `lpstat -o <fila>` até `PRINT_TIMEOUT` (padrão 180s).

### Causa raiz (confirmada)

Numa fila IPP/Wi-Fi, o CUPS **aceita o job no spool e devolve o job id imediatamente, ANTES de tentar contatar o host `.local`**. Quando o Wi-Fi da impressora está desligado:

1. `fila_saudavel` retorna `True` — a fila CUPS continua `enabled`/idle (o CUPS não sabe ainda que o host caiu).
2. `enviar_para_impressora` retorna um job id normalmente — **nenhum byte chegou à impressora**, mas o código já considera "aceito".
3. O job fica preso em `connecting-to-device`; `aguardar_conclusao` estoura o timeout (~5 min na config da sede).
4. O fluxo cai no ramo pós-aceitação → `ERRO` sem failover. A USB **nunca** é tentada.

O risco já estava listado no `design.md` anterior (seção "Risks / Trade-offs": *"Health-check `lpstat -p` pode reportar 'enabled' para uma fila Wi-Fi cujo host caiu"*), mas a mitigação assumida — *"se a submissão falhar, o classificador de pré-submissão cobre o caso"* — **não se concretiza**, porque a submissão **não falha**: ela é aceita cedo demais.

### Restrições

- **Invariante dominante (inegociável):** NUNCA imprimir o mesmo pedido duas vezes. O worker materializa N cópias no PDF via `replicar_pdf`, então duplicar = potencialmente dezenas de folhas. Na dúvida real, `ERRO` manual.
- Retrocompatibilidade: instalações só com `PRINTER_NAME` (sem fallback) mantêm o comportamento atual.
- Estilo do worker: funções pequenas e com responsabilidade única, erros tratados explicitamente, sem silenciar exceções.
- Sem mudanças de schema/estado: `PAGO → IMPRIMINDO → IMPRESSO/ERRO` permanece.

## Goals / Non-Goals

**Goals:**
- Fazer o failover Wi-Fi→USB **disparar** quando a impressora primária está comprovadamente inalcançável, sem nunca submeter à primária nesse caso.
- Provar, **antes de a impressora receber qualquer byte**, que nada foi impresso — tornando o failover seguro de verdade nesse cenário.
- Falhar rápido em vez de esperar ~5 min pelo timeout da fila Wi-Fi morta.
- Preservar 100% do invariante anti-duplicação: na ausência de prova de "nada impresso", manter `ERRO` sem failover.
- Logar de forma inequívoca o motivo de a primária ter sido considerada inalcançável e que o failover ocorreu sem impressão.

**Non-Goals:**
- NÃO reintroduzir failover por timeout genérico de `aguardar_conclusao` (o caso "impressora recebeu bytes e travou no meio" continua `ERRO` sem failover).
- NÃO balancear carga nem imprimir em ambas as filas.
- NÃO alterar `replicar_pdf`, contagem de páginas, claim atômico ou recuperação de travados.
- NÃO suportar mais de duas filas.
- NÃO depender de mudanças na infraestrutura de rede da faculdade (IP DHCP continua; usamos o nome `.local`).

## Decisions

### Decisão 1 (RECOMENDADA) — Verificação de alcançabilidade real do destino ANTES de submeter

Adicionar uma checagem de alcançabilidade do **destino físico da fila** (não só do estado CUPS) e executá-la antes de `enviar_para_impressora`. Se a primária estiver comprovadamente inalcançável, o worker classifica como **pré-submissão** (nada submetido) e parte para a fallback — exatamente o caminho seguro que o design anterior já previa, mas que `fila_saudavel` não detectava.

Mecânica proposta:

1. Obter o device-uri da fila via `lpstat -v <fila>` (ex.: `device for Titans_Laser: ipp://Titans-Laser.local:631/ipp/print`). Extrair host e porta (default 631 para `ipp`).
2. **Resolver o nome** (mDNS `.local` → `avahi-resolve-host-name -4 <host>` ou `getent hosts <host>`), com timeout curto (ex.: 3s). Falha de resolução = inalcançável.
3. **TCP-connect** no `(host, porta)` resolvido com timeout curto (ex.: 3s, `socket.create_connection`). Conexão recusada/timeout = inalcançável.
4. Só filas cujo destino é alcançável são candidatas a submissão. A primária inalcançável é pulada **sem submeter** → failover seguro para a USB.

A verificação aplica-se a filas **de rede** (device-uri `ipp://`/`ipps://`/`socket://`/`http://`). Para filas **USB/local** (`usb://`, `hp:/usb/...`, `file://`) a alcançabilidade de rede não se aplica e mantém-se o health-check atual (`fila_saudavel`), evitando regressão e falsos negativos na fallback USB.

**Por que é seguro (não duplica):** se o TCP-connect ao IPP da impressora nunca teve sucesso, o `lp` sequer foi chamado para a primária → o CUPS não recebeu o job → a impressora não recebeu byte algum. Logo, escolher a USB é equivalente a uma `FalhaPreSubmissao`: comprovadamente nada impresso.

**Alternativa considerada:** manter só `lpstat -p`. Rejeitada: é a causa do bug — não enxerga host de rede caído.

**Alternativa considerada:** `ping` ICMP ao host. Rejeitada: ICMP pode estar bloqueado e não prova que a porta IPP responde; TCP-connect na 631 testa exatamente o serviço que o `lp` usaria.

### Decisão 2 — Falha rápida da fila Wi-Fi morta

Com a Decisão 1, o caso "Wi-Fi off" passa a ser detectado em segundos (timeouts de resolução + TCP-connect) em vez de esperar ~5 min pelo timeout de `aguardar_conclusao`. Isso já entrega a "falha rápida" sem mexer no `PRINT_TIMEOUT` (que continua governando o caso legítimo de impressão lenta após aceitação real).

Opcionalmente, avaliar opções do `lp`/CUPS (ex.: `-o job-hold-until=...` não ajuda; `error-policy abort-job` na fila reduz retries) — mas a recomendação é **não** depender disso: a alcançabilidade pré-submissão resolve o cenário relatado sem configuração externa frágil.

### Decisão 3 (ALTERNATIVA, NÃO recomendada como caminho principal) — Janela segura pós-aceitação por `job-state-reasons`

Investigar se, mesmo após obter o job id, o estado do job no CUPS permite afirmar com segurança que **nada foi impresso**: enquanto o job-state-reasons for `connecting-to-device` (ou a fila nunca saiu de "processing"/"waiting" sem nenhum byte transferido), o host nunca foi contatado. Nesse subcaso específico, `cancel`+failover seria seguro.

**Por que não é o caminho principal:** depende de interpretar estados internos do CUPS que variam por versão/backend e exige provar a ausência de transferência parcial — exatamente o tipo de inferência que o invariante anti-duplicação manda evitar. É mais frágil que a Decisão 1, que age **antes** de qualquer submissão. Fica documentada como reforço defensivo opcional: se, apesar da Decisão 1, um job ficar preso em `connecting-to-device`, o worker pode tratá-lo como "nunca contatou a impressora" e cancelar — **mas a regra de ouro continua**: failover só quando comprovadamente seguro; na dúvida, `ERRO`.

### Decisão 4 — Recomendação final e fronteira do invariante

Adotar **Decisão 1 (alcançabilidade pré-submissão) como correção principal**, opcionalmente reforçada pela Decisão 3 restrita ao estado `connecting-to-device` com zero bytes transferidos. A fronteira de segurança deixa de ser apenas "o CUPS devolveu job id" e passa a ser **"existe prova de que a impressora recebeu (ou pôde receber) bytes"**:

- **Host primário comprovadamente inalcançável** (resolução/TCP falham) → pré-submissão → **failover permitido** (nada impresso).
- **Job aceito e a impressora foi/pôde ser contatada** (qualquer sinal de transferência, ou impossibilidade de provar o contrário) → **failover proibido** → `cancel` + `ERRO`, igual a hoje.

### Decisão 5 — Configuração e retrocompatibilidade

A alcançabilidade tem timeouts curtos configuráveis (ex.: `REACHABILITY_TIMEOUT`, padrão ~3s) com default seguro; sem fallback configurado, o comportamento permanece o de fila única (a checagem extra apenas evita submeter a uma primária morta, mas sem fallback o desfecho continua `ERRO` — idêntico em efeito ao atual). O parsing de device-uri deve degradar com segurança: se não der para extrair host/porta, trata-se a fila pelo health-check atual (não regredir).

## Risks / Trade-offs

- **[Avahi/mDNS indisponível faz a resolução falhar mesmo com a impressora viva]** → A primária seria considerada inalcançável e cairia para a USB sem imprimir na Wi-Fi. Mitigação: tratar como o cenário-alvo (failover seguro, nada duplicado); documentar dependência de Avahi no runbook; timeout curto evita travar o ciclo.
- **[Falso positivo de alcançabilidade: TCP-connect 631 responde mas a impressão trava depois]** → Volta ao caso pós-aceitação, que continua `ERRO` sem failover (invariante preservado). A Decisão 1 reduz a probabilidade, não promete eliminá-la — e isso é intencional.
- **[Regressão na fila USB de fallback]** → A checagem de alcançabilidade de rede NÃO se aplica a device-uri USB/local; a fallback continua usando o health-check atual. Sem isso, a USB poderia ser marcada inalcançável por engano.
- **[Parsing frágil de `lpstat -v`]** → Se o device-uri não casar o padrão esperado, degradar para o health-check atual em vez de falhar. Nunca bloquear impressão por não conseguir parsear o uri.
- **[Decisão 3 mal aplicada reintroduz duplicação]** → Por isso ela é opcional e restrita a `connecting-to-device` com zero transferência; se houver qualquer dúvida, `ERRO`. A correção principal (Decisão 1) não depende dela.
- **[Custo de latência por pedido]** → Dois timeouts curtos (resolução + TCP) por fila de rede. Aceitável: ~poucos segundos só quando a primária está morta; no caminho feliz, resolução e connect são quase instantâneos.

## Migration Plan

1. Implementar a verificação de alcançabilidade (Decisão 1) em `worker.py`: extração de device-uri via `lpstat -v`, resolução mDNS/getent, TCP-connect com timeout, e integração ao laço de `processar` como classificação de **pré-submissão** para filas de rede inalcançáveis.
2. Atualizar `.env.example` se for adicionado `REACHABILITY_TIMEOUT`.
3. Atualizar README/`docs/web-to-print/*` com o novo critério de failover e o runbook de teste.
4. Validar na sede: `python -m py_compile`; depois teste manual — desligar o Wi-Fi da impressora e confirmar nos logs que a primária foi considerada **inalcançável (pré-submissão)** e que a impressão saiu pela USB **sem duplicar**; em seguida, religar e confirmar volta à Wi-Fi.
5. `openspec validate print-worker-wifi-unreachable-failover --strict`.

**Rollback:** reverter a verificação de alcançabilidade; o worker volta ao comportamento atual (failover só por `FalhaPreSubmissao` do `lp`, sem detectar host morto — bug conhecido). Nenhuma mudança de schema a reverter.

## Open Questions

- Resolver `.local` via `avahi-resolve-host-name` (dependência explícita de Avahi) ou via `getent hosts` (depende de nsswitch/`mdns` configurado)? Recomendação: tentar `getent` primeiro (sem dependência extra) e, se indisponível, `avahi-resolve`; o TCP-connect final é a prova definitiva.
- Vale embutir a Decisão 3 (cancelar job preso em `connecting-to-device`) já nesta mudança como rede de segurança, ou deixá-la como follow-up? Recomendação: deixar como follow-up opcional — a Decisão 1 resolve o cenário relatado.
- `REACHABILITY_TIMEOUT` deve ser uma única var ou dois timeouts separados (resolução vs. connect)? Recomendação: uma só, simples, padrão ~3s.
