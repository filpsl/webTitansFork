import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import { EVENTO_SELECT, mapEvento } from "@/lib/server/calendario";
import { EVENTO_STATUS_VALUES } from "@/lib/calendario/types";
import type { EventoStatus } from "@/lib/calendario/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  titulo?: unknown;
  tipoSlug?: unknown;
  status?: unknown;
  inicio?: unknown;
  fim?: unknown;
  diaTodo?: unknown;
  local?: unknown;
  linkReuniao?: unknown;
  responsavel?: unknown;
  descricao?: unknown;
  importante?: unknown;
  projetoIds?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { eventoId } = await params;
  const existente = await prisma.evento.findUnique({ where: { id: eventoId }, select: { id: true } });
  if (!existente) return Response.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = (await req.json().catch(() => undefined)) as UpdateBody | undefined;
  if (!body) return Response.json({ error: "Corpo inválido" }, { status: 400 });

  if (typeof body.tipoSlug === "string" && body.tipoSlug) {
    const tipo = await prisma.tipoEvento.findUnique({
      where: { slug: body.tipoSlug },
      select: { slug: true },
    });
    if (!tipo) return Response.json({ error: "Tipo de evento inválido" }, { status: 400 });
  }

  const data: Record<string, unknown> = { atualizadoPorId: session.user.id };
  if (typeof body.titulo === "string" && body.titulo.trim()) data.titulo = body.titulo.trim();
  if (typeof body.tipoSlug === "string" && body.tipoSlug) data.tipoSlug = body.tipoSlug;
  if (EVENTO_STATUS_VALUES.includes(body.status as EventoStatus)) data.status = body.status;
  if (typeof body.inicio === "string" && body.inicio) data.inicio = new Date(body.inicio);
  if ("fim" in body) data.fim = typeof body.fim === "string" && body.fim ? new Date(body.fim) : null;
  if (typeof body.diaTodo === "boolean") data.diaTodo = body.diaTodo;
  if ("local" in body) data.local = typeof body.local === "string" && body.local.trim() ? body.local.trim() : null;
  if ("linkReuniao" in body) {
    data.linkReuniao =
      typeof body.linkReuniao === "string" && body.linkReuniao.trim() ? body.linkReuniao.trim() : null;
  }
  if ("responsavel" in body) {
    data.responsavel =
      typeof body.responsavel === "string" && body.responsavel.trim() ? body.responsavel.trim() : null;
  }
  if ("descricao" in body) {
    data.descricao =
      typeof body.descricao === "string" && body.descricao.trim() ? body.descricao.trim() : null;
  }
  if (typeof body.importante === "boolean") data.importante = body.importante;
  if (Array.isArray(body.projetoIds)) {
    const projetoIds = body.projetoIds.filter((id): id is string => typeof id === "string");
    data.projetos = { set: projetoIds.map((id) => ({ id })) };
  }

  const evento = await prisma.evento.update({
    where: { id: eventoId },
    data,
    select: EVENTO_SELECT,
  });

  return Response.json({ evento: mapEvento(evento) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { eventoId } = await params;
  const existente = await prisma.evento.findUnique({ where: { id: eventoId }, select: { id: true } });
  if (!existente) return Response.json({ error: "Evento não encontrado" }, { status: 404 });

  await prisma.evento.delete({ where: { id: eventoId } });
  return Response.json({ ok: true });
}
