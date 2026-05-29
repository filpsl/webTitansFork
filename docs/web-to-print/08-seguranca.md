# 08 — Segurança

[← Índice](README.md)

A segurança da feature se apoia em três pilares: **isolamento de segredos por ambiente**,
**validação de assinatura do webhook** e **RLS no Supabase**.

## Segredos por ambiente

| Segredo | Onde vive | Onde **nunca** pode estar |
| --- | --- | --- |
| `VITE_SUPABASE_ANON_KEY` (anon) | Bundle do cliente (é pública por design, restrita por RLS). | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Envs da Vercel **e** `.env` da sede. | No bundle do cliente. Nunca com prefixo `VITE_`. |
| `MERCADOPAGO_ACCESS_TOKEN` | Envs da Vercel. | No cliente. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Envs da Vercel. | No cliente. |

**A `service_role` bypassa RLS** — é a chave-mestra do projeto. Por isso só existe em
ambientes confiáveis (Vercel e sede), nunca no navegador.

- Na Vercel: como variável de ambiente, sem `VITE_` → não entra no bundle. Verificação:
  `grep -r MERCADOPAGO_ACCESS_TOKEN dist/` deve retornar **0** ocorrências.
- Na sede: no `.env` com **`chmod 600`**, propriedade de um **usuário de serviço
  dedicado** (sem login, sem home), lido pelo systemd via `EnvironmentFile`. Nunca
  commitado (está no `.gitignore`).
- **Rotação:** se a `service_role` vazar, rotacione-a no painel do Supabase e atualize os
  dois lugares (Vercel + sede).

## Validação do webhook

O endpoint `/api/webhooks/mercadopago` é **público**. A defesa (ver [04](04-pagamento-pix.md)):

- Recomputa `HMAC_SHA256(MERCADOPAGO_WEBHOOK_SECRET, manifest)` e compara com o `v1` do
  header `x-signature`, em **tempo constante**.
- **Anti-replay:** rejeita timestamps fora de uma janela de **5 minutos**.
- Sem assinatura válida → **401**, sem tocar o banco.

Assim, um terceiro não consegue forjar um "pagamento aprovado" para marcar um pedido como
`PAGO`.

## Garantias de RLS

(Detalhe em [05](05-supabase.md).) O cliente anônimo:

- **Pode** inserir um pedido só em `AGUARDANDO_PAGAMENTO`, com `mp_payment_id`/`paid_at`/
  `printed_at` nulos — não consegue criar um pedido já "pago".
- **Pode** ler uma linha pelo `id`.
- **Não pode** fazer `UPDATE`/`DELETE` — só a `service_role` (webhook/worker) muda status.
- **Não pode** ler PDFs do bucket privado nem listar arquivos — só pode fazer upload.

Toda transição de pagamento e de impressão é, portanto, exclusiva do servidor.

## Pontos de atenção (endereçados pelo hardening)

Itens conhecidos, tratados na mudança companheira `harden-web-to-print-security`:

- **SELECT permissivo** (`using (true)`): quem souber/adivinhar um `id` lê a linha.
  Mitigação prevista: token de leitura separado da PK.
- **Valor calculado no cliente**: `valor_centavos` chega do navegador. Mitigação prevista:
  recalcular no servidor a partir de `config_precos`.
- **Bucket sem limpeza automática**: acumula PDFs. Mitigação prevista: limpeza via
  pg_cron. Enquanto isso, **apagar objetos** (não recriar o bucket, para não arriscar
  torná-lo público).

---

Anterior: [07 — Operação](07-operacao.md) · [↑ Índice](README.md)
