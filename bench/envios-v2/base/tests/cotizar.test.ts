import { describe, expect, it } from "vitest"

import { cotizar, masBarata, opcionesPara } from "../src/cotizar"

describe("cotizar", () => {
  it("elige la tarifa local más barata para un paquete liviano", () => {
    expect(cotizar("local", 3)?.tarifa.id).toBe("loc-1")
  })

  it("pasa a la tarifa siguiente cuando el peso supera la primera", () => {
    expect(cotizar("local", 12)?.tarifa.id).toBe("loc-2")
  })

  it("no cotiza pesos que no son positivos ni números", () => {
    expect(cotizar("local", 0)).toBeNull()
    expect(cotizar("local", -2)).toBeNull()
    expect(cotizar("local", Number.NaN)).toBeNull()
  })

  it("no cotiza si ninguna tarifa cubre el peso", () => {
    expect(cotizar("local", 50)).toBeNull()
  })
})

describe("masBarata", () => {
  it("devuelve null sin opciones", () => {
    expect(masBarata([])).toBeNull()
  })

  it("compara en dólares aunque las opciones vengan en monedas distintas", () => {
    const opciones = opcionesPara("nacional", 8)
    expect(masBarata(opciones)?.id).toBe("nac-1")
  })
})
