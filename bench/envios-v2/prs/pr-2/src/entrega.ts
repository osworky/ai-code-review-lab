import { parseFecha } from "./fechas"

const FERIADOS = ["2026-01-01", "2026-04-02", "2026-04-03", "2026-05-01", "2026-12-25"]

/** La fecha de hoy en el calendario del cliente, como AAAA-MM-DD. */
export function hoyIso(ahora: Date): string {
  return ahora.toISOString().slice(0, 10)
}

/** Un pedido sigue vigente mientras su fecha no haya pasado. */
export function pedidoVigente(pedido: string, ahora: Date): boolean {
  return pedido >= hoyIso(ahora)
}

function esFeriado(fecha: Date): boolean {
  const feriados = new Set(FERIADOS)
  return feriados.has(fecha.toISOString().slice(0, 10))
}

function esFinDeSemana(fecha: Date): boolean {
  const dia = fecha.getUTCDay()
  return dia === 0 || dia === 6
}

/** El primer día hábil desde `desde` (inclusive), saltando fines de semana y feriados. */
export function primerDiaHabil(desde: Date): Date {
  while (esFinDeSemana(desde) || esFeriado(desde)) {
    desde.setUTCDate(desde.getUTCDate() + 1)
  }
  return desde
}

/** La fecha de entrega: `dias` días hábiles después de la fecha del pedido (AAAA-MM-DD). */
export function fechaDeEntrega(pedido: string, dias: number): Date | null {
  const inicio = parseFecha(pedido)
  if (!inicio || !Number.isInteger(dias) || dias < 0) return null
  let restantes = dias
  let actual = new Date(inicio)
  while (restantes > 0) {
    actual.setUTCDate(actual.getUTCDate() + 1)
    actual = primerDiaHabil(actual)
    restantes -= 1
  }
  return actual
}

/** Cuántos días hábiles hay entre dos fechas, sin contar la de inicio. */
export function diasHabilesEntre(desde: Date, hasta: Date): number {
  let cuenta = 0
  const cursor = new Date(desde)
  while (cursor < hasta) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (!esFinDeSemana(cursor) && !esFeriado(cursor)) cuenta += 1
  }
  return cuenta
}
