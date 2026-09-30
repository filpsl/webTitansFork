import DefinirSenha from "@/views/DefinirSenha";
import { registrarAberturaConvite } from "@/lib/server/convite";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token) await registrarAberturaConvite(token);
  return <DefinirSenha token={token ?? null} />;
}
