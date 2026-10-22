/** Una fecha ISO (AAAA-MM-DD) que existe en el calendario, o null. */
export function parseFecha(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  const existe = fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  return existe ? fecha : null
}

/** Días que faltan para la entrega, redondeando hacia arriba. */
export function diasHasta(entrega: Date, hoy: Date): number {
  const diferenciaMs = entrega.getTime() - hoy.getTime()
  return Math.ceil(diferenciaMs / 86_400_000)
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
