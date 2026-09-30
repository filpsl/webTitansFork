/** Normaliza texto pra comparação tolerante a acento/caixa (ex.: import de .txt). */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .trim()
    .replace(/[áàâã]/g, "a")
    .replace(/[éê]/g, "e")
    .replace(/[íî]/g, "i")
    .replace(/[óôõ]/g, "o")
    .replace(/[úû]/g, "u")
    .replace(/ç/g, "c");
}
