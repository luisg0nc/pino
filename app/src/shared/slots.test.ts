import { describe, expect, it } from 'vitest'
import { checkConnection, checkFab, checkPartHad, checkPower, connectionText, DEFAULT_FAB, powerText } from './slots'

describe('the PCB slots of a new project', () => {
  it('says a power source and a connection in a row', () => {
    expect(powerText({ source: 'USB-C', kind: '', volts: '5', amps: '0.5', note: '' })).toBe('USB-C, 5 V, 0.5 A')
    expect(powerText({ source: 'battery', kind: 'LiPo 1S', volts: '3.7', amps: '', note: 'in the lid' })).toBe('battery (LiPo 1S), 3.7 V: in the lid')
    expect(connectionText({ what: 'SHT40 sensor', bus: 'I2C', connector: 'JST-SH 4-pin' })).toBe('SHT40 sensor over I2C, JST-SH 4-pin')
    expect(connectionText({ what: 'a button', bus: 'GPIO', connector: '' })).toBe('a button over GPIO')
  })

  it('does not say a unit twice, and keeps what is no number as typed', () => {
    expect(powerText({ source: 'USB-C', kind: '', volts: '5 V', amps: '500 mA', note: '' })).toBe('USB-C, 5 V, 500 mA')
    expect(powerText({ source: 'other', kind: '', volts: '', amps: '1,5', note: '' })).toBe('other, 1,5 A')
  })

  it('takes a row with only its own fields, each on one line', () => {
    expect(checkPower({ source: 'battery', kind: ' LiPo\n1S ', volts: '3.7', amps: '', note: '', extra: 1 })).toEqual({ source: 'battery', kind: 'LiPo 1S', volts: '3.7', amps: '', note: '' })
    expect(checkPower({ source: 'USB-C', kind: 'left over', volts: '', amps: '', note: '' })).toEqual({ source: 'USB-C', kind: '', volts: '', amps: '', note: '' })
    expect(checkPartHad({ what: ' c25804 ', note: 'pull-up', reading: { missing: true } })).toEqual({ what: 'C25804', note: 'pull-up' })
    expect(checkPartHad({ what: 'ESP32-C3 module', note: '' })).toEqual({ what: 'ESP32-C3 module', note: '' })
  })

  it('holds each row to its caps', () => {
    expect(checkConnection({ what: 'x'.repeat(121), bus: 'I2C', connector: '' })).toBe('What plugs in is at most 120 characters.')
    expect(checkConnection({ what: ' ', bus: 'I2C', connector: '' })).toBe('Say what plugs in.')
    expect(checkConnection({ what: 'LED', bus: 'CAN', connector: '' })).toBe('It talks over one of: I2C, SPI, UART, GPIO, USB, analog, other.')
    expect(checkPower({ source: 'mains', kind: '', volts: '', amps: '', note: '' })).toBe("Power comes from one of: USB-C, battery, barrel jack, a host's header, other.")
    expect(checkPower({ source: 'USB-C', kind: '', volts: '', amps: '', note: 'x'.repeat(301) })).toBe('The note is at most 300 characters.')
    expect(checkPartHad({ what: '', note: '' })).toBe('Give an LCSC number or name a module.')
    expect(checkPartHad({ what: 'x'.repeat(121), note: '' })).toBe('The part is at most 120 characters.')
    expect(checkFab({ layers: 3, thickness: 1.6, assembly: 'jlc', boards: 5 })).toBe('A board has 2 or 4 layers here.')
    expect(checkFab({ layers: 2, thickness: 1.1, assembly: 'jlc', boards: 5 })).toBe('A board is 0.8, 1.0, 1.2, 1.6, 2.0 mm thick here.')
    expect(checkFab({ layers: 2, thickness: 1.6, assembly: 'me', boards: 5 })).toBe('Say who assembles it: JLC, you, or a mix.')
    expect(checkFab({ layers: 2, thickness: 1.6, assembly: 'jlc', boards: 0 })).toBe('Between 1 and 10,000 boards.')
    expect(checkFab({ layers: 2, thickness: 1.6, assembly: 'jlc', boards: 10_001 })).toBe('Between 1 and 10,000 boards.')
    expect(checkFab(DEFAULT_FAB)).toEqual(DEFAULT_FAB)
  })
})
