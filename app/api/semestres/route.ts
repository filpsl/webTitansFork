import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import { mapSemestre } from "@/lib/server/calendario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEMESTRE_SELECT = {
  id: true,
  nome: true,
  inicio: true,
  fim: true,
  ativo: true,
  arquivadoEm: true,
} as const;

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const semestres = await prisma.semestre.findMany({
    orderBy: { inicio: "desc" },
    select: SEMESTRE_SELECT,
  });

  return Response.json({ semestres: semestres.map(mapSemestre) });
}

interface CreateBody {
  nome?: unknown;
  inicio?: unknown;
  fim?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as CreateBody | undefined;

  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const inicio = typeof body?.inicio === "string" && body.inicio ? new Date(body.inicio) : null;
  const fim = typeof body?.fim === "string" && body.fim ? new Date(body.fim) : null;

  if (!nome || !inicio || !fim) {
    return Response.json({ error: "Preencha nome, início e fim" }, { status: 400 });
  }
  if (fim.getTime() <= inicio.getTime()) {
    return Response.json({ error: "A data de fim precisa ser depois do início" }, { status: 400 });
  }

  const existente = await prisma.semestre.findUnique({ where: { nome }, select: { id: true } });
  if (existente) {
    return Response.json({ error: "Já existe um semestre com esse nome" }, { status: 409 });
  }

  const semestre = await prisma.semestre.create({
    data: { nome, inicio, fim },
    select: SEMESTRE_SELECT,
  });

  return Response.json({ semestre: mapSemestre(semestre) }, { status: 201 });
}
