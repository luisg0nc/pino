/** A length or a coordinate smaller than this is what arithmetic leaves where it means nothing. */
const NOISE = 1e-6

/** A number with at most four significant digits and no trailing zeros; a magnitude under a millionth is written `0`. */
export function number(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Math.abs(value) < NOISE) return '0'
  const decimals = 3 - Math.floor(Math.log10(Math.abs(value)))
  if (decimals <= 0) {
    const step = 10 ** -decimals
    return String(Math.round(value / step) * step)
  }
  const text = value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' ? '0' : text
}

/** Three significant digits, no trailing zeros. */
const three = (n: number): string => String(Number(n.toPrecision(3)))

/** A count of tokens to three digits: `742`, `14.2 k`, `1.18 M`. */
export function tokens(n: number): string {
  if (Math.abs(n) < 1000) return String(Math.round(n))
  if (Number(Math.abs(n / 1e3).toPrecision(3)) < 1000) return `${three(n / 1e3)} k`
  return `${three(n / 1e6)} M`
}

/** A cost in US dollars, as Claude Code estimates one: to the cent (`$0.64`, `$10.80`), whole from $100, `under $0.01` for less than a cent. */
export function dollars(usd: number): string {
  if (usd === 0) return '$0'
  if (Math.abs(usd) < 0.005) return 'under $0.01'
  if (Math.abs(usd) >= 100) return `$${count(Math.round(usd))}`
  return `$${usd.toFixed(2)}`
}

/** How many of something: a whole number with its thousands set apart, `1,598,472`. */
export function count(n: number): string {
  return n.toLocaleString('en-US')
}
