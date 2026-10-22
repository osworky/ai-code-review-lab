import { enDolares, opcionesPara } from "./cotizar"
import type { Tarifa, Zona } from "./tarifas"

/** Descuento por cantidad de paquetes: 10 % desde 5 (inclusive) y 20 % desde 20 (inclusive). */
export function descuentoPorCantidad(cantidad: number): number {
  if (cantidad > 20) return 0.2
  if (cantidad > 5) return 0.1
  return 0
}

/** Ordena las opciones de una zona de la más barata a la más cara. */
export function ordenarPorCosto(opciones: Tarifa[]): Tarifa[] {
  return [...opciones].sort((a, b) => a.precio - b.precio)
}

/** La mejor opción de una zona para el peso pedido, o null si ninguna lo cubre. */
export function mejorOpcion(zona: Zona, kg: number): Tarifa | null {
  return ordenarPorCosto(opcionesPara(zona, kg))[0] ?? null
}

export type LineaLote = { zona: Zona; kg: number }

export type CotizacionLote = {
  cantidad: number
  subtotalUsd: number
  descuento: number
  totalUsd: number
}

/** Cotiza varios paquetes juntos y aplica el descuento por cantidad. */
export function cotizarLote(lineas: LineaLote[]): CotizacionLote {
  let subtotalUsd = 0
  for (const linea of lineas) {
    const opcion = mejorOpcion(linea.zona, linea.kg)
    if (opcion) subtotalUsd += enDolares(opcion)
  }
  const descuento = descuentoPorCantidad(lineas.length)
  return {
    cantidad: lineas.length,
    subtotalUsd,
    descuento,
    totalUsd: subtotalUsd * (1 - descuento),
  }
}

/** Texto para mostrarle el lote al cliente. */
export function resumenLote(lote: CotizacionLote): string {
  const etiqueta = lote.cantidad === 1 ? "paquete" : "paquetes"
  const porcentaje = Math.round(lote.descuento * 100)
  const descuento = porcentaje > 0 ? ` (descuento ${porcentaje} %)` : ""
  return `${lote.cantidad} ${etiqueta}: USD ${lote.totalUsd.toFixed(2)}${descuento}`
}
