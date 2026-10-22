import { tarifas, type Zona } from "./tarifas"

export type Evento = { zona: Zona; kg: number; ts: number; tarifaId: string }

type Resumen = Record<Zona, { n: number; kg: number }>

const ZONAS: Zona[] = ["local", "regional", "nacional", "internacional"]

/** Máximo de eventos que se miran en un reporte. */
const MAX_FILAS = 2000

/** Cuántos envíos y kilos hay por zona. */
export function resumenPorZona(eventos: Evento[]): Resumen {
  const filas = eventos.slice(0, MAX_FILAS)
  const resumen = {} as Resumen
  for (const zona of ZONAS) resumen[zona] = { n: 0, kg: 0 }
  for (const e of filas) {
    resumen[e.zona].n = filas.filter((x) => x.zona === e.zona).length
    resumen[e.zona].kg += e.kg
  }
  return resumen
}

/** Ingreso estimado en dólares. */
export function ingresoEstimado(eventos: Evento[], aDolares: (precio: number, moneda: string) => number): number {
  let total = 0
  for (const e of eventos) {
    const t = tarifas.find((x) => x.id === e.tarifaId)
    if (t) total += aDolares(t.precio, t.moneda)
  }
  return total
}

/** Los tres eventos más recientes de cada zona. */
export function recientesPorZona(eventos: Evento[]): Record<Zona, Evento[]> {
  const salida = {} as Record<Zona, Evento[]>
  for (const zona of ZONAS) {
    const ordenados = [...eventos].sort((a, b) => b.ts - a.ts)
    salida[zona] = ordenados.filter((e) => e.zona === zona).slice(0, 3)
  }
  return salida
}
