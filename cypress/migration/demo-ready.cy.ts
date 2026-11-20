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

  it('exports the latest background at high DPR after image loads', () => {
    const svg = (color: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`
    cy.intercept('https://fonts.bunny.net/**', { statusCode: 404 })
    cy.intercept('GET', '**/p1-old-background.svg', {
      delay: 1200,
      headers: { 'content-type': 'image/svg+xml' },
      body: svg('#ff0000')
    }).as('oldBackground')
    cy.intercept('GET', '**/p1-current-background.svg', {
      delay: 350,
      headers: { 'content-type': 'image/svg+xml' },
      body: svg('#0000ff')
    })
    cy.visit('/canvas-editor/')
    cy.window({ timeout: 20000 }).its('editor.state').should('eq', 'ready')
    cy.window().then(win => {
      const { editor } = win as typeof win & { editor: Editor }
      const command = editor.command
      command.executeSetValue({ header: [], main: [{ value: 'page' }], footer: [] })
      command.executeUpdateOptions({ background: { image: 'p1-old-background.svg' } })
      command.executePageScale(1.2)
      command.executeUpdateOptions({
        background: { image: 'p1-current-background.svg' }
      })
      return command.getImage({ pixelRatio: 2 }).then(urls => {
        expect(urls).to.have.length(1)
        return new Cypress.Promise<void>((resolve, reject) => {
          const bitmap = new win.Image()
          bitmap.onerror = reject
          bitmap.onload = () => {
            const page = win.document.querySelector<HTMLCanvasElement>(
              '.ce-page-container canvas'
            )!
            expect(bitmap.width).to.eq(Math.floor(parseFloat(page.style.width) * 2))
            const copy = win.document.createElement('canvas').getContext('2d')!
            copy.drawImage(bitmap, 0, 0)
            expect([...copy.getImageData(0, 0, 1, 1).data])
              .to.deep.eq([0, 0, 255, 255])
            resolve()
          }
          bitmap.src = urls[0]
        })
      })
    })
    cy.wait('@oldBackground')
    cy.get<HTMLCanvasElement>('.ce-page-container canvas').first().should(pages => {
      const pixel = pages[0].getContext('2d')!.getImageData(0, 0, 1, 1).data
      expect([...pixel]).to.deep.eq([0, 0, 255, 255])
    })
  })

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

  it('defers automatic sidebar queries until composition settles', () => {
    cy.intercept('https://fonts.bunny.net/**', { statusCode: 404 })
    cy.visit('/canvas-editor/')
    cy.get('.catalog__main', { timeout: 20000 }).should(
      'contain.text', '四、把邀请带给新邻居'
    )
    cy.clock(Date.now(), ['setTimeout', 'clearTimeout'])
    cy.window().then(win => {
      const { editor } = win as typeof win & { editor: Editor }
      const input = win.document.querySelector<HTMLTextAreaElement>('.ce-inputarea')!
      const dispatch = (type: string, data = '') =>
        input.dispatchEvent(new win.CompositionEvent(type, { data, bubbles: true }))
      const words = cy.spy(editor.command, 'getWordCount').as('words')
      cy.spy(editor.command, 'getCatalog').as('catalog')
      cy.spy(editor.command, 'getGroupIds').as('groups')
      cy.spy(editor.command, 'getGroupRectList').as('groupRects')
      editor.command.executeSetRange(7, 7)
      const lineSwitch = win.document.querySelector<HTMLInputElement>(
        '#comment-line-switch'
      )!
      lineSwitch.checked = true
      lineSwitch.dispatchEvent(new win.Event('change'))
      input.dispatchEvent(new win.KeyboardEvent('keydown', {
        key: 'Backspace', bubbles: true, cancelable: true
      }))
      dispatch('compositionstart')
      input.value = 'ni'
      input.dispatchEvent(new win.InputEvent('input', {
        data: 'ni', isComposing: true, bubbles: true
      }))
      win.dispatchEvent(new win.Event('scroll'))
      expect(editor.getPerformanceDiagnostics().composition.active).to.eq(true)
      cy.tick(250)
      for (const query of ['words', 'catalog', 'groups', 'groupRects'])
        cy.get('@' + query).should('not.have.been.called')
      cy.wrap(null).then(() => dispatch('compositionend', '你'))
      cy.tick(250)
      cy.get('@words').should('have.been.calledOnce')
      cy.get('@catalog').should('have.been.calledOnce')
      cy.get('@groups').should('have.been.calledOnce')
      cy.get('@groupRects').should('have.been.called')
      cy.wrap(null).then(() => {
        expect(editor.command.getText().main).to.contain('你')
        editor.listener.contentChange?.()
        dispatch('compositionstart')
        dispatch('compositionend')
      })
      cy.tick(250)
      cy.get('@words').should('have.been.calledTwice')
      cy.wrap(null).then(() => {
        editor.listener.contentChange?.()
        dispatch('compositionstart')
        editor.command.executeSetRange(8, 8)
        expect(editor.getPerformanceDiagnostics().composition.active).to.eq(false)
      })
      cy.tick(250)
      cy.get('@words').should('have.been.calledThrice')
      cy.wrap(null).then(() => {
        editor.listener.contentChange?.()
        editor.destroy()
        win.dispatchEvent(new win.Event('scroll'))
      })
      cy.tick(250)
      cy.wrap(null).then(() => expect(words.callCount).to.eq(3))
    })
  })

  it('discards in-flight sidebar results across composition and reset', () => {
    cy.intercept('https://fonts.bunny.net/**', { statusCode: 404 })
    cy.visit('/canvas-editor/')
    cy.get('.catalog__main', { timeout: 20000 }).should(
      'contain.text', '四、把邀请带给新邻居'
    )
    cy.clock(Date.now(), ['setTimeout', 'clearTimeout'])
    cy.window().then(win => {
      const { editor } = win as typeof win & { editor: Editor }
      const input = win.document.querySelector('.ce-inputarea')!
      const wordCount = win.document.querySelector('.word-count')!
      const original = wordCount.textContent
      let resolveStale!: (value: number) => void
      const stale = new Promise<number>(resolve => { resolveStale = resolve })
      const words = cy.stub(editor.command, 'getWordCount')
      words.onFirstCall().returns(stale)
      words.onSecondCall().resolves(987654)
      editor.listener.contentChange?.()
      cy.tick(200)
      cy.wrap(null).then(() => {
        expect(words).to.have.been.calledOnce
        input.dispatchEvent(new win.CompositionEvent('compositionstart', {
          bubbles: true
        }))
      })
      cy.tick(250)
      cy.get('.word-count').should('have.text', original)
      cy.wrap(null).then(() => {
        input.dispatchEvent(new win.CompositionEvent('compositionend', {
          bubbles: true
        }))
      })
      cy.tick(250)
      cy.get('.word-count').should('have.text', '987654')
      cy.wrap(null).then(() => new Cypress.Promise<void>(resolve => {
        resolveStale(123456)
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
      }))
      cy.get('.word-count').should('have.text', '987654')
      cy.wrap(null).then(() => expect(words).to.have.been.calledTwice)
      let resolveBeforeReset!: (value: number) => void
      const beforeReset = new Promise<number>(resolve => {
        resolveBeforeReset = resolve
      })
      words.onThirdCall().returns(beforeReset)
      words.onCall(3).resolves(1)
      cy.wrap(null).then(() => editor.listener.contentChange?.())
      cy.tick(200)
      cy.wrap(null).then(() => {
        expect(words).to.have.been.calledThrice
        editor.command.executeSetValue({ main: [{ value: 'reset' }] })
        return new Cypress.Promise<void>(resolve => {
          resolveBeforeReset(123456)
          win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
        })
      })
      cy.get('.word-count').should('have.text', '987654')
      cy.tick(250)
      cy.get('.word-count').should('have.text', '1')
      cy.wrap(null).then(() => expect(words.callCount).to.eq(4))
    })
  })
})
