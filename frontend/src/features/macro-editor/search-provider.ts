import { macroCategoryLabels } from '../../i18n/ko'
import { BLOCK_BY_TYPE, NODE_DEFINITIONS } from './blocks'
import { functionCallConfig } from './function-model'
import { variableNodeConfig } from './macro-document-model'
import type { CreatedMacroNode } from './port-compatibility'
import type {
  JsonValue,
  MacroDefinition,
  MacroNodeCategory,
  MacroNodeType,
} from './types'

export interface SearchItem {
  id: string
  label: string
  categoryPath: readonly string[]
  keywords: readonly string[]
  type: MacroNodeType
  category: MacroNodeCategory
  description?: string
  defaultConfig: Record<string, JsonValue>
  create: (position: { x: number; y: number }) => CreatedMacroNode | null | undefined
}

export type SearchNodeFactory = (
  type: MacroNodeType,
  position: { x: number; y: number },
  presetConfig?: Record<string, JsonValue>,
  presetLabel?: string,
) => CreatedMacroNode | null | undefined

export function createSearchItems(
  definition: MacroDefinition | null,
  createNode: SearchNodeFactory,
): SearchItem[] {
  const staticItems = NODE_DEFINITIONS
    .filter((node) => !['get_variable', 'set_variable', 'call_function'].includes(node.type))
    .filter((node) => node.quickSearch ?? node.palette)
    .map((node): SearchItem => bindSearchItem(
      node.type,
      node.label,
      node.category,
      node.description,
      node.keywords ?? [],
      node.defaultConfig,
      (position) => createNode(node.type, position),
    ))
  if (!definition) return staticItems

  const variableItems = (definition.variables ?? []).flatMap((variable): SearchItem[] => [
    dynamicSearchItem(
      `variable:get:${variable.name}`,
      'get_variable',
      `${variable.name} 가져오기`,
      [variable.name, variable.type, 'get', 'variable', '변수', '가져오기'],
      variableNodeConfig('get_variable', variable),
      variable.name,
      createNode,
    ),
    dynamicSearchItem(
      `variable:set:${variable.name}`,
      'set_variable',
      `${variable.name} 설정`,
      [variable.name, variable.type, 'set', 'variable', '변수', '설정'],
      variableNodeConfig('set_variable', variable),
      `${variable.name} 설정`,
      createNode,
    ),
  ])
  const functionItems = (definition.functions ?? []).map((item): SearchItem => dynamicSearchItem(
    `function:call:${item.id}`,
    'call_function',
    item.name,
    [item.name, 'call', 'function', '함수', '호출'],
    functionCallConfig(item),
    item.name,
    createNode,
  ))
  return [...staticItems, ...variableItems, ...functionItems]
}

function dynamicSearchItem(
  id: string,
  type: MacroNodeType,
  label: string,
  keywords: readonly string[],
  config: Record<string, JsonValue>,
  nodeLabel: string,
  createNode: SearchNodeFactory,
): SearchItem {
  const node = BLOCK_BY_TYPE.get(type)!
  return bindSearchItem(
    type,
    label,
    node.category,
    node.description,
    keywords,
    config,
    (position) => createNode(type, position, config, nodeLabel),
    id,
  )
}

function bindSearchItem(
  type: MacroNodeType,
  label: string,
  category: MacroNodeCategory,
  description: string | undefined,
  keywords: readonly string[],
  defaultConfig: Record<string, JsonValue>,
  create: SearchItem['create'],
  id: string = type,
): SearchItem {
  return {
    id,
    type,
    label,
    category,
    categoryPath: [macroCategoryLabels[category]],
    description,
    keywords,
    defaultConfig,
    create,
  }
}
