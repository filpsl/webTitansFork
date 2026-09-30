import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FeedbackImpressoraForm } from "@/components/feedback/FeedbackImpressoraForm";

// Página de acesso só por link (não fica em nenhum menu) — feedback específico
// do serviço de impressão de documentos (upload de PDF + PIX + retirada no
// laboratório), separado do feedback geral da equipe (/feedback).
export default function FeedbackImpressoraPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-2xl border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col items-center text-center space-y-2">
          <CardTitle className="text-3xl font-bold tracking-tight">
            FeedBack Impressora
          </CardTitle>
          <CardDescription className="max-w-[500px] text-base">
            Ajude-nos a melhorar nosso sistema!
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeedbackImpressoraForm />
        </CardContent>
      </Card>
    </div>
  );
}
