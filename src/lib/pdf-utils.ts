import * as pdfjsLib from "pdfjs-dist";
// Vite resolve o worker para uma URL servível no bundle.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// 30 MB: alinhado ao file_size_limit do bucket pdfs-impressao e ao teto que o
// create-pix consegue baixar e contar dentro do limite de 10s da Vercel.
export const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB

export type ValidacaoPDF =
  | { ok: true }
  | { ok: false; mensagem: string };

export function validarArquivoPDF(file: File): ValidacaoPDF {
  if (file.type !== "application/pdf") {
    return { ok: false, mensagem: "Apenas arquivos PDF são aceitos." };
  }
  if (file.size > MAX_PDF_BYTES) {
    return { ok: false, mensagem: "Arquivo excede o limite de 30 MB." };
  }
  return { ok: true };
}

export async function contarPaginas(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  await pdf.destroy();
  return total;
}
