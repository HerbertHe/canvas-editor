import type Editor from '../../src/editor'

const describeSource = Cypress.env('package') ? describe.skip : describe

describeSource('T21 main demo readiness', () => {
  it('exposes a ready instance before toolbar setup and commands', () => {
    // Keep this integration check independent of public font service availability.
    cy.intercept('https://fonts.bunny.net/**', { statusCode: 404 })
    cy.visit('/canvas-editor/')
    cy.window({ timeout: 20000 }).should(win => {
      expect((win as any).editor?.state).to.eq('ready')
    })
    cy.window().then(win => {
      const editor = (win as any).editor
      expect(editor).to.eq((win as any).__CANVAS_EDITOR_INSTANCE__)
      expect(editor.initializationError).to.eq(null)
      expect(editor.getPerformanceDiagnostics().options).to.include({
        performanceProfile: 'sync',
        imePreview: true,
        incrementalCompute: false,
        deferredPaint: true
      })
      editor.command.executeSetRange(0, 1)
      editor.command.executeBold()
      expect(
        editor.command.executeComputeElementListHeight([{ value: 'مرحبا' }])
      ).to.be.greaterThan(0)
    })
    cy.get('.page-scale-add').click()
    cy.window().then(win => {
      expect((win as any).editor.command.getOptions().scale).to.be.greaterThan(
        1
      )
    })
    cy.get('.ce-page-container canvas').should('have.length.greaterThan', 0)
  })

  for (const profile of ['baseline', 'sync']) {
    it(`keeps visible bitmaps during zoom with the ${profile} profile`, () => {
      cy.intercept('https://fonts.bunny.net/**', { statusCode: 404 })
      cy.visit(`/canvas-editor/?performance=${profile}`)
      cy.window({ timeout: 20000 }).its('editor.state').should('eq', 'ready')
      cy.window().then(win => {
        const { editor } = win as typeof win & { editor: Editor }
        const pages = win.document.querySelectorAll<HTMLCanvasElement>(
          '.ce-page-container canvas'
        )
        const first = pages[0]
        const last = pages[pages.length - 1]
        expect(last.getBoundingClientRect().top).to.be.greaterThan(win.innerHeight)
        const oldWidth = last.width
        const ctx = last.getContext('2d')!
        ctx.save()
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(0, 0, 1, 1)
        ctx.restore()

        for (const scale of [1.2, 0.8]) {
          editor.command.executePageScale(scale)
          // These pixels must already be ready before IntersectionObserver runs.
          expect(first.width).to.eq(
            Math.floor(parseFloat(first.style.width) * win.devicePixelRatio)
          )
          const pixel = first.getContext('2d')!.getImageData(0, 0, 1, 1).data
          expect(pixel[3]).to.eq(255)
          expect(last.width).to.eq(oldWidth)
          expect([...ctx.getImageData(0, 0, 1, 1).data]).to.deep.eq([
            255, 0, 0, 255
          ])
        }
        last.scrollIntoView()
      })
      cy.get<HTMLCanvasElement>('.ce-page-container canvas').last().should(pages => {
        const page = pages[0]
        const { devicePixelRatio } = page.ownerDocument.defaultView!
        expect(page.width).to.eq(
          Math.floor(parseFloat(page.style.width) * devicePixelRatio)
        )
        const pixel = page.getContext('2d')!.getImageData(0, 0, 1, 1).data
        expect([...pixel]).to.deep.eq([255, 255, 255, 255])
      })
    })
  }

  it('keeps the weekend catalog and everyday form calculations usable', () => {
    cy.intercept('https://fonts.bunny.net/**', { statusCode: 404 })
    cy.visit('/canvas-editor/')
    cy.get('.catalog__main', { timeout: 20000 }).should(
      'contain.text',
      '四、把邀请带给新邻居'
    )
    cy.window().then(win => {
      const editor = (win as any).editor
      const controls = editor.command.getControlList()
      const types = controls.map((item: any) => item.control.type)
      expect(types).to.include.members([
        'text',
        'number',
        'date',
        'select',
        'radio',
        'checkbox'
      ])
      expect(
        editor.command.getControlValue({ conceptId: 'householdBudget' })[0]
          .value
      ).to.eq('60')
      editor.command.executeSetControlValue({
        conceptId: 'participantCount',
        value: '4'
      })
      editor.command.executeSetControlValue({
        conceptId: 'bringPet',
        value: 'yes'
      })
    })
    cy.window().should(win => {
      const editor = (win as any).editor
      expect(
        editor.command.getControlValue({ conceptId: 'householdBudget' })[0]
          .value
      ).to.eq('80')
      const petPlan = editor.command
        .getControlList()
        .find((item: any) => item.control.conceptId === 'petPlan')
      expect(petPlan.control.required).to.eq(true)
    })
  })
})
