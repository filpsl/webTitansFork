"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy } from "lucide-react";
import { PlayerCard, type PlayerCardStat } from "@/components/PlayerCard";
import {
  NIVEL_CARTA_ORDER,
  NIVEL_CARTA_LABELS,
  NIVEL_CARTA_VARIANT,
  NIVEL_CARTA_RATING,
} from "@/lib/nivelCarta";
import type { NivelCarta, Role } from "../../generated/prisma/enums";

interface MembroFama {
  id: string;
  nome: string;
  role: Role;
  nivelCarta: NivelCarta;
}

/** "Posição" mostrada na carta — sigla do cargo real do membro. */
const POSICAO_POR_CARGO: Record<Role, string> = {
  MESTRE: "MST",
  CAPITAO: "CAP",
  VICE_CAPITAO: "VCP",
  GERENTE_PROJETO: "GER",
  INSTRUTOR: "INS",
  MEMBRO_PROJETO: "MEM",
  MEMBRO_TEMPORARIO: "TMP",
};

/**
 * Não existe avaliação individual real por membro — o cadastro só guarda o
 * nível — então os 6 atributos da carta seguem a nota-base do nível.
 */
function statsGenericos(rating: number): PlayerCardStat[] {
  return [
    { label: "CTR", value: rating },
    { label: "MAP", value: rating },
    { label: "VEL", value: rating },
    { label: "SEN", value: rating },
    { label: "COD", value: rating },
    { label: "DBG", value: rating },
  ];
}

const HallDaFama = () => {
  const [membros, setMembros] = useState<MembroFama[] | null>(null);

  useEffect(() => {
    fetch("/api/hall-da-fama")
      .then((r) => r.json())
      .then((data: { membros: MembroFama[] }) => setMembros(data.membros))
      .catch(() => setMembros([]));
  }, []);

  const porNivel = new Map<NivelCarta, MembroFama[]>();
  for (const m of membros ?? []) {
    const lista = porNivel.get(m.nivelCarta) ?? [];
    lista.push(m);
    porNivel.set(m.nivelCarta, lista);
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="bg-gradient-to-b from-background to-muted/20 pb-16 pt-20">
        <div className="container mx-auto px-4 text-center sm:px-6 lg:px-8">
          <Badge className="mb-4 bg-gradient-to-r from-titans-red to-titans-orange text-white">
            Reconhecimento
          </Badge>
          <h1 className="mb-6 text-4xl font-bold md:text-6xl">
            <span className="bg-gradient-to-r from-titans-red to-titans-orange bg-clip-text text-transparent">
              Hall da Fama
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            Os membros que marcaram história na TITANS, reconhecidos pela dedicação e pelo impacto
            na equipe.
          </p>
        </div>
      </section>

      <section className="pb-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {!membros ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando o Hall da Fama...
            </div>
          ) : membros.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <Trophy className="h-10 w-10" />
              <p>Ainda ninguém entrou pro Hall da Fama.</p>
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-16">
              {NIVEL_CARTA_ORDER.map((nivel) => {
                const doNivel = porNivel.get(nivel);
                if (!doNivel || doNivel.length === 0) return null;
                return (
                  <div key={nivel}>
                    <div className="mb-8 text-center">
                      <h2 className="text-2xl font-bold sm:text-3xl">
                        {NIVEL_CARTA_LABELS[nivel]}
                      </h2>
                      <div className="mx-auto mt-2 h-1 w-16 rounded-full bg-gradient-to-r from-titans-red to-titans-orange" />
                    </div>
                    <div className="flex flex-wrap justify-center gap-8">
                      {doNivel.map((m) => (
                        <PlayerCard
                          key={m.id}
                          ornate={nivel === "ICONE"}
                          variant={NIVEL_CARTA_VARIANT[nivel]}
                          name={m.nome}
                          photo="/avatar-generico.svg"
                          photoFit="framed"
                          rating={NIVEL_CARTA_RATING[nivel]}
                          position={POSICAO_POR_CARGO[m.role]}
                          stats={statsGenericos(NIVEL_CARTA_RATING[nivel])}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default HallDaFama;
