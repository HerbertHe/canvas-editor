import { IGetValueOption } from '../../../interface/Draw'
import { IEditorData } from '../../../interface/Editor'
import { zipElementList } from '../../../utils/element'

interface IGetValueWorkerOption {
  data: Required<IEditorData>
  options?: IGetValueOption
}

export function serializeValue(payload: IGetValueWorkerOption) {
  const { options, data } = payload
  const { extraPickAttrs = [] } = options || {}

  const editorData: IEditorData = {
    header: zipElementList(data.header, {
      extraPickAttrs,
      isClone: false
    }),
    main: zipElementList(data.main, {
      extraPickAttrs,
      isClassifyArea: true,
      isClone: false
    }),
    footer: zipElementList(data.footer, {
      extraPickAttrs,
      isClone: false
    })
  }

  return editorData
}
