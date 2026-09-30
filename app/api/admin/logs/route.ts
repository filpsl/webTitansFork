import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isMestre } from "@/lib/server/admin";
import { LOG_CATEGORIA_ORDER } from "@/lib/log";
import type { Prisma } from "../../../../generated/prisma/client";
import type { LogCategoria } from "../../../../generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // Quadro de logs é só do Mestre — inclui tentativas de login e erros de acesso de qualquer membro.
  if (!isMestre(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const url = new URL(req.url);
  const categoriaParam = url.searchParams.get("categoria");
  const q = url.searchParams.get("q")?.trim();
  const pagina = Math.max(1, Number.parseInt(url.searchParams.get("pagina") ?? "1", 10) || 1);

  const where: Prisma.LogAtividadeWhereInput = {};
  if (categoriaParam && LOG_CATEGORIA_ORDER.includes(categoriaParam as LogCategoria)) {
    where.categoria = categoriaParam as LogCategoria;
  }
  if (q) {
    where.OR = [
      { usuarioNome: { contains: q, mode: "insensitive" } },
      { usuarioEmail: { contains: q, mode: "insensitive" } },
      { descricao: { contains: q, mode: "insensitive" } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.logAtividade.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      skip: (pagina - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        criadoEm: true,
        usuarioNome: true,
        usuarioEmail: true,
        categoria: true,
        acao: true,
        descricao: true,
        ip: true,
      },
    }),
    prisma.logAtividade.count({ where }),
  ]);

  return Response.json({
    logs: logs.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString() })),
    total,
    pagina,
    totalPaginas: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
