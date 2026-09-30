import crypto from "node:crypto";
import { prisma } from "./prisma";
import { enviarEmail } from "./email";

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function montarHtmlConvite(nome: string | null, link: string): string {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  return `
    <p>${saudacao}</p>
    <p>Você foi cadastrado(a) na área de membros da Robotics Titans. Clique no link abaixo pra criar sua senha de acesso:</p>
    <p><a href="${link}">${link}</a></p>
    <p>Esse link expira em 7 dias.</p>
  `;
}

// Best-effort (mesma convenção de notificarEquipeSobreReimpressao): o membro
// já foi cadastrado mesmo que o e-mail falhe — o MESTRE pode reenviar o
// convite pelo painel. Gera um token de uso único (verification_tokens, o
// mesmo model padrão do Auth.js) e nunca lança — quem chama decide como
// reagir ao boolean devolvido (ver reenviar-convite/route.ts).
export async function enviarConviteDeSenha(email: string, nome: string | null): Promise<boolean> {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + VALIDADE_MS);

  // Remove convites antigos pendentes pro mesmo e-mail — só o link mais
  // recente deve funcionar.
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  await prisma.verificationToken.create({ data: { identifier: email, token, expires } });
  // Zera o sinal de "abriu o link" — é sobre o convite vigente, não um antigo.
  await prisma.user.updateMany({ where: { email }, data: { conviteAbertoEm: null } });

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const link = `${baseUrl}/definir-senha?token=${token}`;

  const ok = await enviarEmail({
    to: email,
    subject: "Robotics Titans — defina sua senha",
    html: montarHtmlConvite(nome, link),
  });
  if (!ok) {
    console.error(`Falha ao enviar convite de senha para ${email}`);
  }
  return ok;
}

// Chamado pela página /definir-senha ao carregar com um token — registra a
// primeira abertura do link (sinal exibido em Gerenciar Membros). Best-effort
// e idempotente: só grava a primeira vez (conviteAbertoEm: null na cláusula
// where), nunca lança — abrir a página nunca pode quebrar por causa disso.
export async function registrarAberturaConvite(token: string): Promise<void> {
  try {
    const registro = await prisma.verificationToken.findUnique({ where: { token } });
    if (!registro || registro.expires < new Date()) return;

    await prisma.user.updateMany({
      where: { email: registro.identifier, conviteAbertoEm: null },
      data: { conviteAbertoEm: new Date() },
    });
  } catch (err) {
    console.error("Falha ao registrar abertura do convite:", err);
  }
}
