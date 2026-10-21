export function watchResize(onChange: () => void): void {
  window.addEventListener('resize', onChange)
}
