import { describe, expect, it } from "vitest"

import { diasHabilesEntre, fechaDeEntrega, primerDiaHabil } from "../src/entrega"

describe("fechaDeEntrega", () => {
  it("salta el fin de semana", () => {
    // viernes 2026-03-06 + 1 día hábil = lunes 2026-03-09
    expect(fechaDeEntrega("2026-03-06", 1)?.toISOString().slice(0, 10)).toBe("2026-03-09")
  })

  it("salta un feriado", () => {
    // miércoles 2026-04-01 + 1 día hábil: el 2 y el 3 de abril son feriados, el 4 y el 5 son fin de semana
    expect(fechaDeEntrega("2026-04-01", 1)?.toISOString().slice(0, 10)).toBe("2026-04-06")
  })

  it("rechaza una fecha inválida o días negativos", () => {
    expect(fechaDeEntrega("2026-13-01", 2)).toBeNull()
    expect(fechaDeEntrega("2026-03-06", -1)).toBeNull()
  })
})

describe("primerDiaHabil", () => {
  it("deja igual un día hábil", () => {
    expect(primerDiaHabil(new Date(Date.UTC(2026, 2, 10))).toISOString().slice(0, 10)).toBe("2026-03-10")
  })
})

describe("diasHabilesEntre", () => {
  it("cuenta solo los días hábiles", () => {
    const viernes = new Date(Date.UTC(2026, 2, 6))
    const martes = new Date(Date.UTC(2026, 2, 10))
    expect(diasHabilesEntre(viernes, martes)).toBe(2)
  })
})
