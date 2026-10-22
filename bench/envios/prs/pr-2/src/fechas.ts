/** Una fecha ISO (AAAA-MM-DD) válida, o null. */
export function parseFecha(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return new Date(Date.UTC(anio, mes - 1, dia))
}

/** Días que faltan para la entrega, redondeando hacia arriba. Una entrega ya vencida da 0. */
export function diasHasta(entrega: Date, hoy: Date): number {
  const ms = entrega.getTime() - hoy.getTime()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

export function totalEnCentavos(items: { precioCentavos: number }[]): number {
  return items.reduce(
    (suma, item) => suma + item.precioCentavos,
    0,
  )
}

export function formatearTotal(centavos: number): string {
  return (centavos / 100).toFixed(2)
}

/** Indica si la suma de los precios coincide con el total que declaró el cliente. */
export function coincideTotal(items: { precio: number }[], declarado: number): boolean {
  const suma = items.reduce((total, item) => total + item.precio, 0)
  return suma === declarado
}
