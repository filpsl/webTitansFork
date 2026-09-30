import { enviarEmail } from "@/lib/server/email";
import { excedeuLimite } from "@/lib/server/rate-limit";
import { feedbackSchema } from "@/lib/feedback-schema";

// Alimenta duas telas ao mesmo tempo: a página pública/anônima /feedback
// (sem login) e a aba "Feedback" do painel de membro em /equipe (atrás de
// login). Por isso essa rota continua sem exigir sessão — se um dia a página
// pública sair de cena, dá pra exigir auth() aqui também. O e-mail é a única
// forma de o feedback chegar em algum lugar (não há persistência em banco),
// por isso, diferente de outros envios "best-effort" do projeto, uma falha
// do Resend vira erro pro cliente em vez de um post declarado sem base.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_TENTATIVAS = 3;
const RATE_LIMIT_JANELA_MS = 10 * 60 * 1000;

const ESCALA_LABELS: Record<string, string> = {
  "1": "1 — Discordo totalmente",
  "2": "2",
  "3": "3 — Neutro",
  "4": "4",
  "5": "5 — Concordo totalmente",
};

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
  if (excedeuLimite(`feedback:${ip}`, RATE_LIMIT_TENTATIVAS, RATE_LIMIT_JANELA_MS)) {
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
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const dados = parsed.data;

  const linhas = [
    `<p><strong>Se sente bem acolhido(a) na equipe:</strong> ${ESCALA_LABELS[dados.welcomed]}</p>`,
    `<p><strong>Comunicação da equipe é clara:</strong> ${ESCALA_LABELS[dados.communication]}</p>`,
    `<p><strong>Entende bem as responsabilidades:</strong> ${ESCALA_LABELS[dados.responsibilities]}</p>`,
    `<p><strong>Sente que está aprendendo e evoluindo:</strong> ${ESCALA_LABELS[dados.learning]}</p>`,
    `<p><strong>Avaliação da organização da equipe:</strong> ${ESCALA_LABELS[dados.organization]}</p>`,
    `<p><strong>O que mais funciona bem:</strong><br/>${escapeHtml(dados.workingWell)}</p>`,
    `<p><strong>O que precisa melhorar:</strong><br/>${escapeHtml(dados.toImprove)}</p>`,
  ];
  if (dados.comments?.trim()) {
    linhas.push(`<p><strong>Sugestão final:</strong><br/>${escapeHtml(dados.comments.trim())}</p>`);
  }

  const enviado = await enviarEmail({
    to: destinatario,
    subject: "Novo feedback anônimo — TITANS",
    html: `<h2>Feedback anônimo da equipe</h2>${linhas.join("\n")}`,
  });

  if (!enviado) {
    return Response.json(
      { error: "Não foi possível enviar o feedback agora. Tente novamente em instantes." },
      { status: 502 }
    );
  }

  return Response.json({ ok: true }, { status: 201 });
}
