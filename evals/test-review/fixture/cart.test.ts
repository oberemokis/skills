import { describe, it, expect } from 'vitest'
import { calculateTotal } from './cart'

describe('calculateTotal', () => {
  it('sums line items', () => {
    const items = [{ price: 10, qty: 2 }, { price: 5, qty: 1 }]
    const expected = 10 * 2 + 5 * 1
    expect(calculateTotal(items)).toBe(expected)
  })

  it('returns zero for empty cart', () => {
    expect(calculateTotal([])).toBe(0)
  })

  it.skip('applies discount for bulk purchase', () => {
    const items = [{ price: 10, qty: 10 }]
    expect(calculateTotal(items)).toBe(90)
  })

  it('handles quantity 0 without error', () => {
    const items = [{ price: 10, qty: 0 }]
    if (items.length > 0) {
      expect(calculateTotal(items)).toBe(0)
    }
  })
})
