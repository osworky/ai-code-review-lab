import { describe, expect, it } from "vitest"

import { diasHasta, formatearTotal, parseFecha, totalEnCentavos } from "../src/fechas"

describe("parseFecha", () => {
  it("acepta una fecha real", () => {
    expect(parseFecha("2026-03-15")?.toISOString()).toBe("2026-03-15T00:00:00.000Z")
  })

  it("rechaza un texto que no es una fecha ISO", () => {
    expect(parseFecha("15/03/2026")).toBeNull()
    expect(parseFecha("")).toBeNull()
  })

  it("rechaza un mes que no existe", () => {
    expect(parseFecha("2026-13-01")).toBeNull()
    expect(parseFecha("2026-00-10")).toBeNull()
  })
})

describe("diasHasta", () => {
  it("redondea hacia arriba los días que faltan", () => {
    const hoy = new Date(Date.UTC(2026, 0, 1, 12))
    const entrega = new Date(Date.UTC(2026, 0, 3))
    expect(diasHasta(entrega, hoy)).toBe(2)
  })
})

describe("totales", () => {
  it("suma en centavos y da formato con dos decimales", () => {
    const total = totalEnCentavos([{ precioCentavos: 1050 }, { precioCentavos: 250 }])
    expect(total).toBe(1300)
    expect(formatearTotal(total)).toBe("13.00")
  })
})
