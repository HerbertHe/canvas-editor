/** Optional, per-call profiling. Nested stage times must not be added together. */
export function createLayoutWork() {
  return { scanMs: 0, scanUnits: 0, shapeAndStylesMs: 0, shapeUnits: 0,
    shapeCalls: 0, breakMs: 0, breakGlyphs: 0, breakGlyphCopies: 0,
    geometryMs: 0, measureMs: 0, measuredGlyphs: 0, geometryItems: 0 }
}

export type LayoutWork = ReturnType<typeof createLayoutWork>
