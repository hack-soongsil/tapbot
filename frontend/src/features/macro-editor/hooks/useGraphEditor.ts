import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { BLOCK_BY_TYPE, cloneDefaultConfig } from '../blocks'
import {
  EMPTY_GRAPH,
  MAIN_GRAPH_ID,
  functionIdFromGraphId,
  type GraphFlow,
  type GraphId,
  type GraphStoreState,
} from '../graph-store'
import { variableNodeConfig } from '../macro-document-model'
import type { JsonValue, MacroDefinition, MacroFlowEdge, MacroFlowNode, MacroNodeType } from '../types'

function defaultNodeConfig(type: MacroNodeType, definition: MacroDefinition): Record<string, JsonValue> {
  const config = cloneDefaultConfig(type)
  if ((type === 'set_variable' || type === 'get_variable') && definition.variables?.[0]) {
    return variableNodeConfig(type, definition.variables[0])
  }
  if (type !== 'call_function' || !definition.functions?.[0]) return config
  const selected = definition.functions[0]
  return {
    function_id: selected.id,
    inputs: structuredClone(selected.inputs),
    outputs: structuredClone(selected.outputs),
  }
}

function nodeLabel(
  type: MacroNodeType,
  config: Record<string, JsonValue>,
  definition: MacroDefinition,
  fallback: string,
) {
  if (type === 'get_variable' || type === 'set_variable') {
    const name = typeof config.name === 'string' && config.name ? config.name : fallback
    return type === 'get_variable' ? name : `${name} 설정`
  }
  if (type === 'call_function') {
    const functionId = typeof config.function_id === 'string' ? config.function_id : ''
    return definition.functions?.find((item) => item.id === functionId)?.name ?? fallback
  }
  return fallback
}

function uniqueNodeId(prefix: string, nodes: MacroFlowNode[]) {
  const used = new Set(nodes.map((node) => node.id))
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function uniqueEdgeId(connection: Connection, edges: MacroFlowEdge[]) {
  const prefix = `${connection.source ?? 'node'}-${connection.target ?? 'node'}`
  const used = new Set(edges.map((edge) => edge.id))
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function useGraphEditor({
  definition,
  selectedScreenId,
  selectedNodeId,
  setSelectedNodeId,
}: {
  definition: MacroDefinition | null
  selectedScreenId: string
  selectedNodeId: string | null
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
}) {
  const [store, setStore] = useState<GraphStoreState>({
    activeGraphId: MAIN_GRAPH_ID,
    graphs: { [MAIN_GRAPH_ID]: EMPTY_GRAPH },
  })
  const [nodeScreens, setNodeScreens] = useState<Record<string, string>>({})

  const activeGraph = store.graphs[store.activeGraphId] ?? EMPTY_GRAPH
  const activeFunctionId = functionIdFromGraphId(store.activeGraphId)

  const getGraph = useCallback((graphId: GraphId): GraphFlow => (
    store.graphs[graphId] ?? EMPTY_GRAPH
  ), [store.graphs])

  const getActiveGraph = useCallback((): GraphFlow => (
    store.graphs[store.activeGraphId] ?? EMPTY_GRAPH
  ), [store.activeGraphId, store.graphs])

  const setActiveGraphId = useCallback((graphId: GraphId) => {
    setStore((current) => current.activeGraphId === graphId
      ? current
      : { ...current, activeGraphId: graphId })
  }, [])

  const replaceGraph = useCallback((graphId: GraphId, graph: GraphFlow) => {
    setStore((current) => ({
      ...current,
      graphs: { ...current.graphs, [graphId]: graph },
    }))
  }, [])

  const replaceGraphs = useCallback((graphs: Record<string, GraphFlow>, activeGraphId: GraphId = MAIN_GRAPH_ID) => {
    setStore({
      activeGraphId,
      graphs: { [MAIN_GRAPH_ID]: EMPTY_GRAPH, ...graphs },
    })
  }, [])

  const removeGraph = useCallback((graphId: GraphId) => {
    if (graphId === MAIN_GRAPH_ID) return
    setStore((current) => {
      const graphs = { ...current.graphs }
      delete graphs[graphId]
      return {
        activeGraphId: current.activeGraphId === graphId ? MAIN_GRAPH_ID : current.activeGraphId,
        graphs,
      }
    })
  }, [])

  const updateGraph = useCallback((
    graphId: GraphId,
    update: (graph: GraphFlow) => GraphFlow,
  ) => {
    setStore((current) => {
      const graph = current.graphs[graphId] ?? EMPTY_GRAPH
      return {
        ...current,
        graphs: { ...current.graphs, [graphId]: update(graph) },
      }
    })
  }, [])

  const mapGraphs = useCallback((update: (graph: GraphFlow, graphId: GraphId) => GraphFlow) => {
    setStore((current) => ({
      ...current,
      graphs: Object.fromEntries(Object.entries(current.graphs).map(([graphId, graph]) => [
        graphId,
        update(graph, graphId as GraphId),
      ])),
    }))
  }, [])

  const addNode = useCallback((
    type: MacroNodeType,
    position?: { x: number; y: number },
    configOverride?: Record<string, JsonValue>,
    labelOverride?: string,
    graphId: GraphId = store.activeGraphId,
  ) => {
    if (!definition) return null
    const block = BLOCK_BY_TYPE.get(type)
    if (!block || block.category === 'event') return null
    const graph = store.graphs[graphId]
    if (!graph) return null
    const isMain = graphId === MAIN_GRAPH_ID
    const screenCount = isMain
      ? graph.nodes.filter((node) => nodeScreens[node.id] === selectedScreenId).length
      : graph.nodes.length
    const id = uniqueNodeId(type, graph.nodes)
    const configured = configOverride ?? defaultNodeConfig(type, definition)
    const createdNode: MacroFlowNode = {
      id,
      type: block.category,
      position: position ?? {
        x: 120 + (screenCount % 3) * 220,
        y: 180 + Math.floor(screenCount / 3) * 150,
      },
      data: {
        nodeType: type,
        category: block.category,
        label: labelOverride ?? nodeLabel(type, configured, definition, block.label),
        definitionLabel: labelOverride,
        config: configured,
        isEntry: false,
        errors: [],
      },
    }
    if (isMain) setNodeScreens((screens) => ({ ...screens, [id]: selectedScreenId }))
    updateGraph(graphId, (current) => ({ ...current, nodes: [...current.nodes, createdNode] }))
    setSelectedNodeId(id)
    return { id, type, config: configured }
  }, [definition, nodeScreens, selectedScreenId, setSelectedNodeId, store.activeGraphId, store.graphs, updateGraph])

  const connect = useCallback((
    connection: Connection,
    kind: 'exec' | 'data' = 'exec',
    graphId: GraphId = store.activeGraphId,
  ) => {
    updateGraph(graphId, (graph) => ({
      ...graph,
      edges: addEdge({
        ...connection,
        id: uniqueEdgeId(connection, graph.edges),
        data: { errors: [], kind },
      }, graph.edges),
    }))
  }, [store.activeGraphId, updateGraph])

  const updateNode = useCallback((
    nodeId: string,
    transform: (node: MacroFlowNode) => MacroFlowNode,
    graphId: GraphId = store.activeGraphId,
  ) => {
    updateGraph(graphId, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === nodeId ? transform(node) : node),
    }))
  }, [store.activeGraphId, updateGraph])

  const deleteNode = useCallback((nodeId: string, graphId: GraphId = store.activeGraphId) => {
    const graph = store.graphs[graphId] ?? EMPTY_GRAPH
    if (graph.nodes.find((node) => node.id === nodeId)?.data.isEvent) return
    updateGraph(graphId, (current) => ({
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    }))
    if (graphId === MAIN_GRAPH_ID) {
      setNodeScreens((current) => {
        const next = { ...current }
        delete next[nodeId]
        return next
      })
    }
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }, [selectedNodeId, setSelectedNodeId, store.activeGraphId, store.graphs, updateGraph])

  const deleteEdge = useCallback((edgeId: string, graphId: GraphId = store.activeGraphId) => {
    updateGraph(graphId, (graph) => ({
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== edgeId),
    }))
  }, [store.activeGraphId, updateGraph])

  const changeNodes = useCallback((
    changes: NodeChange<MacroFlowNode>[],
    graphId: GraphId = store.activeGraphId,
  ) => {
    updateGraph(graphId, (graph) => ({ ...graph, nodes: applyNodeChanges(changes, graph.nodes) }))
    if (changes.some((change) => change.type === 'remove' && change.id === selectedNodeId)) setSelectedNodeId(null)
  }, [selectedNodeId, setSelectedNodeId, store.activeGraphId, updateGraph])

  const changeEdges = useCallback((
    changes: EdgeChange<MacroFlowEdge>[],
    graphId: GraphId = store.activeGraphId,
  ) => {
    updateGraph(graphId, (graph) => ({ ...graph, edges: applyEdgeChanges(changes, graph.edges) }))
  }, [store.activeGraphId, updateGraph])

  const clearGraphStore = useCallback(() => {
    setStore({ activeGraphId: MAIN_GRAPH_ID, graphs: { [MAIN_GRAPH_ID]: EMPTY_GRAPH } })
    setNodeScreens({})
  }, [])

  return useMemo(() => ({
    activeGraphId: store.activeGraphId,
    activeGraph,
    activeFunctionId,
    graphs: store.graphs,
    nodeScreens,
    setNodeScreens,
    getActiveGraph,
    getGraph,
    setActiveGraphId,
    replaceGraph,
    replaceGraphs,
    removeGraph,
    mapGraphs,
    addNode,
    updateNode,
    deleteNode,
    connect,
    addConnection: connect,
    deleteEdge,
    changeNodes,
    changeEdges,
    deleteSelected: () => selectedNodeId && deleteNode(selectedNodeId),
    clearGraph: clearGraphStore,
  }), [activeFunctionId, activeGraph, addNode, changeEdges, changeNodes, clearGraphStore, connect, deleteEdge, deleteNode, getActiveGraph, getGraph, mapGraphs, nodeScreens, removeGraph, replaceGraph, replaceGraphs, selectedNodeId, setActiveGraphId, store.activeGraphId, store.graphs, updateNode])
}
