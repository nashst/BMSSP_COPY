import React, { useRef, useEffect, useState } from 'react';
import { 
  Play, 
  Pause,
  Zap, 
  Shuffle, 
  MapPin, 
  Flag,
  Info,
  Grid3X3,
  Globe,
  Route,
  FastForward,
  Map as MapIcon,
  Loader2,
  Rewind
} from 'lucide-react';
import { 
  generateGraph, 
  fetchOSMGraph,
  runDijkstra, 
  runNewSSSP, 
  runAStar,
  runBFS,
  runGBFS,
  runBellmanFord,
  type Graph, 
  type AlgorithmResult,
  type TopologyType
} from './lib/graph';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';

function MapController({ setMap, onMove }: { setMap: (m: any) => void; onMove: () => void }) {
  const map = useMap();
  useEffect(() => {
    setMap(map);
    return () => setMap(null);
  }, [map, setMap]);

  useMapEvents({
    move: onMove,
    zoom: onMove,
  });

  return null;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [graph, setGraph] = useState<Graph | null>(null);
  const [startNode, setStartNode] = useState<string | null>(null);
  const [endNode, setEndNode] = useState<string | null>(null);
  const [topology, setTopology] = useState<TopologyType>('random');
  
  const [mode, setMode] = useState<'idle' | 'selectStart' | 'selectEnd'>('idle');
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  const [currentResult, setCurrentResult] = useState<AlgorithmResult | null>(null);
  const [activeAlgoName, setActiveAlgoName] = useState<string>('');
  const [snapshotIdx, setSnapshotIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(40);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [mapTrigger, setMapTrigger] = useState(0);

  const handleMapMove = () => {
    setMapTrigger(v => v + 1);
  };

  const [hudPos, setHudPos] = useState<'br' | 'bl' | 'tr' | 'tl'>('br');

  // Dynamic positioning for HUD
  useEffect(() => {
    if (!graph || !endNode || !graph.nodes[endNode]) {
      setHudPos('br');
      return;
    }
    const nodesToAvoid = [graph.nodes[endNode]];
    if (startNode && graph.nodes[startNode]) nodesToAvoid.push(graph.nodes[startNode]);

    const isBlocked = (pos: 'br'|'bl'|'tr'|'tl') => {
      return nodesToAvoid.some(n => {
        if (pos === 'br') return n.x > dimensions.width / 2 && n.y > dimensions.height / 2;
        if (pos === 'bl') return n.x < dimensions.width / 2 && n.y > dimensions.height / 2;
        if (pos === 'tr') return n.x > dimensions.width / 2 && n.y < dimensions.height / 2;
        if (pos === 'tl') return n.x < dimensions.width / 2 && n.y < dimensions.height / 2;
        return false;
      });
    };

    if (!isBlocked('br')) setHudPos('br');
    else if (!isBlocked('bl')) setHudPos('bl');
    else if (!isBlocked('tr')) setHudPos('tr');
    else setHudPos('tl');
  }, [graph, startNode, endNode, dimensions]);

  const hudClasses = {
    'br': 'bottom-8 right-8',
    'bl': 'bottom-8 left-8',
    'tr': 'top-24 right-8',
    'tl': 'top-8 left-8'
  };

  // Theme Colors
  let algoBase = activeAlgoName ? activeAlgoName.toLowerCase() : 'dijkstra';
  let primaryColor = '#22d3ee'; // cyan default
  let primaryColorDim = 'rgba(34,211,238,0.3)';
  let primaryColorBright = '#a5f3fc';

  if (algoBase.includes('dijkstra')) {
    primaryColor = '#22d3ee'; // cyan
    primaryColorDim = 'rgba(34,211,238,0.3)';
    primaryColorBright = '#a5f3fc';
  } else if (algoBase.includes('a*')) {
    primaryColor = '#fbbf24'; // amber
    primaryColorDim = 'rgba(251,191,36,0.3)';
    primaryColorBright = '#fde68a';
  } else if (algoBase.includes('breadth') || algoBase.includes('bfs')) {
    primaryColor = '#60a5fa'; // blue
    primaryColorDim = 'rgba(96,165,250,0.3)';
    primaryColorBright = '#bfdbfe';
  } else if (algoBase.includes('greedy')) {
    primaryColor = '#f97316'; // orange
    primaryColorDim = 'rgba(249,115,22,0.3)';
    primaryColorBright = '#fed7aa';
  } else if (algoBase.includes('bellman')) {
    primaryColor = '#ef4444'; // red
    primaryColorDim = 'rgba(239,68,68,0.3)';
    primaryColorBright = '#fca5a5';
  } else if (algoBase.includes('batch')) {
    primaryColor = '#d946ef'; // fuchsia
    primaryColorDim = 'rgba(217,70,239,0.3)';
    primaryColorBright = '#f5d0fe';
  }

  // Resize handling
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Initialization
  useEffect(() => {
    if (graph === null && dimensions.width > 0 && dimensions.height > 0) {
      setTimeout(() => {
        handleGenerateGraph(topology);
      }, 100);
    }
  }, [dimensions.width, dimensions.height]);

  const handleGenerateGraph = async (t: TopologyType) => {
    setTopology(t);
    setIsPlaying(false);
    setCurrentResult(null);
    setSnapshotIdx(0);
    setMode('idle');
    
    if (t === 'osm') {
      setIsLoadingMap(true);
      try {
        const bbox = { s: 40.768, w: -73.98, n: 40.78, e: -73.96 };
        const newGraph = await fetchOSMGraph(bbox, dimensions.width, dimensions.height);
        
        // Auto-select far separated start and end nodes
        let nodeVals = Object.values(newGraph.nodes);
        if(nodeVals.length > 2) {
          const start = [...nodeVals].sort((a,b) => (a.x + a.y) - (b.x + b.y))[0].id;
          const end = [...nodeVals].sort((a,b) => (b.x + b.y) - (a.x + a.y))[0].id;
          setStartNode(start);
          setEndNode(end);
        }
        setGraph(newGraph);
      } catch (err) {
        console.error("Failed to load map topology:", err);
      } finally {
        setIsLoadingMap(false);
      }
    } else {
      const newGraph = generateGraph(dimensions.width, dimensions.height, t === 'random' ? 200 : 800, t);
      setGraph(newGraph);
      
      // Auto-select far separated start and end nodes
      let nodeVals = Object.values(newGraph.nodes);
      if(nodeVals.length > 2) {
        const start = [...nodeVals].sort((a,b) => (a.x + a.y) - (b.x + b.y))[0].id;
        const end = [...nodeVals].sort((a,b) => (b.x + b.y) - (a.x + a.y))[0].id;
        setStartNode(start);
        setEndNode(end);
      }
    }
  };

  const runAlgorithm = (type: 'dijkstra' | 'new-sssp' | 'astar' | 'bfs' | 'gbfs' | 'bellman-ford') => {
    if (!graph || !startNode || !endNode) return;
    
    setIsPlaying(false);
    setSnapshotIdx(0);
    
    let result: AlgorithmResult;
    if (type === 'dijkstra') {
      result = runDijkstra(graph, startNode, endNode);
      setActiveAlgoName('Dijkstra');
    } else if (type === 'astar') {
      result = runAStar(graph, startNode, endNode);
      setActiveAlgoName('A* Search');
    } else if (type === 'bfs') {
      result = runBFS(graph, startNode, endNode);
      setActiveAlgoName('Breadth-First Search');
    } else if (type === 'gbfs') {
      result = runGBFS(graph, startNode, endNode);
      setActiveAlgoName('Greedy Best-First Search');
    } else if (type === 'bellman-ford') {
      result = runBellmanFord(graph, startNode, endNode);
      setActiveAlgoName('Bellman-Ford');
    } else {
      result = runNewSSSP(graph, startNode, endNode);
      setActiveAlgoName('Batch Relaxation SSSP');
    }
    
    setCurrentResult(result);
    setTimeout(() => {
      setIsPlaying(true);
    }, 100);
  };

  // Animation Loop
  useEffect(() => {
    if (!isPlaying || !currentResult) return;
    const timer = setInterval(() => {
      setSnapshotIdx(prev => {
        if (prev >= currentResult.snapshots.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, playbackSpeed);
    return () => clearInterval(timer);
  }, [isPlaying, currentResult, playbackSpeed]);

  // Click on Canvas to Select Nodes
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'idle' || !graph) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Find closest node
    let closestNode: string | null = null;
    let minDist = 20; // Tolerance radius
    
    Object.values(graph.nodes).forEach((node: any) => {
      let nx = node.x;
      let ny = node.y;
      if (topology === 'osm' && mapInstance && node.lat && node.lng) {
        const pt = mapInstance.latLngToContainerPoint([node.lat, node.lng]);
        nx = pt.x;
        ny = pt.y;
      }
      const dist = Math.hypot(nx - x, ny - y);
      if (dist < minDist) {
        minDist = dist;
        closestNode = node.id;
      }
    });
    
    if (closestNode) {
      if (mode === 'selectStart') {
        setStartNode(closestNode);
      } else if (mode === 'selectEnd') {
        setEndNode(closestNode);
      }
      setMode('idle');
      // Reset logic when choosing new points
      setCurrentResult(null);
      setIsPlaying(false);
      setSnapshotIdx(0);
    }
  };

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const getNodePos = (node: any) => {
      if (topology === 'osm' && mapInstance && node.lat && node.lng) {
        const pt = mapInstance.latLngToContainerPoint([node.lat, node.lng]);
        return { x: pt.x, y: pt.y };
      }
      return { x: node.x, y: node.y };
    };

    // 1. Draw all default edges
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const drawnPairs = new Set();
    Object.values(graph.edges).forEach((edgeList: any) => {
      edgeList.forEach((e: any) => {
        if (!graph.nodes[e.from] || !graph.nodes[e.to]) return;
        const pairKey = [e.from, e.to].sort().join('-');
        if (!drawnPairs.has(pairKey)) {
          const fromPos = getNodePos(graph.nodes[e.from]);
          const toPos = getNodePos(graph.nodes[e.to]);
          ctx.moveTo(fromPos.x, fromPos.y);
          ctx.lineTo(toPos.x, toPos.y);
          drawnPairs.add(pairKey);
        }
      });
    });
    ctx.stroke();

    // Context from current Algorithm Snapshot
    let snapshot: AlgorithmResult['snapshots'][0] | null = null;
    let isFinished = false;
    
    if (currentResult && snapshotIdx >= 0 && snapshotIdx < currentResult.snapshots.length) {
      snapshot = currentResult.snapshots[snapshotIdx];
      isFinished = snapshotIdx === currentResult.snapshots.length - 1;
    } else if (currentResult && snapshotIdx >= currentResult.snapshots.length) {
      // In case state mismatch after finish
      snapshot = currentResult.snapshots[currentResult.snapshots.length - 1];
      isFinished = true;
    }

    // 2. Draw explored edges and Frontier active edges
    if (snapshot) {
      // Re-draw visited paths (those connected between visited nodes)
      const visitedSet = new Set(snapshot.visited);
      ctx.strokeStyle = primaryColorDim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      Object.values(graph.edges).forEach((edgeList: any) => {
        edgeList.forEach((e: any) => {
          if (!graph.nodes[e.from] || !graph.nodes[e.to]) return;
          if (visitedSet.has(e.from) && visitedSet.has(e.to)) {
            const fromPos = getNodePos(graph.nodes[e.from]);
            const toPos = getNodePos(graph.nodes[e.to]);
            ctx.moveTo(fromPos.x, fromPos.y);
            ctx.lineTo(toPos.x, toPos.y);
          }
        });
      });
      ctx.stroke();

      // Frontier Active Edges
      if (!isFinished) {
        ctx.strokeStyle = primaryColorBright;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        snapshot.activeEdges.forEach(e => {
          if (!graph.nodes[e.from] || !graph.nodes[e.to]) return;
          const fromPos = getNodePos(graph.nodes[e.from]);
          const toPos = getNodePos(graph.nodes[e.to]);
          ctx.moveTo(fromPos.x, fromPos.y);
          ctx.lineTo(toPos.x, toPos.y);
        });
        ctx.stroke();
      }
    }

    // 3. Draw final path
    if (currentResult && isFinished && currentResult.finalPath.length > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.shadowBlur = 10;
      ctx.shadowColor = primaryColor;
      
      currentResult.finalPath.forEach(e => {
        if (!graph.nodes[e.from] || !graph.nodes[e.to]) return;
        const fromPos = getNodePos(graph.nodes[e.from]);
        const toPos = getNodePos(graph.nodes[e.to]);
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
      });
      ctx.stroke();
      
      // Reset shadow for other drawings
      ctx.shadowBlur = 0;
    }

    // 4. Draw Nodes
    Object.values(graph.nodes).forEach((node: any) => {
      const pos = getNodePos(node);
      // Perf check: skip clipping nodes that are outside canvas area entirely
      if (pos.x < -20 || pos.x > canvas.width + 20 || pos.y < -20 || pos.y > canvas.height + 20) return;

      let fillColor = 'rgba(255, 255, 255, 0.1)';
      let radius = 2;

      if (snapshot) {
        if (snapshot.frontier.includes(node.id)) {
          fillColor = '#ffffff';
          radius = 4;
        } else if (snapshot.visited.includes(node.id)) {
          fillColor = primaryColor;
          radius = 2.5;
        }
      }

      // Highlight Start and End specially
      if (node.id === startNode) {
        fillColor = '#ffffff'; 
        radius = 5;
      } else if (node.id === endNode) {
        fillColor = '#ef4444'; // red-500
        radius = 5;
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

  }, [graph, dimensions, currentResult, snapshotIdx, startNode, endNode, topology, mapInstance, mapTrigger, activeAlgoName]);

  return (
    <div className="bg-[#08080a] text-slate-200 h-screen w-full flex overflow-hidden font-sans select-none border-4 border-[#1a1a20]">
      
      {/* Control Sidebar */}
      <aside className="w-[380px] border-r border-[#1a1a20] bg-[#0c0c12]/95 backdrop-blur-xl flex flex-col p-6 shrink-0 z-10 overflow-y-auto shadow-[4px_0_24px_rgba(0,0,0,0.5)]">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]"></div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic text-white flex items-center gap-2">AlgoStorm <span className="text-xs text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/20">v3.0</span></h1>
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest leading-relaxed">Shortest Path Visualization Terminal<br/>Advanced Analysis Modules Active</p>
        </div>

        <div className="space-y-6 flex-1">
          {/* Topology Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Network Topology</label>
              <button 
                onClick={() => handleGenerateGraph(topology)}
                className="text-[10px] text-cyan-500 hover:text-cyan-400 uppercase tracking-widest font-bold flex items-center gap-1"
              >
                <Shuffle className="w-3 h-3" /> Regenerate
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleGenerateGraph('random')}
                disabled={isLoadingMap}
                className={`flex flex-col items-center justify-center gap-2 py-3 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-colors ${
                  topology === 'random' 
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                } disabled:opacity-50`}
              >
                <Globe className="w-4 h-4 mb-1" /> Mesh
              </button>
              <button
                onClick={() => handleGenerateGraph('grid')}
                disabled={isLoadingMap}
                className={`flex flex-col items-center justify-center gap-2 py-3 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-colors ${
                  topology === 'grid' 
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                } disabled:opacity-50`}
              >
                <Grid3X3 className="w-4 h-4 mb-1" /> Grid
              </button>
              <button
                onClick={() => handleGenerateGraph('maze')}
                disabled={isLoadingMap}
                className={`flex flex-col items-center justify-center gap-2 py-3 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-colors ${
                  topology === 'maze' 
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                } disabled:opacity-50`}
              >
                <Route className="w-4 h-4 mb-1" /> Maze
              </button>
              <button
                onClick={() => handleGenerateGraph('osm')}
                disabled={isLoadingMap}
                className={`flex flex-col items-center justify-center gap-2 py-3 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-colors ${
                  topology === 'osm' 
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                } disabled:opacity-50`}
              >
                {isLoadingMap ? <Loader2 className="w-4 h-4 mb-1 animate-spin" /> : <MapIcon className="w-4 h-4 mb-1" />}
                Real Map
              </button>
            </div>
          </div>

          {/* Node Placement */}
          <div className="space-y-3">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Mission Coordinates</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('selectStart')}
                className={`flex items-center justify-center gap-1 px-2 py-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  mode === 'selectStart' 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/50' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <MapPin className="w-3 h-3" /> Exfil (Start)
              </button>
              <button
                onClick={() => setMode('selectEnd')}
                className={`flex items-center justify-center gap-1 px-2 py-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  mode === 'selectEnd' 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/50' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <Flag className="w-3 h-3" /> Target (End)
              </button>
            </div>
            {mode !== 'idle' && (
              <div className="text-[10px] text-amber-500 font-bold uppercase tracking-widest animate-pulse flex items-center justify-center gap-1 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                <Info className="w-3 h-3" />
                Click node on canvas
              </div>
            )}
          </div>

          {/* Algorithm Toggles */}
          <div className="space-y-3">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Execution Core</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => runAlgorithm('dijkstra')}
                disabled={!startNode || !endNode}
                className={`flex flex-col items-center justify-center p-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all
                  ${activeAlgoName.includes('Dijkstra') ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'} disabled:opacity-50
                `}
              >
                Dijkstra
              </button>

              <button
                onClick={() => runAlgorithm('astar')}
                disabled={!startNode || !endNode}
                className={`flex flex-col items-center justify-center p-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all
                  ${activeAlgoName.includes('A*') ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-[0_0_10px_rgba(251,191,36,0.3)]' : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'} disabled:opacity-50
                `}
              >
                A* Search
              </button>

              <button
                onClick={() => runAlgorithm('bfs')}
                disabled={!startNode || !endNode}
                className={`flex flex-col items-center justify-center p-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all
                  ${activeAlgoName.includes('Breadth') ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-[0_0_10px_rgba(96,165,250,0.3)]' : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'} disabled:opacity-50
                `}
              >
                BFS
              </button>

              <button
                onClick={() => runAlgorithm('gbfs')}
                disabled={!startNode || !endNode}
                className={`flex flex-col items-center justify-center p-3 text-center rounded-lg text-[10px] uppercase font-bold tracking-widest transition-all
                  ${activeAlgoName.includes('Greedy') ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'} disabled:opacity-50
                `}
              >
                GBFS
              </button>

              <button
                onClick={() => runAlgorithm('bellman-ford')}
                disabled={!startNode || !endNode}
                className={`flex flex-col items-center justify-center p-3 text-center rounded-lg text-[10px] uppercase font-bold tracking-widest transition-all
                  ${activeAlgoName.includes('Bellman') ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'} disabled:opacity-50
                `}
              >
                Bellman-Ford
              </button>

              <button
                onClick={() => runAlgorithm('new-sssp')}
                disabled={!startNode || !endNode}
                className={`flex flex-col items-center justify-center p-3 text-center rounded-lg text-[10px] uppercase font-bold tracking-widest transition-all
                  ${activeAlgoName.includes('Batch') ? 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/50 shadow-[0_0_10px_rgba(217,70,239,0.3)]' : 'bg-slate-900/50 border border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'} disabled:opacity-50
                `}
              >
                Batch SSSP
              </button>
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="pt-6 border-t border-[#1a1a20] space-y-4">
           {currentResult ? (
             <>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2">
                    <span>Timeline</span>
                    <span className="text-slate-300">{snapshotIdx} / {currentResult.snapshots.length - 1}</span>
                  </div>
                  <input 
                    type="range"
                    disabled={isPlaying}
                    min={0}
                    max={currentResult.snapshots.length - 1}
                    value={snapshotIdx}
                    onChange={(e) => setSnapshotIdx(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                </div>

                <div className="flex items-center justify-between bg-slate-900/50 border border-[#1a1a20] rounded-xl p-2">
                  <button 
                    onClick={() => setSnapshotIdx(Math.max(0, snapshotIdx - 1))}
                    disabled={isPlaying || snapshotIdx <= 0}
                    className="p-2 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <Rewind className="w-4 h-4" />
                  </button>
                  
                  <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    disabled={snapshotIdx >= currentResult.snapshots.length - 1 && !isPlaying}
                    className="w-10 h-10 flex items-center justify-center bg-cyan-500 hover:bg-cyan-400 text-slate-900 rounded-full disabled:opacity-30 disabled:hover:bg-cyan-500"
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
                  </button>
                  
                  <button 
                    onClick={() => setSnapshotIdx(Math.min(currentResult.snapshots.length - 1, snapshotIdx + 1))}
                    disabled={isPlaying || snapshotIdx >= currentResult.snapshots.length - 1}
                    className="p-2 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <FastForward className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex items-center gap-3">
                   <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Speed</span>
                   <input 
                      type="range"
                      min={10}
                      max={150}
                      step={10}
                      value={160 - playbackSpeed} // Invert so right is faster 
                      onChange={(e) => setPlaybackSpeed(160 - parseInt(e.target.value))}
                      className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fuchsia-500"
                   />
                </div>
             </>
           ) : (
             <div className="text-center p-6 border border-dashed border-slate-800 rounded-xl">
               <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Waiting for Execution</div>
               <div className="text-xs text-slate-600 mt-1">Select graph parameters and run to interact with timeline.</div>
             </div>
           )}
        </div>
      </aside>

      {/* Main Visualization Area */}
      <main 
        ref={containerRef} 
        className={`flex-1 relative bg-[radial-gradient(circle_at_center,_#12121a_0%,_#08080a_100%)] ${mode !== 'idle' ? 'cursor-crosshair' : ''}`}
      >
        {topology === 'osm' && (
          <div className={`absolute inset-0 z-0 opacity-40 overflow-hidden ${isPlaying ? 'pointer-events-none' : ''}`} style={{ filter: 'grayscale(100%) contrast(1.2)' }}>
            <MapContainer 
              bounds={[[40.768, -73.98], [40.78, -73.96]]} 
              zoomControl={false}
              minZoom={12}
              maxZoom={17}
              scrollWheelZoom={true}
              dragging={true}
              touchZoom={true}
              doubleClickZoom={true}
              boxZoom={false}
              keyboard={false}
              style={{ width: '100%', height: '100%' }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              />
              <MapController setMap={setMapInstance} onMove={handleMapMove} />
            </MapContainer>
          </div>
        )}

        {/* Graph Mesh (CSS Grid Overlay) */}
        <div className="absolute inset-0 opacity-10 pointer-events-none z-1" style={{ backgroundImage: 'radial-gradient(#22d3ee 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
        
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleCanvasClick}
          className={`absolute inset-0 max-w-full max-h-full touch-none z-10 ${mode !== 'idle' || isPlaying ? 'pointer-events-auto' : 'pointer-events-none'}`}
        />
        
        {/* Helper overlay when empty */}
        {!graph && (
          <div className="absolute inset-0 flex items-center justify-center">
             <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        {/* Stats Overlay */}
        {currentResult && (
          <div className={`absolute ${hudClasses[hudPos]} flex gap-4 pointer-events-none transition-all duration-700 ease-in-out z-20`}>
            <div 
              className={`bg-[#0c0c12]/95 border p-5 rounded-2xl w-56 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)]`}
              style={{
                borderColor: primaryColorDim,
                boxShadow: `0 0 15px ${primaryColorDim}`
              }}
            >
              <div 
                className={`text-[10px] font-black uppercase mb-3 border-b pb-2`}
                style={{ color: primaryColor, borderBottomColor: primaryColorDim }}
              >
                {activeAlgoName}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Execution Steps</div>
                  <div className={`text-xl font-mono`} style={{ color: primaryColor }}>
                    {snapshotIdx < currentResult.snapshots.length - 1 ? snapshotIdx : currentResult.stats.steps}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Visited Nodes</div>
                  <div className="text-xl font-mono">
                    {snapshotIdx < currentResult.snapshots.length 
                      ? currentResult.snapshots[snapshotIdx].visited.length 
                      : currentResult.stats.visitedCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Est. Processing Time</div>
                  <div className="text-xl font-mono text-slate-300">
                    {snapshotIdx === currentResult.snapshots.length - 1 
                      ? `${currentResult.stats.timeMs.toFixed(2)} ms`
                      : 'Computing...'}
                  </div>
                </div>
              </div>
              
              {snapshotIdx === currentResult.snapshots.length - 1 && (
                 <div className="mt-4 text-[10px] text-emerald-400 uppercase font-bold tracking-widest bg-emerald-400/10 p-2 rounded border border-emerald-500/20 text-center">
                   Path Found
                 </div>
               )}
            </div>
          </div>
        )}

        {/* Annotations */}
        {graph && (
          <div className="absolute top-8 right-8 text-right pointer-events-none">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Current Viewport</div>
            <div className="text-sm font-light text-slate-300 uppercase tracking-wider mt-1 border-b border-slate-800 pb-1">
              Synthetic Graph / {Object.keys(graph.nodes).length} Nodes
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
