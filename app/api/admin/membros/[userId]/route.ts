import bcrypt from "bcryptjs";
import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isMestre, podeEditarMembros } from "@/lib/server/admin";
import { ROLE_ORDER } from "@/lib/roles";
import { STATUS_MEMBRO_ORDER } from "@/lib/statusMembro";
import { NIVEL_CARTA_ORDER } from "@/lib/nivelCarta";
import type { Role, StatusMembro, NivelCarta } from "../../../../../generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  nome?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  status?: unknown;
  nivelCarta?: unknown;
  curso?: unknown;
  semestre?: unknown;
  projetoIds?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // MESTRE e CAPITAO corrigem dados — cadastrar/remover continua só com o MESTRE.
  if (!podeEditarMembros(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { userId } = await params;
  const body = (await req.json().catch(() => undefined)) as UpdateBody | undefined;
  if (!body) return Response.json({ error: "Corpo inválido" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.nome === "string" && body.nome.trim()) data.nome = body.nome.trim();
  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    const existente = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existente && existente.id !== userId) {
      return Response.json({ error: "Já existe um membro com esse e-mail" }, { status: 409 });
    }
    data.email = email;
  }
  if (ROLE_ORDER.includes(body.role as Role)) data.role = body.role as Role;
  if (STATUS_MEMBRO_ORDER.includes(body.status as StatusMembro)) {
    data.status = body.status as StatusMembro;
  }
  if ("nivelCarta" in body) {
    data.nivelCarta = NIVEL_CARTA_ORDER.includes(body.nivelCarta as NivelCarta)
      ? (body.nivelCarta as NivelCarta)
      : null;
  }
  if ("curso" in body) {
    data.curso = typeof body.curso === "string" && body.curso.trim() ? body.curso.trim() : null;
  }
  if ("semestre" in body) {
    data.semestre =
      typeof body.semestre === "number" && Number.isInteger(body.semestre)
        ? body.semestre
        : null;
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) {
      return Response.json({ error: "Senha precisa ter ao menos 8 caracteres" }, { status: 400 });
    }
    data.password = await bcrypt.hash(body.password, 12);
  }
  if (Array.isArray(body.projetoIds)) {
    const ids = body.projetoIds.filter((id): id is string => typeof id === "string");
    data.projetos = { set: ids.map((id) => ({ id })) };
  }

  const membro = await prisma.user.update({
    where: { id: userId },
    data,
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

  return Response.json({ membro });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isMestre(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { userId } = await params;
  if (userId === session.user.id) {
    return Response.json({ error: "Você não pode remover a si mesmo" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id: userId } });
  return Response.json({ ok: true });
}
