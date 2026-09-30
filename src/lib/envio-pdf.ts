import { StorageApiError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const BUCKET = "pdfs-impressao";

// 3 tentativas no total; espera antes da 2ª e da 3ª.
const ESPERAS_MS = [1_000, 3_000];

export const MSG_CONEXAO =
  "Falha no envio, tente novamente. Confira sua internet e mantenha esta tela aberta até o QR Code aparecer.";
const MSG_RECUSADO = "O arquivo foi recusado. Confira se é um PDF de até 30 MB.";

// Falha do checkout já traduzida para o cliente. `codigo` identifica a etapa
// que falhou (ex.: ENVIO-REDE, PIX-500) e aparece no toast — é o que chega no
// print quando alguém reclama, já que o console fica no celular da pessoa.
export class ErroCheckout extends Error {
  readonly codigo: string;
  readonly causa: unknown;

  constructor(mensagem: string, codigo: string, causa?: unknown) {
    super(mensagem);
    this.name = "ErroCheckout";
    this.codigo = codigo;
    this.causa = causa;
  }
}

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sem resposta HTTP (StorageUnknownError: rede caiu, aba congelada), servidor
// indisponível (5xx) ou timeout/limite de taxa (408/429): outra tentativa pode
// dar certo. Os demais 4xx são recusas (tipo, tamanho, RLS) — repetir não muda
// o resultado.
function valeRepetir(error: Error): boolean {
  if (!(error instanceof StorageApiError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

// O objeto já existe: numa nova tentativa, significa que a anterior chegou ao
// Storage e só a resposta se perdeu. O caminho é único por pedido (UUID), então
// ninguém mais escreveria nele. Versões do Storage respondem 409 ou 400 com
// statusCode "409".
function jaExiste(error: Error): boolean {
  return (
    error instanceof StorageApiError &&
    (error.status === 409 || error.statusCode === "409")
  );
}

function codigoDaFalha(error: Error): string {
  return error instanceof StorageApiError ? `ENVIO-${error.status}` : "ENVIO-REDE";
}

// Sobe o PDF do pedido, repetindo só as falhas transitórias. O mesmo pdfPath é
// reusado entre as tentativas e upsert=false impede sobrescrita (anon só tem
// INSERT no bucket), então repetir nunca duplica nem troca o arquivo.
export async function enviarPDF(pdfPath: string, file: File): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, file, { contentType: "application/pdf", upsert: false });
    if (!error) return;
    if (tentativa > 0 && jaExiste(error)) return;

    const codigo = codigoDaFalha(error);
    if (!valeRepetir(error)) throw new ErroCheckout(MSG_RECUSADO, codigo, error);
    if (tentativa >= ESPERAS_MS.length) throw new ErroCheckout(MSG_CONEXAO, codigo, error);

    console.warn(
      `Upload do PDF falhou (${codigo}); nova tentativa em ${ESPERAS_MS[tentativa]} ms`,
      error
    );
    await esperar(ESPERAS_MS[tentativa]);
  }
}
