import { prisma } from "@/lib/server/prisma";
import { enviarMensagemTelegram } from "@/lib/server/telegram";
import { enviarEmail } from "@/lib/server/email";
import { supabaseAdminTitans } from "@/lib/server/supabase-admin-titans";
import { excedeuLimite } from "@/lib/server/rate-limit";
import { pedido3dPayload } from "@/lib/server/pedidos-3d-schema";

// Recebe os dois formulários de /servicos/impressao-3d (ARQUIVOS e MODELAGEM).
// Server-side via Prisma (mesmo projeto Postgres TITANS do login/membros —
// separado do projeto Supabase legado da camada IMPRESSORA): pedidos_3d tem
// RLS sem policy, então só a conexão do Prisma (dona da tabela) grava. Os
// arquivos já foram subidos direto pro bucket `arquivos-3d` do Storage pelo
// navegador antes desta chamada (via supabase-titans, chave publishable);
// aqui só chegam os caminhos — a própria API os baixa de volta (chave secreta,
// supabase-admin-titans) pra anexar no e-mail de aviso da equipe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "arquivos-3d";

// Resend recusa e-mails acima de ~40 MB (corpo + anexos já em base64, que
// infla os bytes crus em ~33%). Ficamos bem abaixo somando os bytes crus.
const LIMITE_ANEXOS_BYTES = 20 * 1024 * 1024; // 20 MB

const RATE_LIMIT_TENTATIVAS = 5;
const RATE_LIMIT_JANELA_MS = 10 * 60 * 1000;

function ipDoRequest(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
}

function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type DadosNotificacao = {
  id: string;
  tipo: "ARQUIVOS" | "MODELAGEM";
  nome: string;
  email: string;
  telefone: string;
  origem: string;
  qualidade: string | null;
  descricao: string | null;
  observacoes: string | null;
  modelosPaths: string[];
  fotosPaths: string[];
};

// Best-effort: falha na notificação nunca impede a persistência do pedido.
async function notificarTelegram(pedido: DadosNotificacao) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const protocolo = pedido.id.slice(0, 8).toUpperCase();
  const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const titulo =
    pedido.tipo === "ARQUIVOS"
      ? "🧊 Novo pedido de impressão 3D (arquivos prontos)"
      : "🧊 Novo pedido de modelagem 3D";

  const texto =
    `${titulo}\n` +
    `Protocolo: ${protocolo}\n` +
    `Nome: ${pedido.nome}\n` +
    `E-mail: ${pedido.email}\n` +
    `Telefone: ${pedido.telefone}\n` +
    `Conheceu por: ${pedido.origem}\n` +
    `Horário: ${quando}`;

  await enviarMensagemTelegram({ chatId, texto });
}

// Baixa cada arquivo do bucket privado — falha em um arquivo isolado não
// derruba os demais nem a notificação.
async function baixarAnexos(paths: string[]): Promise<{ filename: string; content: Buffer }[]> {
  const anexos: { filename: string; content: Buffer }[] = [];
  for (const path of paths) {
    try {
      const { data, error } = await supabaseAdminTitans.storage.from(BUCKET).download(path);
      if (error || !data) {
        console.error("Falha ao baixar anexo do pedido 3D:", path, error);
        continue;
      }
      anexos.push({
        filename: path.split("/").pop() ?? path,
        content: Buffer.from(await data.arrayBuffer()),
      });
    } catch (err) {
      console.error("Erro baixando anexo do pedido 3D:", path, err);
    }
  }
  return anexos;
}

// Best-effort: falha na notificação nunca impede a persistência do pedido.
async function notificarEmail(pedido: DadosNotificacao) {
  const destinatario = process.env.PEDIDOS_3D_EMAIL_EQUIPE;
  if (!destinatario) return;

  const protocolo = pedido.id.slice(0, 8).toUpperCase();
  const linhas = [
    `<p><strong>Protocolo:</strong> ${protocolo}</p>`,
    `<p><strong>Tipo:</strong> ${pedido.tipo === "ARQUIVOS" ? "Já tem os arquivos" : "Precisa de modelagem"}</p>`,
    `<p><strong>Nome:</strong> ${escapeHtml(pedido.nome)}</p>`,
    `<p><strong>E-mail:</strong> ${escapeHtml(pedido.email)}</p>`,
    `<p><strong>Telefone:</strong> ${escapeHtml(pedido.telefone)}</p>`,
    `<p><strong>Por onde conheceu:</strong> ${escapeHtml(pedido.origem)}</p>`,
  ];
  if (pedido.qualidade) {
    linhas.push(`<p><strong>Qualidade desejada:</strong> ${escapeHtml(pedido.qualidade)}</p>`);
  }
  if (pedido.observacoes) {
    linhas.push(`<p><strong>Observações:</strong> ${escapeHtml(pedido.observacoes)}</p>`);
  }
  if (pedido.descricao) {
    linhas.push(`<p><strong>Descrição do que precisa:</strong> ${escapeHtml(pedido.descricao)}</p>`);
  }

  let anexos: { filename: string; content: Buffer }[] | undefined;
  const caminhos = [...pedido.modelosPaths, ...pedido.fotosPaths];
  if (caminhos.length > 0) {
    const baixados = await baixarAnexos(caminhos);
    const totalBytes = baixados.reduce((soma, a) => soma + a.content.byteLength, 0);
    if (baixados.length > 0 && totalBytes <= LIMITE_ANEXOS_BYTES) {
      anexos = baixados;
    } else {
      // Arquivo grande demais (ou falhou o download): não bloqueia o e-mail,
      // só avisa onde a equipe encontra o arquivo original.
      linhas.push(
        `<p><strong>Arquivos</strong> (grandes demais pra anexar — baixe no painel do ` +
          `Supabase, bucket <code>arquivos-3d</code>):</p>` +
          `<ul>${caminhos.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
      );
    }
  }

  const assunto =
    pedido.tipo === "ARQUIVOS"
      ? `Novo pedido de impressão 3D — ${protocolo}`
      : `Novo pedido de modelagem 3D — ${protocolo}`;

  await enviarEmail({
    to: destinatario,
    subject: assunto,
    html: `<h2>${assunto}</h2>${linhas.join("\n")}`,
    attachments: anexos,
  });
}

export async function POST(req: Request) {
  const ip = ipDoRequest(req);
  if (excedeuLimite(`pedido-3d:${ip}`, RATE_LIMIT_TENTATIVAS, RATE_LIMIT_JANELA_MS)) {
    return Response.json(
      { error: "Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => undefined);
  const parsed = pedido3dPayload.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const dados = parsed.data;

  let pedido: { id: string };
  try {
    pedido = await prisma.pedidoImpressao3D.create({
      data: {
        tipo: dados.tipo,
        nome: dados.nome,
        email: dados.email,
        telefone: dados.telefone,
        origem: dados.origem,
        qualidade: dados.tipo === "ARQUIVOS" ? dados.qualidade || null : null,
        observacoes: dados.tipo === "ARQUIVOS" ? dados.observacoes || null : null,
        modelosPaths: dados.tipo === "ARQUIVOS" ? dados.modelosPaths : [],
        fotosPaths: dados.tipo === "ARQUIVOS" ? dados.fotosPaths : [],
        descricao: dados.tipo === "MODELAGEM" ? dados.descricao : null,
      },
      select: { id: true },
    });
  } catch (err) {
    console.error("Erro registrando pedido 3D:", err);
    return Response.json({ error: "Erro interno" }, { status: 500 });
  }

  const dadosNotificacao: DadosNotificacao = {
    id: pedido.id,
    tipo: dados.tipo,
    nome: dados.nome,
    email: dados.email,
    telefone: dados.telefone,
    origem: dados.origem,
    qualidade: dados.tipo === "ARQUIVOS" ? dados.qualidade || null : null,
    observacoes: dados.tipo === "ARQUIVOS" ? dados.observacoes || null : null,
    descricao: dados.tipo === "MODELAGEM" ? dados.descricao : null,
    modelosPaths: dados.tipo === "ARQUIVOS" ? dados.modelosPaths : [],
    fotosPaths: dados.tipo === "ARQUIVOS" ? dados.fotosPaths : [],
  };

  await Promise.all([notificarTelegram(dadosNotificacao), notificarEmail(dadosNotificacao)]);

  return Response.json(
    { ok: true, protocolo: pedido.id.slice(0, 8).toUpperCase() },
    { status: 201 }
  );
}
