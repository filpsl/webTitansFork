import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend | null {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  client = new Resend(apiKey);
  return client;
}

// Envio de e-mail via Resend. Sempre best-effort — nunca lança; quem chama
// decide se a falha deve ou não impedir a operação principal (ex.: o membro
// já foi cadastrado mesmo que o convite por e-mail falhe; dá pra reenviar).
export async function enviarEmail(args: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    console.error("RESEND_API_KEY não definida — e-mail não enviado.");
    return false;
  }

  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  try {
    const { error } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      attachments: args.attachments,
    });
    if (error) {
      console.error("Resend recusou o envio:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Falha ao enviar e-mail via Resend:", err);
    return false;
  }
}
