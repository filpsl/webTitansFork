import type { PlayerCardVariant } from "@/components/PlayerCard";
import { NivelCarta } from "../../generated/prisma/enums";

/** Do nível mais alto pro mais baixo — mesma ordem em que aparecem no Hall da Fama. */
export const NIVEL_CARTA_ORDER: NivelCarta[] = [
  "ICONE",
  "LENDA",
  "MESTRE",
  "ESMERALDA",
  "PLATINA",
  "PRATA",
];

export const NIVEL_CARTA_LABELS: Record<NivelCarta, string> = {
  ICONE: "Ícone",
  LENDA: "Lenda",
  MESTRE: "Mestre",
  ESMERALDA: "Esmeralda",
  PLATINA: "Platina",
  PRATA: "Prata",
};

/** Mapeia o nível pra variante de cor das cartas já usadas no Seguidor de Linha. */
export const NIVEL_CARTA_VARIANT: Record<NivelCarta, PlayerCardVariant> = {
  ICONE: "icon",
  LENDA: "purple",
  MESTRE: "gold",
  ESMERALDA: "emerald",
  PLATINA: "teal",
  PRATA: "silver",
};

/**
 * Nota-base exibida na carta por nível — não há avaliação individual real por
 * membro (o cadastro só guarda o nível), então a nota e os atributos da carta
 * seguem esse valor fixo por faixa.
 */
export const NIVEL_CARTA_RATING: Record<NivelCarta, number> = {
  ICONE: 99,
  LENDA: 95,
  MESTRE: 90,
  ESMERALDA: 85,
  PLATINA: 80,
  PRATA: 75,
};
