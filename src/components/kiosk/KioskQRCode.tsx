"use client";

import { QRCodeSVG } from "qrcode.react";

// Domínio público do site. O kiosk roda em localhost na Raspberry Pi, então o
// origin atual seria inútil no celular do cliente — apontamos para o domínio fixo.
const BASE_URL = "https://roboticstitans.com.br";

type Props = {
  // Caminho do site para onde o QR aponta (ex.: "/impressao").
  path: string;
  size?: number;
};

// QR code para nova impressão, apontando sempre para o domínio público fixo.
// Fundo branco para leitura pela câmera do celular.
export function KioskQRCode({ path, size = 220 }: Props) {
  const url = `${BASE_URL}${path}`;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-lg" style={{ lineHeight: 0 }}>
      <QRCodeSVG value={url} size={size} level="M" />
    </div>
  );
}
