export async function snapshot(page) {
  return page.evaluate(() => {
    const { draw, lineCarets } = window.nativeInteraction
    const position = draw.getPosition()
    const scopes = [{ id: 'main', elements: draw.getOriginalMainElementList(),
      positions: position.getOriginalMainPositionList() }]
    const visit = (elements, path) => {
      elements.forEach((element, e) => (element.trList || []).forEach((row, r) =>
        row.tdList.forEach((cell, c) => {
          const id = `${path}/${e}/${r}/${c}`
          scopes.push({ id, elements: cell.value, positions: cell.positionList || [] })
          visit(cell.value, id)
        })))
    }
    visit(draw.getOriginalMainElementList(), 'main')
    return {
      range: { start: draw.getRange().getRange().startIndex,
        end: draw.getRange().getRange().endIndex },
      scopes: scopes.map(scope => ({ id: scope.id,
        text: scope.elements.map(element => element.value).join(''),
        positions: scope.positions.map(item => ({ index: item.index,
          pageNo: item.pageNo, coordinate: item.coordinate })),
        lines: position.getNativeLines(scope.positions).map(placed => ({
          pageNo: placed.pageNo, x: placed.x, y: placed.y, scale: placed.scale,
          carets: lineCarets(placed).map(c => ({ index: c.index, x: c.x, y: c.y,
            height: c.height, affinity: c.affinity, bidiLevel: c.bidiLevel })),
          glyphs: placed.line.glyphs,
          inlines: placed.line.inlines.map(item => ({ kind: item.kind, rect: item.rect,
            text: item.kind === 'missingGlyph' ? item.text : undefined }))
        }))
      }))
    }
  })
}
