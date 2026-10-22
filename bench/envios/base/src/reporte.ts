import { tarifas, type Zona } from "./tarifas"

export type Evento = { zona: Zona; kg: number; ts: number; tarifaId: string }

type Resumen = Record<Zona, { n: number; kg: number }>

const ZONAS: Zona[] = ["local", "regional", "nacional", "internacional"]

/** Cuántos envíos y kilos hay por zona. Solo se mira hasta 2000 eventos. */
export function resumenPorZona(eventos: Evento[]): Resumen {
  const filas = eventos.slice(0, 2000)
  const resumen = {} as Resumen
  for (const zona of ZONAS) resumen[zona] = { n: 0, kg: 0 }
  for (const e of filas) {
    resumen[e.zona].n += 1
    resumen[e.zona].kg += e.kg
  }
  return resumen
}

/** Ingreso estimado en dólares, buscando cada tarifa en una tabla armada una sola vez. */
export function ingresoEstimado(eventos: Evento[], aDolares: (precio: number, moneda: string) => number): number {
  const porId = new Map(tarifas.map((t) => [t.id, t]))
  let total = 0
  for (const e of eventos) {
    const t = porId.get(e.tarifaId)
    if (t) total += aDolares(t.precio, t.moneda)
  }
  return total
}

/** Los tres eventos más recientes de cada zona. */
export function recientesPorZona(eventos: Evento[]): Record<Zona, Evento[]> {
  const ordenados = [...eventos].sort((a, b) => b.ts - a.ts)
  const salida = {} as Record<Zona, Evento[]>
  for (const zona of ZONAS) salida[zona] = ordenados.filter((e) => e.zona === zona).slice(0, 3)
  return salida
}
