import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PDFDocument } from "pdf-lib";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { mpPayment } from "../_lib/mercadopago.js";

const BUCKET = "pdfs-impressao";

const PIX_VALIDADE_MS = 30 * 60 * 1000; // 30 minutos

// O Mercado Pago exige date_of_expiration em ISO com offset de fuso explícito
// (ex.: 2026-06-02T15:04:05.000-03:00); o "Z" do toISOString() é recusado.
// A Vercel roda em UTC, então montamos a representação no fuso de Brasília
// (-03:00, sem horário de verão) a partir do instante desejado.
function isoComOffsetBrasilia(date: Date): string {
  const offsetMin = -180; // -03:00
  const local = new Date(date.getTime() + offsetMin * 60 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const yyyy = local.getUTCFullYear();
  const MM = p(local.getUTCMonth() + 1);
  const dd = p(local.getUTCDate());
  const HH = p(local.getUTCHours());
  const mm = p(local.getUTCMinutes());
  const ss = p(local.getUTCSeconds());
  const ms = p(local.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${ms}-03:00`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as { pedidoId?: unknown } | undefined;
  const pedidoId = body?.pedidoId;
  if (typeof pedidoId !== "string" || pedidoId.length === 0) {
    return res.status(400).json({ error: "pedidoId obrigatório" });
  }

  const { data: pedido, error: pedidoError } = await supabaseAdmin
    .from("fila_impressao")
    .select("id, status, pdf_path, modo_cor")
    .eq("id", pedidoId)
    .maybeSingle();

  if (pedidoError) {
    console.error("Erro buscando pedido:", pedidoError);
    return res.status(500).json({ error: "Erro interno" });
  }
  if (!pedido) {
    return res.status(404).json({ error: "Pedido não encontrado" });
  }
  if (pedido.status !== "AGUARDANDO_PAGAMENTO") {
    return res.status(409).json({ error: "Pedido não está aguardando pagamento" });
  }

  // ----------------------------------------------------------------------
  // Autoridade do servidor: contar páginas e calcular o preço a partir do
  // PDF real e de config_precos. O que o cliente declarou é ignorado.
  // ----------------------------------------------------------------------
  const { data: pdfBlob, error: downloadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(pedido.pdf_path);

  if (downloadError || !pdfBlob) {
    console.error("Erro baixando PDF do pedido:", pedido.id, downloadError);
    return res.status(502).json({ error: "Não foi possível acessar o arquivo do pedido" });
  }

  let paginasReais: number;
  try {
    const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
    // Sem ignoreEncryption: PDFs criptografados lançam e são rejeitados (422).
    const doc = await PDFDocument.load(bytes);
    paginasReais = doc.getPageCount();
  } catch (err) {
    console.error("PDF inválido/ilegível no pedido:", pedido.id, err);
    return res.status(422).json({ error: "Arquivo PDF inválido, criptografado ou ilegível" });
  }

  if (!Number.isInteger(paginasReais) || paginasReais < 1) {
    return res.status(422).json({ error: "PDF sem páginas válidas" });
  }

  const { data: preco, error: precoError } = await supabaseAdmin
    .from("config_precos")
    .select("valor_centavos_por_pagina")
    .eq("modo_cor", pedido.modo_cor)
    .maybeSingle();

  if (precoError || !preco) {
    console.error("Erro buscando preço para modo_cor:", pedido.modo_cor, precoError);
    return res.status(500).json({ error: "Erro interno" });
  }

  const valorCentavos = paginasReais * preco.valor_centavos_por_pagina;

  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const protocol = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const notificationUrl = `${protocol}://${host}/api/webhooks/mercadopago`;

  try {
    const result = await mpPayment.create({
      body: {
        transaction_amount: valorCentavos / 100,
        description: `Impressão TITANS — ${paginasReais} págs ${pedido.modo_cor}`,
        payment_method_id: "pix",
        payer: {
          email: "cliente@titans.unb.br",
          first_name: "Cliente",
        },
        external_reference: pedido.id,
        notification_url: notificationUrl,
        date_of_expiration: isoComOffsetBrasilia(new Date(Date.now() + PIX_VALIDADE_MS)),
      },
      requestOptions: { idempotencyKey: pedido.id },
    });

    const transactionData = result.point_of_interaction?.transaction_data;
    const qrCodeBase64 = transactionData?.qr_code_base64;
    const qrCodeCopiaCola = transactionData?.qr_code;
    const expiration = result.date_of_expiration;
    const mpPaymentId = result.id ? String(result.id) : null;

    if (!qrCodeBase64 || !qrCodeCopiaCola || !mpPaymentId) {
      console.error("Resposta do MP sem dados de PIX:", result);
      return res.status(502).json({ error: "Mercado Pago não devolveu dados de PIX" });
    }

    // Grava o valor e a contagem autoritativos (do servidor) junto do mp_payment_id.
    const { error: updateError } = await supabaseAdmin
      .from("fila_impressao")
      .update({
        mp_payment_id: mpPaymentId,
        num_paginas: paginasReais,
        valor_centavos: valorCentavos,
      })
      .eq("id", pedido.id);

    if (updateError) {
      console.error("Erro atualizando pedido pós-cobrança:", updateError);
    }

    return res.status(200).json({
      qr_code_base64: qrCodeBase64,
      qr_code_copia_cola: qrCodeCopiaCola,
      expiration_date_to: expiration,
      mp_payment_id: mpPaymentId,
      valor_centavos: valorCentavos,
      num_paginas: paginasReais,
    });
  } catch (err) {
    console.error("Erro chamando Mercado Pago:", err);
    return res.status(502).json({ error: "Falha ao gerar PIX" });
  }
}
