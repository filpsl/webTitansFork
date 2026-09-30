import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import { AVISO_SELECT, mapAviso } from "@/lib/server/calendario";
import { AVISO_SEVERIDADE_VALUES } from "@/lib/calendario/types";
import type { AvisoSeveridade } from "@/lib/calendario/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  titulo?: unknown;
  corpo?: unknown;
  severidade?: unknown;
  inicio?: unknown;
  fim?: unknown;
  eventoId?: unknown;
  publicado?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ avisoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { avisoId } = await params;
  const existente = await prisma.aviso.findUnique({ where: { id: avisoId }, select: { id: true } });
  if (!existente) return Response.json({ error: "Aviso não encontrado" }, { status: 404 });

  const body = (await req.json().catch(() => undefined)) as UpdateBody | undefined;
  if (!body) return Response.json({ error: "Corpo inválido" }, { status: 400 });

  const data: Record<string, unknown> = { atualizadoPorId: session.user.id };
  if (typeof body.titulo === "string" && body.titulo.trim()) data.titulo = body.titulo.trim();
  if (typeof body.corpo === "string" && body.corpo.trim()) data.corpo = body.corpo.trim();
  if (AVISO_SEVERIDADE_VALUES.includes(body.severidade as AvisoSeveridade)) {
    data.severidade = body.severidade;
  }
  if (typeof body.inicio === "string" && body.inicio) data.inicio = new Date(body.inicio);
  if ("fim" in body) data.fim = typeof body.fim === "string" && body.fim ? new Date(body.fim) : null;
  if ("eventoId" in body) {
    data.eventoId = typeof body.eventoId === "string" && body.eventoId ? body.eventoId : null;
  }
  if (typeof body.publicado === "boolean") data.publicado = body.publicado;

  const aviso = await prisma.aviso.update({
    where: { id: avisoId },
    data,
    select: AVISO_SELECT,
  });

  return Response.json({ aviso: mapAviso(aviso) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ avisoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { avisoId } = await params;
  const existente = await prisma.aviso.findUnique({ where: { id: avisoId }, select: { id: true } });
  if (!existente) return Response.json({ error: "Aviso não encontrado" }, { status: 404 });

  await prisma.aviso.delete({ where: { id: avisoId } });
  return Response.json({ ok: true });
}
