import { enviarEmail } from "@/lib/server/email";
import { excedeuLimite } from "@/lib/server/rate-limit";
import {
  feedbackImpressoraSchema,
  PONTO_MELHORAR_LABELS,
} from "@/lib/feedback-impressora-schema";

// Formulário só de acesso por link (/feedback-impressora, sem estar em nenhum
// menu) — feedback específico do serviço de impressão de documentos. Mesmo
// padrão do /api/feedback geral: sem login, sem persistência em banco (o
// e-mail É o registro), então uma falha do Resend vira erro pro cliente.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_TENTATIVAS = 3;
const RATE_LIMIT_JANELA_MS = 10 * 60 * 1000;

const ESCALA_LABELS: Record<string, string> = {
  "0": "0 — Muito ruim/difícil",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5 — Muito bom/fácil",
};

const SIM_NAO_LABELS: Record<string, string> = { sim: "Sim", nao: "Não" };

function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ipDoRequest(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
}

export async function POST(req: Request) {
  const ip = ipDoRequest(req);
  if (excedeuLimite(`feedback-impressora:${ip}`, RATE_LIMIT_TENTATIVAS, RATE_LIMIT_JANELA_MS)) {
    return Response.json(
      { error: "Muitos envios em pouco tempo. Aguarde alguns minutos e tente de novo." },
      { status: 429 }
    );
  }

  const destinatario = process.env.FEEDBACK_EMAIL_EQUIPE;
  if (!destinatario) {
    console.error("FEEDBACK_EMAIL_EQUIPE ausente");
    return Response.json({ error: "config" }, { status: 500 });
  }

  const body = await req.json().catch(() => undefined);
  const parsed = feedbackImpressoraSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const d = parsed.data;

  function linhaSimNao(pergunta: string, resposta: "sim" | "nao", detalhe?: string): string {
    const linha = `<p><strong>${pergunta}</strong> ${SIM_NAO_LABELS[resposta]}</p>`;
    if (!detalhe?.trim()) return linha;
    return `${linha}<p style="margin-left:1rem"><em>${escapeHtml(detalhe.trim())}</em></p>`;
  }

  const linhas = [
    `<h3>Notas gerais</h3>`,
    `<p><strong>Facilidade de enviar o PDF pelo site:</strong> ${ESCALA_LABELS[d.facilidadeUpload]}</p>`,
    `<p><strong>Experiência com o pagamento:</strong> ${ESCALA_LABELS[d.experienciaPagamento]}</p>`,
    `<p><strong>Recomendaria o serviço:</strong> ${ESCALA_LABELS[d.recomendaria]}</p>`,

    `<h3>Detalhes</h3>`,
    linhaSimNao(
      "Encontrou dificuldade, lentidão ou erro no upload?",
      d.dificuldadeUpload,
      d.dificuldadeUploadDetalhe
    ),
    linhaSimNao("As informações no site estavam claras?", d.informacoesClaras, d.informacoesClarasDetalhe),
    linhaSimNao(
      "Foi fácil localizar o local de retirada das folhas?",
      d.localRetiradaFacil,
      d.localRetiradaFacilDetalhe
    ),
    linhaSimNao(
      "Encontrou a impressora logo de cara (intuitivo)?",
      d.impressoraIntuitiva,
      d.impressoraIntuitivaDetalhe
    ),
    linhaSimNao(
      "Impressão com qualidade e formato esperados?",
      d.qualidadeImpressao,
      d.qualidadeImpressaoDetalhe
    ),

    `<h3>Ponto a melhorar</h3>`,
    `<p>${PONTO_MELHORAR_LABELS[d.pontoMelhorar]}${
      d.pontoMelhorar === "outro" && d.pontoMelhorarOutro?.trim()
        ? `: ${escapeHtml(d.pontoMelhorarOutro.trim())}`
        : ""
    }</p>`,
  ];

  if (d.comentarios?.trim()) {
    linhas.push(`<h3>Comentário final</h3>`, `<p>${escapeHtml(d.comentarios.trim())}</p>`);
  }

  const enviado = await enviarEmail({
    to: destinatario,
    subject: "Novo feedback do serviço de impressão — TITANS",
    html: `<h2>Feedback do serviço de impressão</h2>${linhas.join("\n")}`,
  });

  if (!enviado) {
    return Response.json(
      { error: "Não foi possível enviar o feedback agora. Tente novamente em instantes." },
      { status: 502 }
    );
  }

  return Response.json({ ok: true }, { status: 201 });
}
