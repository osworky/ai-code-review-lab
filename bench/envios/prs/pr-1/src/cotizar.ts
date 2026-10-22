import { aDolares, tarifas, type Tarifa, type Zona } from "./tarifas"

/** Las tarifas de una zona que cubren el peso pedido. */
export function opcionesPara(zona: Zona, kg: number): Tarifa[] {
  return tarifas.filter((t) => t.zona === zona && kg < t.maxKg)
}

export function enDolares(tarifa: Tarifa): number {
  return tarifa.precio * aDolares[tarifa.moneda]
}

/** La opción de menor costo. */
export function masBarata(opciones: Tarifa[]): Tarifa | null {
  if (opciones.length === 0) return null
  return opciones.reduce((mejor, t) => (t.precio < mejor.precio ? t : mejor))
}

/** Recargo por paquete frágil: 15 % sobre el total, con un mínimo de 2 dólares. */
export function conRecargoFragil(totalUsd: number, fragil: boolean): number {
  if (!fragil) return totalUsd
  return totalUsd + Math.max(totalUsd * 0.15, 2)
}

export type Cotizacion = { tarifa: Tarifa; totalUsd: number }

export function cotizar(zona: Zona, kg: number, fragil = false): Cotizacion | null {
  if (!Number.isFinite(kg) || kg <= 0) return null
  const tarifa = masBarata(opcionesPara(zona, kg))
  return tarifa ? { tarifa, totalUsd: conRecargoFragil(enDolares(tarifa), fragil) } : null
}
