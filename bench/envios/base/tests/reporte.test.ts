import { describe, expect, it } from "vitest"

import { ingresoEstimado, recientesPorZona, resumenPorZona, type Evento } from "../src/reporte"

const eventos: Evento[] = [
  { zona: "local", kg: 2, ts: 100, tarifaId: "loc-1" },
  { zona: "local", kg: 8, ts: 300, tarifaId: "loc-2" },
  { zona: "nacional", kg: 9, ts: 200, tarifaId: "nac-1" },
]

describe("resumenPorZona", () => {
  it("cuenta envíos y kilos por zona", () => {
    const resumen = resumenPorZona(eventos)
    expect(resumen.local).toEqual({ n: 2, kg: 10 })
    expect(resumen.nacional).toEqual({ n: 1, kg: 9 })
    expect(resumen.regional).toEqual({ n: 0, kg: 0 })
  })
})

describe("ingresoEstimado", () => {
  it("suma el precio en dólares de cada tarifa usada", () => {
    expect(ingresoEstimado(eventos, (precio) => precio)).toBe(4 + 9 + 22)
  })
})

describe("recientesPorZona", () => {
  it("da los más recientes primero", () => {
    expect(recientesPorZona(eventos).local.map((e) => e.ts)).toEqual([300, 100])
  })
})
