import { useEffect, useRef } from 'react'

/** Pins the two header rows of a .sticky-head table: row 1 sticks at the
 * viewport top, row 2 flush beneath it via the measured --head-1-h height
 * (a ResizeObserver re-measures when the class switches or columns change).
 * jsdom has no ResizeObserver — the effect simply no-ops there. */
export function useStickyHead<T extends HTMLTableElement>() {
  const tableRef = useRef<T>(null)
  const headRowRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    const row = headRowRef.current
    const table = tableRef.current
    if (!row || !table) return
    const apply = () => {
      const h = row.offsetHeight
      if (h > 0) table.style.setProperty('--head-1-h', `${h}px`)
    }
    apply()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply)
      return () => window.removeEventListener('resize', apply)
    }
    const observer = new ResizeObserver(apply)
    observer.observe(row)
    return () => observer.disconnect()
  }, [])
  return { tableRef, headRowRef }
}
