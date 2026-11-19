import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { FileDropTarget, useFileDrop, type FileDropOptions } from './file-drop-target'

function dragEvent(files: File[], defaultPrevented = false) {
  const event = {
    defaultPrevented,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true
    }),
    dataTransfer: { types: ['Files'], files, items: [], dropEffect: 'none' },
  }
  return event
}

function Probe(options: FileDropOptions) {
  const { dropProps, overlay } = useFileDrop(options)
  return (
    <div {...dropProps}>
      <span>page</span>
      {overlay}
    </div>
  )
}

const root = (renderer: ReactTestRenderer) => renderer.root.findByProps({ 'data-file-drop-target': '' })

describe('useFileDrop', () => {
  it('hands over a drop on the element and shows the overlay while dragging', () => {
    const onFiles = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Probe onFiles={onFiles} label="Drop to add map layers" />)
    })
    const file = new File(['%PDF'], 'sheet.pdf')
    act(() => root(renderer).props.onDragEnter(dragEvent([file])))
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(1)
    const drop = dragEvent([file])
    act(() => root(renderer).props.onDrop(drop))
    expect(drop.preventDefault).toHaveBeenCalled()
    expect(onFiles).toHaveBeenCalledWith([file])
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
  })

  it('leaves a drop an inner drop field already took', () => {
    const onFiles = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<FileDropTarget onFiles={onFiles}>map</FileDropTarget>)
    })
    act(() => root(renderer).props.onDragEnter(dragEvent([new File([''], 'a.kml')])))
    act(() => root(renderer).props.onDragOver(dragEvent([new File([''], 'a.kml')], true)))
    // The overlay steps aside over the field that takes the drop.
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    act(() => root(renderer).props.onDrop(dragEvent([new File([''], 'a.kml')], true)))
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('walks the drop into picked files with their paths', async () => {
    const onPickedFiles = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Probe onPickedFiles={onPickedFiles} onError={vi.fn()} />)
    })
    const file = new File(['%PDF'], 'sheet.pdf')
    await act(async () => root(renderer).props.onDrop(dragEvent([file])))
    expect(onPickedFiles).toHaveBeenCalledWith([{ file, path: 'sheet.pdf' }])
  })

  it('ignores everything while disabled', () => {
    const onFiles = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Probe onFiles={onFiles} disabled />)
    })
    act(() => root(renderer).props.onDragEnter(dragEvent([new File([''], 'a.kml')])))
    act(() => root(renderer).props.onDrop(dragEvent([new File([''], 'a.kml')])))
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    expect(onFiles).not.toHaveBeenCalled()
  })
})
