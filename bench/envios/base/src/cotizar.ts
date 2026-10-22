import { aDolares, tarifas, type Tarifa, type Zona } from "./tarifas"

/** Las tarifas de una zona que cubren el peso pedido. */
export function opcionesPara(zona: Zona, kg: number): Tarifa[] {
  return tarifas.filter((t) => t.zona === zona && kg <= t.maxKg)
}

export function enDolares(t: Tarifa): number {
  return t.precio * aDolares[t.moneda]
}

/** La opción de menor costo real, comparando todas en la misma moneda. */
export function masBarata(opciones: Tarifa[]): Tarifa | null {
  if (opciones.length === 0) return null
  return opciones.reduce((mejor, t) => (enDolares(t) < enDolares(mejor) ? t : mejor))
}

export type Cotizacion = { tarifa: Tarifa; totalUsd: number }

export function cotizar(zona: Zona, kg: number): Cotizacion | null {
  if (!Number.isFinite(kg) || kg <= 0) return null
  const tarifa = masBarata(opcionesPara(zona, kg))
  return tarifa ? { tarifa, totalUsd: enDolares(tarifa) } : null
}
