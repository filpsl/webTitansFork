import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isMestre, isGerenteOuSuperior, gerarSenhaPlaceholder, hashSenha } from "@/lib/server/admin";
import { enviarConviteDeSenha } from "@/lib/server/convite";
import { ROLE_ORDER } from "@/lib/roles";
import { STATUS_MEMBRO_ORDER } from "@/lib/statusMembro";
import { NIVEL_CARTA_ORDER } from "@/lib/nivelCarta";
import type { Role, StatusMembro, NivelCarta } from "../../../../generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // Capitão, Vice-Capitão e Gerente de Projeto também podem consultar o
  // quadro de membros — quem edita/cadastra/remove é definido nas rotas de
  // escrita abaixo (ver POST e as rotas em [userId]/*).
  if (!isGerenteOuSuperior(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const [membros, tokensValidos] = await Promise.all([
    prisma.user.findMany({
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        status: true,
        nivelCarta: true,
        curso: true,
        semestre: true,
        conviteAbertoEm: true,
        projetos: { select: { id: true, nome: true } },
      },
    }),
    // E-mails com um convite pendente (token ainda não usado nem expirado) —
    // é o que diferencia "ainda não abriu" de "não há convite em aberto".
    prisma.verificationToken.findMany({
      where: { expires: { gt: new Date() } },
      select: { identifier: true },
    }),
  ]);

  const emailsComConvitePendente = new Set(tokensValidos.map((t) => t.identifier));
  const membrosComSinal = membros.map((m) => ({
    ...m,
    convitePendente: emailsComConvitePendente.has(m.email),
  }));

  return Response.json({ membros: membrosComSinal });
}

interface CreateBody {
  nome?: unknown;
  email?: unknown;
  role?: unknown;
  status?: unknown;
  nivelCarta?: unknown;
  curso?: unknown;
  semestre?: unknown;
  projetoIds?: unknown;
  /** Cadastro manual: MESTRE define a senha na hora, sem passar pelo convite por e-mail. */
  senha?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isMestre(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as CreateBody | undefined;

  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = ROLE_ORDER.includes(body?.role as Role) ? (body?.role as Role) : null;

  if (!nome || !email || !role) {
    return Response.json({ error: "Preencha nome, email e cargo" }, { status: 400 });
  }

  const status: StatusMembro = STATUS_MEMBRO_ORDER.includes(body?.status as StatusMembro)
    ? (body?.status as StatusMembro)
    : "ATIVO";
  const nivelCarta: NivelCarta | null = NIVEL_CARTA_ORDER.includes(body?.nivelCarta as NivelCarta)
    ? (body?.nivelCarta as NivelCarta)
    : null;
  const curso = typeof body?.curso === "string" && body.curso.trim() ? body.curso.trim() : null;
  const semestre =
    typeof body?.semestre === "number" && Number.isInteger(body.semestre)
      ? body.semestre
      : null;
  const projetoIds = Array.isArray(body?.projetoIds)
    ? body.projetoIds.filter((id): id is string => typeof id === "string")
    : [];

  const senhaManual = typeof body?.senha === "string" ? body.senha : "";
  if (senhaManual && senhaManual.length < 8) {
    return Response.json({ error: "A senha precisa ter pelo menos 8 caracteres" }, { status: 400 });
  }

  const existente = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existente) {
    return Response.json({ error: "Já existe um membro com esse e-mail" }, { status: 409 });
  }

  const hash = senhaManual ? await hashSenha(senhaManual) : await gerarSenhaPlaceholder();
  const membro = await prisma.user.create({
    data: {
      nome,
      email,
      password: hash,
      role,
      status,
      nivelCarta,
      curso,
      semestre,
      projetos: { connect: projetoIds.map((id) => ({ id })) },
    },
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      status: true,
      nivelCarta: true,
      curso: true,
      semestre: true,
      conviteAbertoEm: true,
      projetos: { select: { id: true, nome: true } },
    },
  });

  // Cadastro manual: o MESTRE já definiu a senha, não faz sentido mandar convite pra criar outra.
  const emailEnviado = senhaManual ? null : await enviarConviteDeSenha(email, nome);

  return Response.json({ membro, emailEnviado }, { status: 201 });
}
