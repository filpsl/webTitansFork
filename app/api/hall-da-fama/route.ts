import { prisma } from "@/lib/server/prisma";
import { NIVEL_CARTA_ORDER } from "@/lib/nivelCarta";
import type { NivelCarta } from "../../../generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Público — alimenta o link "Hall da Fama" da página inicial, sem exigir login.
export async function GET() {
  const membros = await prisma.user.findMany({
    where: { nivelCarta: { not: null } },
    select: { id: true, nome: true, email: true, role: true, nivelCarta: true },
  });

  const ordenados = [...membros].sort(
    (a, b) =>
      NIVEL_CARTA_ORDER.indexOf(a.nivelCarta as NivelCarta) -
      NIVEL_CARTA_ORDER.indexOf(b.nivelCarta as NivelCarta)
  );

  return Response.json({
    membros: ordenados.map((m) => ({
      id: m.id,
      nome: m.nome ?? m.email,
      role: m.role,
      nivelCarta: m.nivelCarta as NivelCarta,
    })),
  });
}
