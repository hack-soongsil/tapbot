import semanticScreenManifest from '../../../../backend/tapbot/ui_resolution/semantic_screens.json'
import type { JsonValue, PortType } from './types'

export type ScreenElementParamType = 'int' | 'string' | 'bool' | 'select'

export interface ScreenElementParamOption {
  value: string
  label: string
}

export interface ScreenElementParamSchema {
  type: ScreenElementParamType
  label: string
  description?: string
  valueHint?: string
  min?: number
  max?: number
  default?: JsonValue
  placeholder?: string
  options?: readonly ScreenElementParamOption[]
}

export interface ScreenElementCategoryOption {
  id: string
  label: string
}

export interface ScreenElementOption {
  id: string
  label: string
  categoryId: string
  requiredParams: readonly string[]
  params: Readonly<Record<string, ScreenElementParamSchema>>
  description?: string
  usage: readonly string[]
  kind?: string
  role?: string
  returnType?: string
  stateMetadata: Readonly<Record<string, string>>
  // Compatibility projections for existing consumers.
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

interface ManifestParamSchema {
  type: ScreenElementParamType
  label: string
  description?: string
  value_hint?: string
  min?: number
  max?: number
  default?: JsonValue
  placeholder?: string
  options?: Array<string | { value: string; label?: string }>
  options_range?: ManifestValueRange
}

interface ManifestElement {
  id: string
  label: string
  category: string
  required_params?: string[]
  params?: Record<string, ManifestParamSchema>
  description?: string
  usage?: string[]
  kind?: string
  role?: string
  return_type?: string
  state_metadata?: Record<string, string>
}

interface ManifestScreen {
  id: string
  label: string
  lifecycle: boolean
  categories: ScreenElementCategoryOption[]
  elements: ManifestElement[]
}

interface SemanticScreenManifest {
  aliases: Record<string, string>
  element_aliases: Record<string, Record<string, string>>
  screens: ManifestScreen[]
}

export interface ScreenElementReference {
  screen: { id: string; label: string }
  category: ScreenElementCategoryOption
  element: ScreenElementOption
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

function parameterSchema(schema: ManifestParamSchema): ScreenElementParamSchema {
  const rangeOptions = timeValues(schema.options_range)
  const options = rangeOptions?.map((value) => ({ value, label: value }))
    ?? schema.options?.map((option) => typeof option === 'string'
      ? { value: option, label: option }
      : { value: option.value, label: option.label ?? option.value })
  return {
    type: schema.type,
    label: schema.label,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    ...(schema.value_hint === undefined ? {} : { valueHint: schema.value_hint }),
    ...(schema.min === undefined ? {} : { min: schema.min }),
    ...(schema.max === undefined ? {} : { max: schema.max }),
    ...(schema.default === undefined ? {} : { default: schema.default }),
    ...(schema.placeholder === undefined ? {} : { placeholder: schema.placeholder }),
    ...(options ? { options } : {}),
  }
}

function elementOption(element: ManifestElement): ScreenElementOption {
  const params = Object.fromEntries(
    Object.entries(element.params ?? {}).map(([key, schema]) => [key, parameterSchema(schema)]),
  )
  const requiredParams = element.required_params ?? []
  const legacyParam = requiredParams.length === 1 && ['index', 'name'].includes(requiredParams[0] ?? '')
    ? requiredParams[0] as 'index' | 'name'
    : undefined
  const legacySchema = legacyParam ? params[legacyParam] : undefined
  return {
    id: element.id,
    label: element.label,
    categoryId: element.category,
    requiredParams,
    params,
    ...(element.description === undefined ? {} : { description: element.description }),
    usage: element.usage ?? [],
    ...(element.kind === undefined ? {} : { kind: element.kind }),
    ...(element.role === undefined ? {} : { role: element.role }),
    ...(element.return_type === undefined ? {} : { returnType: element.return_type }),
    stateMetadata: element.state_metadata ?? {},
    ...(requiredParams.length > 0 ? { collection: true } : {}),
    ...(legacyParam ? { param: legacyParam } : {}),
    ...(legacyParam === 'index' && legacySchema?.max !== undefined
      ? { maxIndex: legacySchema.max } : {}),
    ...(legacyParam === 'name' && legacySchema?.options
      ? { values: legacySchema.options.map((option) => option.value) } : {}),
  }
}

export const SCREEN_ELEMENTS: Record<string, ScreenElementOption[]> = Object.fromEntries(
  manifest.screens.map((screen) => [screen.id, screen.elements.map(elementOption)]),
)

export const SCREEN_ELEMENT_CATEGORIES: Record<string, ScreenElementCategoryOption[]> =
  Object.fromEntries(manifest.screens.map((screen) => [screen.id, screen.categories]))

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

export const SEMANTIC_ELEMENT_SEARCH_KEYWORDS = Array.from(new Set(
  manifest.screens.flatMap((screen) => [
    screen.id,
    screen.label,
    ...screen.categories.flatMap((category) => [category.id, category.label]),
    ...screen.elements.flatMap((element) => [element.id, element.label]),
  ]),
))

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

export function selectedScreenElement(config: Record<string, JsonValue>): {
  screenId: string
  categoryId: string
  element?: ScreenElementOption
} {
  const screenId = canonicalScreenId(
    typeof config.screen_id === 'string' ? config.screen_id : SEMANTIC_SCREEN_OPTIONS[0]?.id ?? '',
  )
  const elements = SCREEN_ELEMENTS[screenId] ?? []
  const elementId = canonicalElementId(
    screenId,
    typeof config.element_id === 'string' ? config.element_id : elements[0]?.id ?? '',
  )
  const element = elements.find((candidate) => candidate.id === elementId) ?? elements[0]
  const categories = SCREEN_ELEMENT_CATEGORIES[screenId] ?? []
  const categoryId = element?.categoryId ?? categories[0]?.id ?? ''
  return { screenId, categoryId, element }
}

/** Category is editor metadata inferred from element_id and must not be persisted. */
export function withoutScreenElementEditorMetadata(
  config: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (!Object.hasOwn(config, 'category_id')) return config
  const cleaned = { ...config }
  delete cleaned.category_id
  return cleaned
}

export function elementsInCategory(screenId: string, categoryId: string): ScreenElementOption[] {
  return (SCREEN_ELEMENTS[canonicalScreenId(screenId)] ?? [])
    .filter((element) => element.categoryId === categoryId)
}

export function screenElementsFor(screenId: string): ScreenElementOption[] {
  return SCREEN_ELEMENTS[canonicalScreenId(screenId)] ?? []
}

export function categoriesForScreen(screenId: string): ScreenElementCategoryOption[] {
  return SCREEN_ELEMENT_CATEGORIES[canonicalScreenId(screenId)] ?? []
}

export function elementReferenceFor(
  screenId: string,
  elementId: string,
): ScreenElementReference | undefined {
  const canonicalScreen = canonicalScreenId(screenId)
  const screen = SEMANTIC_SCREEN_OPTIONS.find((candidate) => candidate.id === canonicalScreen)
  if (!screen) return undefined
  const canonicalElement = canonicalElementId(canonicalScreen, elementId)
  const element = screenElementsFor(canonicalScreen)
    .find((candidate) => candidate.id === canonicalElement)
  if (!element) return undefined
  const category = categoriesForScreen(canonicalScreen)
    .find((candidate) => candidate.id === element.categoryId)
  if (!category) return undefined
  return { screen, category, element }
}

export function allElementReferences(): ScreenElementReference[] {
  return SEMANTIC_SCREEN_OPTIONS.flatMap((screen) => screenElementsFor(screen.id)
    .flatMap((element) => {
      const reference = elementReferenceFor(screen.id, element.id)
      return reference ? [reference] : []
    }))
}

export function defaultParamsForElement(element: ScreenElementOption | undefined): Record<string, JsonValue> {
  if (!element) return {}
  return Object.fromEntries(element.requiredParams.map((key) => {
    const schema = element.params[key]
    if (schema?.default !== undefined) return [key, structuredClone(schema.default)]
    if (schema?.type === 'int') return [key, schema.min ?? 0]
    if (schema?.type === 'bool') return [key, false]
    if (schema?.type === 'select') return [key, schema.options?.[0]?.value ?? '']
    return [key, '']
  }))
}

export function paramPortType(schema: ScreenElementParamSchema): PortType {
  if (schema.type === 'int') return 'int'
  if (schema.type === 'bool') return 'bool'
  return 'string'
}
