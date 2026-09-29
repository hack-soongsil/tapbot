import semanticScreenManifest from '../../../../backend/tapbot/ui_resolution/semantic_screens.json'

export interface ScreenElementOption {
  id: string
  label: string
  collection?: boolean
  param?: 'index' | 'name'
  maxIndex?: number
  values?: readonly string[]
}

interface ManifestValueRange {
  start: string
  count: number
  step_minutes: number
}

interface ManifestElement {
  id: string
  label: string
  param?: 'index' | 'name'
  max_index?: number
  values?: ManifestValueRange
}

interface ManifestScreen {
  id: string
  label: string
  lifecycle: boolean
  elements: ManifestElement[]
}

interface SemanticScreenManifest {
  aliases: Record<string, string>
  element_aliases: Record<string, Record<string, string>>
  screens: ManifestScreen[]
}

const manifest = semanticScreenManifest as SemanticScreenManifest

function timeValues(range: ManifestValueRange | undefined): string[] | undefined {
  if (!range) return undefined
  const [hour = 0, minute = 0] = range.start.split(':').map(Number)
  const start = hour * 60 + minute
  return Array.from({ length: range.count }, (_, index) => {
    const minutes = start + index * range.step_minutes
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
}

function elementOption(element: ManifestElement): ScreenElementOption {
  const values = timeValues(element.values)
  return {
    id: element.id,
    label: element.label,
    ...(element.param ? { collection: true, param: element.param } : {}),
    ...(element.max_index === undefined ? {} : { maxIndex: element.max_index }),
    ...(values ? { values } : {}),
  }
}

export const SCREEN_ELEMENTS: Record<string, ScreenElementOption[]> = Object.fromEntries(
  manifest.screens.map((screen) => [screen.id, screen.elements.map(elementOption)]),
)

const lifecycleScreens = manifest.screens
  .filter((screen) => screen.lifecycle)
  .map(({ id, label }) => ({ id, label }))
if (lifecycleScreens.length === 0) throw new Error('semantic screen manifest has no lifecycle screen')

export const SCREEN_OPTIONS = lifecycleScreens as [
  { id: string; label: string },
  ...Array<{ id: string; label: string }>,
]

export const SEMANTIC_SCREEN_OPTIONS = manifest.screens.map(
  ({ id, label }) => ({ id, label }),
)

export const STUDY_ROOM_SLOT_TIMES = SCREEN_ELEMENTS.study_room_detail
  ?.find((element) => element.id === 'time_slot_by_time')?.values ?? []

export const STUDY_ROOM_SLOT_END_TIMES = SCREEN_ELEMENTS.study_room_detail
  ?.find((element) => element.id === 'time_slot_by_end_time')?.values ?? []

export function canonicalScreenId(screenId: string): string {
  return manifest.aliases[screenId] ?? screenId
}

export function canonicalElementId(screenId: string, elementId: string): string {
  const canonicalScreen = canonicalScreenId(screenId)
  return manifest.element_aliases[canonicalScreen]?.[elementId] ?? elementId
}
