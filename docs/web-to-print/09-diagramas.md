# 09 — Diagramas (UML)

[← Índice](README.md)

Visões UML da feature web-to-print, em **Mermaid** — renderizam direto no GitHub (e no VS Code
com a extensão *Markdown Preview Mermaid Support*). Os diagramas refletem o estado **atual**:
frontend e Route Handlers em **Next.js (App Router)** na Vercel, Supabase como ponto de
encontro, e o `print-worker` na sede.

> Quatro vistas: **implantação** (onde roda), **atividades** (o fluxo de um pedido), **caso de
> uso** (quem faz o quê) e a **máquina de estados** do pedido (complementa o doc
> [02](02-fluxo-pedido.md)).

---

## Diagrama de implantação

Mostra os **nós de execução** (navegador, Vercel, Supabase, sede) e os artefatos que rodam em
cada um, com os canais de comunicação e qual credencial é usada em cada aresta. É o eixo de
segurança da arquitetura: o PDF nunca passa pela Vercel, e só ambientes confiáveis têm a
`service_role`.

```mermaid
flowchart TB
  MP["Mercado Pago"]

  subgraph CLIENTE["Navegador — não confiável"]
    UI["App Next.js / App Router<br/>rota /impressao<br/>anon key + pdfjs-dist"]
  end

  subgraph VERCEL["Vercel — Next.js"]
    RH1["Route Handler<br/>POST /api/payments/create-pix"]
    RH2["Route Handler<br/>POST /api/webhooks/mercadopago"]
  end

  subgraph SUPA["Supabase"]
    ST["Storage<br/>bucket privado pdfs-impressao"]
    DB[("Postgres<br/>fila_impressao + config_precos<br/>RLS + Realtime")]
  end

  subgraph SEDE["Sede — Linux + systemd"]
    PW["print-worker.py"]
    CUPS["CUPS → HP Laser MFP"]
  end

  UI -->|upload PDF anon| ST
  UI -->|INSERT / SELECT anon, RLS| DB
  UI -->|POST pedidoId| RH1
  RH1 -->|service_role: lê PDF e recalcula preço| ST
  RH1 -->|cria cobrança PIX| MP
  MP -->|webhook assinado| RH2
  RH2 -->|service_role: status PAGO / CANCELADO| DB
  DB -->|Realtime UPDATE| UI
  PW -->|claim PAGO → IMPRIMINDO, service_role| DB
  PW -->|baixa PDF, service_role| ST
  PW --> CUPS
```

---

## Diagrama de atividades

O ciclo de vida de um pedido, do upload à impressão, com os pontos de decisão e os desvios de
exceção (PDF inválido, assinatura inválida, expiração do PIX, falha de impressão). As
atividades atravessam quatro responsáveis: **cliente/navegador**, **Route Handlers**,
**Mercado Pago** e **worker da sede**.

```mermaid
flowchart TD
  A([Cliente abre /impressao]) --> B[Enviar PDF]
  B --> C{PDF válido?<br/>tipo + até 30 MB}
  C -->|não| B
  C -->|sim| D[Contar páginas no navegador<br/>pdfjs-dist]
  D --> E[Escolher modo de cor<br/>ver estimativa de preço]
  E --> F[Upload do PDF ao Storage<br/>INSERT pedido = AGUARDANDO_PAGAMENTO]
  F --> G[POST /api/payments/create-pix<br/>servidor reconta páginas e calcula preço]
  G --> H{PDF íntegro<br/>no servidor?}
  H -->|não| Z1([ERRO 422<br/>arquivo inválido])
  H -->|sim| I[Exibir QR Code PIX]
  I --> J[Cliente paga no app do banco]
  J --> K{Webhook do MP<br/>assinatura válida?}
  K -->|não| Z2([401 — ignora])
  K -->|aprovado| L[status = PAGO]
  K -->|cancelado / rejeitado| Z3([status = CANCELADO])
  J -.->|expira em 30 min| Z4([UI: pagamento não confirmado])
  L --> M[Worker: claim atômico<br/>PAGO → IMPRIMINDO]
  M --> N[Baixa PDF e reconfere páginas]
  N --> O{Páginas conferem<br/>e impressão OK?}
  O -->|não| Z5([status = ERRO<br/>tratamento manual])
  O -->|sim| P([status = IMPRESSO])
```

---

## Diagrama de caso de uso

Os atores e o que cada um pode fazer no sistema. Note que **pagar via PIX** dispara, por
*include*, os casos internos do servidor (gerar cobrança, confirmar pagamento, imprimir) — o
cliente nunca os executa diretamente.

```mermaid
flowchart LR
  Cliente(["Cliente"])
  Operador(["Operador da sede"])
  MP(["Mercado Pago"])

  subgraph Sistema["Sistema Web-to-Print"]
    UC1(["Enviar PDF"])
    UC2(["Configurar impressão e ver preço"])
    UC3(["Pagar via PIX"])
    UC4(["Acompanhar status do pedido"])
    UC5(["Gerar cobrança PIX"])
    UC6(["Confirmar pagamento via webhook"])
    UC7(["Imprimir documento"])
    UC8(["Retirar impressão"])
  end

  Cliente --- UC1
  Cliente --- UC2
  Cliente --- UC3
  Cliente --- UC4
  Cliente --- UC8
  Operador --- UC8
  MP --- UC6
  UC3 -.->|inclui| UC5
  UC5 -.->|inclui| UC6
  UC6 -.->|inclui| UC7
```

---

## Máquina de estados do pedido (complemento)

A coluna `fila_impressao.status` é o único ponto de coordenação entre os subsistemas. Versão
renderizável do diagrama em ASCII do doc [02](02-fluxo-pedido.md).

```mermaid
stateDiagram-v2
  [*] --> AGUARDANDO_PAGAMENTO: checkout — anon INSERT
  AGUARDANDO_PAGAMENTO --> PAGO: webhook approved (service_role)
  AGUARDANDO_PAGAMENTO --> CANCELADO: webhook cancelled / rejected
  PAGO --> IMPRIMINDO: worker — claim atômico
  IMPRIMINDO --> IMPRESSO: CUPS concluiu, + printed_at
  IMPRIMINDO --> ERRO: falha / divergência de páginas
  IMPRIMINDO --> PAGO: recuperação — preso > STUCK_TIMEOUT
  CANCELADO --> [*]
  IMPRESSO --> [*]
  ERRO --> [*]
```

---

Anterior: [08 — Segurança](08-seguranca.md) · [↑ Índice](README.md)
