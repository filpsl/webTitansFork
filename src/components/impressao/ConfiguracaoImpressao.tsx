import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fetchPrecos, calcularValor, formatBRL } from "@/lib/pricing";
import type { ModoCor, Precos } from "@/lib/types";

// A HP 135w é monocromática, então o checkout oferece apenas P&B.
const MODO_COR: ModoCor = "PB";

type Props = {
  numPaginas: number;
  enviando: boolean;
  onConfirmar: (args: { modoCor: ModoCor; valorCentavos: number }) => void;
  onVoltar: () => void;
};

export function ConfiguracaoImpressao({ numPaginas, enviando, onConfirmar, onVoltar }: Props) {
  const [precos, setPrecos] = useState<Precos | null>(null);

  useEffect(() => {
    fetchPrecos()
      .then(setPrecos)
      .catch(() => toast.error("Não foi possível carregar os preços."));
  }, []);

  const valor = precos ? calcularValor(numPaginas, MODO_COR, precos) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuração da impressão</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Total de páginas</p>
          <p className="text-2xl font-semibold">{numPaginas}</p>
        </div>

        <div className="space-y-1">
          <Label>Modo de cor</Label>
          <p className="font-normal">
            Preto e branco
            {precos && (
              <span className="text-muted-foreground ml-2">
                ({formatBRL(precos.PB)}/página)
              </span>
            )}
          </p>
        </div>

        <div className="border-t border-border pt-4 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-3xl font-bold text-titans-orange">{formatBRL(valor)}</span>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={onVoltar} disabled={enviando}>
            Voltar
          </Button>
          <Button
            onClick={() => onConfirmar({ modoCor: MODO_COR, valorCentavos: valor })}
            disabled={!precos || enviando}
          >
            {enviando ? "Enviando…" : "Pagar com PIX"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
