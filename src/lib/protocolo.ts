// Protocolo público do pedido: os 8 primeiros caracteres do UUID em maiúsculas.
// É a identidade que o cliente vê (em TelaSucesso e no kiosk); o UUID completo
// funciona como token de leitura do pedido e nunca é exposto.
export function protocoloDoPedido(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
