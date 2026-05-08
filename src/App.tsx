import React, { useRef, useEffect, useState } from 'react';
import { 
  Play, 
  Zap, 
  Shuffle, 
  MapPin, 
  Flag,
  Info 
} from 'lucide-react';
import { 
  generateGraph, 
  runDijkstra, 
  runNewSSSP, 
  type Graph, 
  type AlgorithmResult 
} from './lib/graph';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [graph, setGraph] = useState<Graph | null>(null);
  const [startNode, setStartNode] = useState<string | null>(null);
  const [endNode, setEndNode] = useState<string | null>(null);
  
  const [mode, setMode] = useState<'idle' | 'selectStart' | 'selectEnd'>('idle');
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  const [currentResult, setCurrentResult] = useState<AlgorithmResult | null>(null);
  const [activeAlgoName, setActiveAlgoName] = useState<string>('');
  const [snapshotIdx, setSnapshotIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

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
      // Give dimensions a tiny delay to settle on mount
      setTimeout(() => {
        handleGenerateGraph();
      }, 100);
    }
  }, [dimensions.width, dimensions.height]);

  const handleGenerateGraph = () => {
    setIsPlaying(false);
    setCurrentResult(null);
    setSnapshotIdx(0);
    const newGraph = generateGraph(dimensions.width, dimensions.height, 200);
    setGraph(newGraph);
    
    // Auto-select far separated start and end nodes
    const nodeVals = Object.values(newGraph.nodes);
    if(nodeVals.length > 2) {
      // Start is the most top-left
      const start = [...nodeVals].sort((a,b) => (a.x + a.y) - (b.x + b.y))[0].id;
      // End is the most bottom-right
      const end = [...nodeVals].sort((a,b) => (b.x + b.y) - (a.x + a.y))[0].id;
      setStartNode(start);
      setEndNode(end);
    }
    setMode('idle');
  };

  const runAlgorithm = (type: 'dijkstra' | 'new-sssp') => {
    if (!graph || !startNode || !endNode) return;
    
    setIsPlaying(false);
    setSnapshotIdx(0);
    
    let result: AlgorithmResult;
    if (type === 'dijkstra') {
      result = runDijkstra(graph, startNode, endNode);
      setActiveAlgoName('Classic Dijkstra');
    } else {
      result = runNewSSSP(graph, startNode, endNode);
      setActiveAlgoName('2025 conceptual SSSP (Batching)');
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
    }, 40); // Playback speed
    return () => clearInterval(timer);
  }, [isPlaying, currentResult]);

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
      const dist = Math.hypot(node.x - x, node.y - y);
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

    // Theme Colors
    const isDijkstra = !activeAlgoName || activeAlgoName.includes('Dijkstra');
    const primaryColor = isDijkstra ? '#22d3ee' : '#d946ef'; // cyan or fuchsia
    const primaryColorDim = isDijkstra ? 'rgba(34,211,238,0.3)' : 'rgba(217,70,239,0.3)';
    const primaryColorBright = isDijkstra ? '#a5f3fc' : '#f5d0fe';

    // 1. Draw all default edges
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const drawnPairs = new Set();
    Object.values(graph.edges).forEach((edgeList: any) => {
      edgeList.forEach((e: any) => {
        const pairKey = [e.from, e.to].sort().join('-');
        if (!drawnPairs.has(pairKey)) {
          ctx.moveTo(graph.nodes[e.from].x, graph.nodes[e.from].y);
          ctx.lineTo(graph.nodes[e.to].x, graph.nodes[e.to].y);
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
          if (visitedSet.has(e.from) && visitedSet.has(e.to)) {
            ctx.moveTo(graph.nodes[e.from].x, graph.nodes[e.from].y);
            ctx.lineTo(graph.nodes[e.to].x, graph.nodes[e.to].y);
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
          ctx.moveTo(graph.nodes[e.from].x, graph.nodes[e.from].y);
          ctx.lineTo(graph.nodes[e.to].x, graph.nodes[e.to].y);
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
        ctx.moveTo(graph.nodes[e.from].x, graph.nodes[e.from].y);
        ctx.lineTo(graph.nodes[e.to].x, graph.nodes[e.to].y);
      });
      ctx.stroke();
      
      // Reset shadow for other drawings
      ctx.shadowBlur = 0;
    }

    // 4. Draw Nodes
    Object.values(graph.nodes).forEach((node: any) => {
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
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

  }, [graph, dimensions, currentResult, snapshotIdx, startNode, endNode]);

  return (
    <div className="bg-[#08080a] text-slate-200 h-screen w-full flex overflow-hidden font-sans select-none border-4 border-[#1a1a20]">
      
      {/* Control Sidebar */}
      <aside className="w-80 border-r border-slate-800 bg-[#0c0c12]/80 backdrop-blur-md flex flex-col p-6 shrink-0 z-10 overflow-y-auto">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]"></div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic">AlgoStorm v2.5</h1>
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest leading-relaxed">Shortest Path Visualization Terminal<br/>Sorting Barrier Research PoC</p>
        </div>

        <div className="space-y-6 flex-1">
          {/* Input Section */}
          <div className="space-y-3">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Network Parameters</label>
            
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('selectStart')}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  mode === 'selectStart' 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/50' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <MapPin className="w-3 h-3" /> Set Start
              </button>
              <button
                onClick={() => setMode('selectEnd')}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  mode === 'selectEnd' 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/50' 
                  : 'bg-slate-900/50 border border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <Flag className="w-3 h-3" /> Set End
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
          <div className="space-y-3 pt-2">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Execution Core</label>
            <div className="space-y-2">
              <button
                onClick={() => runAlgorithm('dijkstra')}
                disabled={!startNode || !endNode || isPlaying}
                className="w-full flex items-center justify-between p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400 group hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-left flex-col flex items-start">
                  <div className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Play className="w-3 h-3" /> Traditional Dijkstra</div>
                  <div className="text-[10px] opacity-60">Strict n log n Sorting</div>
                </div>
                <div className={`w-2 h-2 rounded-full bg-cyan-400 ${isPlaying && activeAlgoName.includes('Dijkstra') ? 'shadow-[0_0_8px_cyan]' : ''}`}></div>
              </button>
              
              <button
                onClick={() => runAlgorithm('new-sssp')}
                disabled={!startNode || !endNode || isPlaying}
                className="w-full flex items-center justify-between p-4 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-xl text-fuchsia-400 hover:bg-fuchsia-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-left flex-col flex items-start">
                  <div className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Zap className="w-3 h-3" /> Batch Relaxation</div>
                  <div className="text-[10px] opacity-60">2025 Sorting-Barrier Breaker</div>
                </div>
                <div className={`w-2 h-2 rounded-full bg-fuchsia-400 ${isPlaying && activeAlgoName.includes('Batching') ? 'shadow-[0_0_8px_fuchsia]' : ''}`}></div>
              </button>
            </div>
          </div>
        </div>

        {/* Simulation CTA */}
        <div className="pt-6 border-t border-slate-800">
           <button
             onClick={handleGenerateGraph}
             className="w-full mt-3 py-2 text-slate-500 text-[10px] uppercase font-bold tracking-widest hover:text-slate-300 transition-colors flex items-center justify-center gap-2"
           >
             <Shuffle className="w-3 h-3" />
             Reset Graph Topology
           </button>
        </div>
      </aside>

      {/* Main Visualization Area */}
      <main 
        ref={containerRef} 
        className={`flex-1 relative bg-[radial-gradient(circle_at_center,_#12121a_0%,_#08080a_100%)] ${mode !== 'idle' ? 'cursor-crosshair' : ''}`}
      >
        {/* Graph Mesh (CSS Grid Overlay) */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#22d3ee 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
        
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleCanvasClick}
          className="absolute inset-0 max-w-full max-h-full touch-none"
        />
        
        {/* Helper overlay when empty */}
        {!graph && (
          <div className="absolute inset-0 flex items-center justify-center">
             <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        {/* Stats Overlay */}
        {currentResult && (
          <div className="absolute bottom-8 right-8 flex gap-4 pointer-events-none">
            <div className={`bg-slate-900/90 border border-slate-700 p-5 rounded-2xl w-56 backdrop-blur-xl ${activeAlgoName.includes('Dijkstra') ? 'ring-2 ring-cyan-500/30' : 'ring-2 ring-fuchsia-500/30'}`}>
              <div className={`text-[10px] ${activeAlgoName.includes('Dijkstra') ? 'text-cyan-400 border-cyan-500/20' : 'text-fuchsia-400 border-fuchsia-500/20'} font-black uppercase mb-3 border-b pb-2`}>
                {activeAlgoName} Pipeline
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Execution Steps</div>
                  <div className={`text-xl font-mono ${activeAlgoName.includes('Dijkstra') ? 'text-cyan-500' : 'text-fuchsia-500'}`}>
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
