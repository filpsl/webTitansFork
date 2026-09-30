import * as z from "zod";
import { ORIGENS_CONTATO } from "@/lib/impressao-3d-schema";

// Caminho esperado dos objetos que o navegador sobe pro bucket `arquivos-3d`
// antes de chamar esta API: "<uuid>/(modelos|fotos)/<nome-sanitizado>". Não é
// uma trava de segurança (o service_role só lê o que está lá), é higiene:
// garante que a linha referencia objetos do próprio upload, não um path
// arbitrário digitado à mão.
const PATH_RE = /^[0-9a-fA-F-]{36}\/(modelos|fotos)\/[^/]+$/;
const caminho = z.string().regex(PATH_RE, "Caminho de arquivo inválido.");

const nome = z.string().min(3).max(200);
const email = z.string().email().max(200);
const telefone = z.string().min(8).max(20);
const origem = z.enum(ORIGENS_CONTATO);

export const pedidoArquivosPayload = z.object({
  tipo: z.literal("ARQUIVOS"),
  nome,
  email,
  telefone,
  origem,
  qualidade: z.string().max(200).optional(),
  observacoes: z.string().max(2000).optional(),
  modelosPaths: z.array(caminho).min(1).max(10),
  fotosPaths: z.array(caminho).min(1).max(10),
});

export const pedidoModelagemPayload = z.object({
  tipo: z.literal("MODELAGEM"),
  nome,
  email,
  telefone,
  origem,
  descricao: z.string().min(20).max(2000),
});

export const pedido3dPayload = z.discriminatedUnion("tipo", [
  pedidoArquivosPayload,
  pedidoModelagemPayload,
]);

export type Pedido3dPayload = z.infer<typeof pedido3dPayload>;
