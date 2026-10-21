export async function fetchPrice(sku: string): Promise<number> {
  try {
    const res = await fetch(`/api/prices/${sku}`)
    const body = await res.json()
    return body.price
  } catch (e) {
    return 0
  }
}

export function saveDraft(text: string): void {
  fetch('/api/drafts', { method: 'POST', body: text })
  localStorage.setItem('draft', text)
}

export function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}
