import { prisma } from "./prisma";
import type { LogCategoria } from "../../../generated/prisma/enums";

interface RegistrarLogInput {
  usuarioId?: string | null;
  usuarioNome?: string | null;
  usuarioEmail?: string | null;
  categoria: LogCategoria;
  acao: string;
  descricao: string;
  /** Requisição original, quando disponível — extrai IP e user-agent. */
  request?: Request | null;
}

function extrairIp(request: Request | null | undefined): string | null {
  if (!request) return null;
  const encaminhado = request.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

// Best-effort (mesma convenção de enviarConviteDeSenha/registrarAberturaConvite):
// um log que falha não pode derrubar a ação que ele está registrando.
export async function registrarLog(input: RegistrarLogInput): Promise<void> {
  try {
    await prisma.logAtividade.create({
      data: {
        usuarioId: input.usuarioId ?? null,
        usuarioNome: input.usuarioNome ?? null,
        usuarioEmail: input.usuarioEmail ?? null,
        categoria: input.categoria,
        acao: input.acao,
        descricao: input.descricao,
        ip: extrairIp(input.request),
        userAgent: input.request?.headers.get("user-agent") ?? null,
      },
    });
  } catch (err) {
    console.error("Falha ao registrar log de atividade:", err);
  }
}
