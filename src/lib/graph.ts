/**
 * Core Algorithm logic for Single-Source Shortest Path (SSSP) demonstrations
 */

export type Node = {
  id: string;
  x: number;
  y: number;
};

export type Edge = {
  from: string;
  to: string;
  weight: number;
};

export type Graph = {
  nodes: Record<string, Node>;
  edges: Record<string, Edge[]>;
};

export type Snapshot = {
  frontier: string[]; // Nodes being analyzed in this step
  visited: string[]; // Nodes securely finalized
  activeEdges: Edge[]; // Edges relaxed in this step
  distances: Record<string, number>;
};

export type AlgorithmResult = {
  snapshots: Snapshot[];
  finalPath: Edge[];
  stats: {
    steps: number;
    visitedCount: number;
    timeMs: number;
  };
};

export function generateGraph(width: number, height: number, numNodes: number = 200): Graph {
  const nodes: Record<string, Node> = {};
  const points: Node[] = [];

  const padding = 30;
  for (let i = 0; i < numNodes; i++) {
    // Basic rejection sampling for spread
    let node: Node;
    let attempts = 0;
    while (attempts < 50) {
      node = {
        id: `n${i}`,
        x: padding + Math.random() * (width - padding * 2),
        y: padding + Math.random() * (height - padding * 2),
      };
      const tooClose = points.some(p => Math.hypot(p.x - node.x, p.y - node.y) < 30);
      if (!tooClose) break;
      attempts++;
    }
    nodes[node!.id] = node!;
    points.push(node!);
  }

  const edges: Record<string, Edge[]> = {};
  points.forEach(p => (edges[p.id] = []));

  const addEdge = (u: Node, v: Node) => {
    const weight = Math.hypot(u.x - v.x, u.y - v.y);
    edges[u.id].push({ from: u.id, to: v.id, weight });
    edges[v.id].push({ from: v.id, to: u.id, weight });
  };

  // 1. Build an approximate Minimum Spanning Tree to ensure the entire graph is connected
  const connected = new Set<string>([points[0].id]);
  const unconnected = new Set<string>(points.slice(1).map(p => p.id));

  while (unconnected.size > 0) {
    let minDist = Infinity;
    let bestU = '';
    let bestV = '';

    for (const v of unconnected) {
      for (const u of connected) {
        const dist = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
        if (dist < minDist) {
          minDist = dist;
          bestU = u;
          bestV = v;
        }
      }
    }

    if (bestU && bestV) {
      addEdge(nodes[bestU], nodes[bestV]);
      connected.add(bestV);
      unconnected.delete(bestV);
    } else {
      break;
    }
  }

  // 2. Add extra planar-ish edges (nearest neighbors)
  points.forEach(u => {
    const neighbors = points
      .filter(v => v.id !== u.id && !edges[u.id].some(e => e.to === v.id))
      .map(v => ({ id: v.id, dist: Math.hypot(u.x - v.x, u.y - v.y) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2); // Connect to 2 more nearest neighbors

    neighbors.forEach(n => {
      // Connect only if relatively close to maintain structural look
      if (n.dist < 100) {
        addEdge(u, nodes[n.id]);
      }
    });
  });

  return { nodes, edges };
}

export function runDijkstra(graph: Graph, start: string, end: string): AlgorithmResult {
  const startT = performance.now();
  const distances: Record<string, number> = {};
  const prev: Record<string, Edge | null> = {};
  const visited = new Set<string>();
  const snapshots: Snapshot[] = [];

  Object.keys(graph.nodes).forEach(id => (distances[id] = Infinity));
  distances[start] = 0;
  prev[start] = null;

  // Using a Set as a simplistic priority queue for visual clarity/simulation of node-by-node
  const queue = new Set<string>(Object.keys(graph.nodes));
  let steps = 0;

  while (queue.size > 0) {
    let u: string | null = null;
    let minD = Infinity;

    // Strict sorting barrier: O(n) scan in this primitive implementation, simulating PQ extraction
    for (const id of queue) {
      if (distances[id] < minD) {
        minD = distances[id];
        u = id;
      }
    }

    if (u === null || minD === Infinity) break;
    
    queue.delete(u);
    visited.add(u);
    steps++;

    if (u === end) {
      // Create a final snapshot for visual completion
      snapshots.push({
        frontier: [u],
        visited: Array.from(visited),
        activeEdges: [],
        distances: { ...distances }
      });
      break; 
    }

    const activeEdges: Edge[] = [];
    for (const e of graph.edges[u]) {
      const v = e.to;
      if (visited.has(v)) continue;
      
      activeEdges.push(e);
      const alt = distances[u] + e.weight;
      if (alt < distances[v]) {
        distances[v] = alt;
        prev[v] = e;
      }
    }

    snapshots.push({
      frontier: [u], // Dijkstra strictly evaluates 1 node
      visited: Array.from(visited),
      activeEdges,
      distances: { ...distances }
    });
  }

  const finalPath: Edge[] = [];
  let curr = end;
  while (curr !== start && prev[curr]) {
    finalPath.push(prev[curr]!);
    curr = prev[curr]!.from;
  }

  const timeMs = performance.now() - startT;

  return {
    snapshots,
    finalPath: finalPath.reverse(),
    stats: { steps, visitedCount: visited.size, timeMs }
  };
}

export function runNewSSSP(graph: Graph, start: string, end: string): AlgorithmResult {
  const startT = performance.now();
  const distances: Record<string, number> = {};
  const prev: Record<string, Edge | null> = {};
  const visited = new Set<string>();
  const snapshots: Snapshot[] = [];

  Object.keys(graph.nodes).forEach(id => (distances[id] = Infinity));
  distances[start] = 0;
  prev[start] = null;

  // The new conceptual algorithm uses soft-buckets / batching instead of a strict priority queue
  const DELTA = 60; // Delta-width constraint for bucket relaxation
  const buckets: Map<number, Set<string>> = new Map();

  const placeInBucket = (id: string, dist: number) => {
    const idx = Math.floor(dist / DELTA);
    if (!buckets.has(idx)) buckets.set(idx, new Set());
    buckets.get(idx)!.add(id);
  };

  placeInBucket(start, 0);
  let steps = 0;

  while (buckets.size > 0) {
    let minIdx = Infinity;
    for (const k of buckets.keys()) {
      if (buckets.get(k)!.size > 0 && k < minIdx) minIdx = k;
    }

    if (minIdx === Infinity) break;

    const currentBatch = Array.from(buckets.get(minIdx)!);
    buckets.delete(minIdx);

    const activeEdges: Edge[] = [];

    // Relax all edges from this entire bucket batch SIMULTANEOUSLY
    for (const u of currentBatch) {
      if (visited.has(u)) continue; 
      
      for (const e of graph.edges[u]) {
        const v = e.to;
        activeEdges.push(e);
        const alt = distances[u] + e.weight;
        
        if (alt < distances[v]) {
          distances[v] = alt;
          prev[v] = e;
          placeInBucket(v, alt);
        }
      }
    }

    currentBatch.forEach(u => visited.add(u));
    steps++;

    snapshots.push({
      frontier: currentBatch, // The new algorithm evaluates an entire batch simultaneously
      visited: Array.from(visited),
      activeEdges,
      distances: { ...distances }
    });

    if (visited.has(end)) {
      break; 
    }
  }

  const finalPath: Edge[] = [];
  let curr = end;
  while (curr !== start && prev[curr]) {
    finalPath.push(prev[curr]!);
    curr = prev[curr]!.from;
  }

  const timeMs = performance.now() - startT;

  return {
    snapshots,
    finalPath: finalPath.reverse(),
    stats: { steps, visitedCount: visited.size, timeMs }
  };
}
