import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  MapPin,
  HeartPulse,
  GraduationCap,
  Trees,
  Building,
  Navigation,
  Globe,
  Activity,
  LocateFixed,
  ChevronRight,
  Eye,
  EyeOff
} from 'lucide-react';
import { fromLonLat } from 'ol/proj';

// Helper to map entity types to icons
const ENTITY_ICONS = {
  Hospital: HeartPulse,
  School: GraduationCap,
  Road: Navigation,
  River: Navigation,
  Forest: Trees,
  WaterBody: Activity,
  Building: Building,
  District: Globe,
  State: Globe,
  Parcel: MapPin,
  UrbanArea: Building,
  ProtectedArea: Trees,
  FloodZone: Activity
};

// Helper to map entity types to color themes
const ENTITY_COLORS = {
  Hospital: { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.15)', glow: 'rgba(236, 72, 153, 0.35)', badge: 'bg-pink-500/10 text-pink-300 border-pink-500/20' },
  School: { stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.15)', glow: 'rgba(168, 85, 247, 0.35)', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/20' },
  Road: { stroke: '#94a3b8', fill: 'rgba(148, 163, 184, 0.15)', glow: 'rgba(148, 163, 184, 0.25)', badge: 'bg-slate-500/10 text-slate-300 border-slate-500/20' },
  River: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.15)', glow: 'rgba(59, 130, 246, 0.35)', badge: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
  Forest: { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.15)', glow: 'rgba(16, 185, 129, 0.35)', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' },
  WaterBody: { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.15)', glow: 'rgba(6, 182, 212, 0.35)', badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20' },
  Building: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', glow: 'rgba(245, 158, 11, 0.35)', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  District: { stroke: '#f43f5e', fill: 'rgba(244, 63, 94, 0.15)', glow: 'rgba(244, 63, 94, 0.35)', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/20' },
  State: { stroke: '#e11d48', fill: 'rgba(225, 29, 72, 0.15)', glow: 'rgba(225, 29, 72, 0.35)', badge: 'bg-rose-600/10 text-rose-400 border-rose-600/20' },
  Parcel: { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.2)', glow: 'rgba(6, 182, 212, 0.45)', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/35' },
  UrbanArea: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', glow: 'rgba(245, 158, 11, 0.35)', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  ProtectedArea: { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.15)', glow: 'rgba(16, 185, 129, 0.35)', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' },
  FloodZone: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.15)', glow: 'rgba(239, 68, 68, 0.35)', badge: 'bg-red-500/10 text-red-300 border-red-500/20' }
};

const DEFAULT_COLOR = { stroke: '#64748b', fill: 'rgba(100, 116, 139, 0.15)', glow: 'rgba(100, 116, 139, 0.25)', badge: 'bg-slate-500/10 text-slate-300 border-slate-500/20' };

export default function KgVisualizer({ context, onClose, mapRef }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  // States
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  
  // Filtering
  const [disabledCategories, setDisabledCategories] = useState({});
  const [showNearRelations, setShowNearRelations] = useState(false);

  // SVG Pan/Zoom state
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Dragging node state
  const draggingNodeRef = useRef(null);
  const hoverTimeoutRef = useRef(null);

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Force Directed Simulation Parameters and Alpha Decay
  const alphaRef = useRef(1.0);
  const gravity = 0.025;

  // Filtered lists (defined early to support parameters calculation)
  const activeNodes = useMemo(() => {
    if (!nodes) return [];
    return nodes.filter(n => !disabledCategories[n.type]);
  }, [nodes, disabledCategories]);

  const activeNodeIds = useMemo(() => new Set(activeNodes.map(n => n.id)), [activeNodes]);

  const activeLinks = useMemo(() => {
    if (!links) return [];
    return links.filter(l => {
      const isNear = l.relation === 'NEAR' || (l.relation && l.relation.toUpperCase() === 'NEAR');
      if (isNear && !showNearRelations) return false;
      return activeNodeIds.has(l.source.id) && activeNodeIds.has(l.target.id);
    });
  }, [links, activeNodeIds, showNearRelations]);

  // Dynamic scale-adaptive force parameters based on graph size/density
  const { repulsionStrength, linkStrength, linkLength, friction, collisionRadius } = useMemo(() => {
    const edgeCount = activeLinks.length;
    
    // Default base parameters for sparse graphs
    let repulsion = 12000;
    let strength = 0.08;
    let length = 110;
    let damp = 0.70; // friction
    let collision = 65;
    
    // Scale for large / dense graphs
    if (edgeCount > 400) {
      repulsion = 7000;       // Weaker repulsion to avoid massive explosive forces
      strength = 0.12;        // Stronger springs to pull clusters together
      length = 85;           // Shorter spring rest lengths to keep graph compact
      damp = 0.52;            // Lower friction value (means higher damping/viscous drag!) to absorb kinetic energy faster
      collision = 55;         // Smaller collision radius
    } else if (edgeCount > 100) {
      repulsion = 9500;
      strength = 0.10;
      length = 100;
      damp = 0.62;
      collision = 60;
    }
    
    return {
      repulsionStrength: repulsion,
      linkStrength: strength,
      linkLength: length,
      friction: damp,
      collisionRadius: collision
    };
  }, [activeLinks.length]);

  // Re-run simulation trigger
  const [tick, setTick] = useState(0);

  // Categories present in this graph
  const availableCategories = useMemo(() => {
    if (!context || !context.entities) return [];
    const types = context.entities.map(e => e.type);
    return [...new Set(types)].filter(Boolean);
  }, [context]);



  // Neighbors map for fast lookup during hovers
  const nodeConnections = useMemo(() => {
    const map = {};
    activeLinks.forEach(l => {
      const s = l.source.id;
      const t = l.target.id;
      if (!map[s]) map[s] = new Set();
      if (!map[t]) map[t] = new Set();
      map[s].add(t);
      map[t].add(s);
    });
    return map;
  }, [activeLinks]);

  // Initialize simulation nodes and links
  useEffect(() => {
    if (!context || !context.entities) return;

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Build unique nodes list with Concentric & Category Sector Initialization for rapid convergence (<1s)
    const nonFocusNodes = context.entities.filter(n => n.id !== 'node-focus-polygon');
    // Sort nodes by type to group same categories together along angular wedges
    nonFocusNodes.sort((a, b) => (a.type || '').localeCompare(b.type || ''));

    const nodeCoords = {};
    const total = nonFocusNodes.length;
    nonFocusNodes.forEach((node, i) => {
      const angle = (i * 2 * Math.PI) / (total || 1);
      const isOuter = node.type === 'District' || node.type === 'State' || node.type === 'UrbanArea';
      const radius = isOuter ? 260 : 140;
      nodeCoords[node.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    });

    const simNodes = context.entities.map(node => {
      const isFocus = node.id === 'node-focus-polygon';
      const pos = isFocus 
        ? { x: centerX, y: centerY } 
        : nodeCoords[node.id] || { x: centerX + 150, y: centerY };

      return {
        ...node,
        x: pos.x,
        y: pos.y,
        vx: 0,
        vy: 0,
        fx: isFocus ? centerX : null, // Pin the focus node in the center
        fy: isFocus ? centerY : null,
        isPinned: isFocus
      };
    });

    const nodeMap = {};
    simNodes.forEach(n => {
      nodeMap[n.id] = n;
    });

    // Build links
    const simLinks = (context.relationships || [])
      .map(rel => {
        const sourceNode = nodeMap[rel.source];
        const targetNode = nodeMap[rel.target];
        if (!sourceNode || !targetNode) return null;
        return {
          source: sourceNode,
          target: targetNode,
          relation: rel.relation,
          properties: rel.properties
        };
      })
      .filter(Boolean);

    setNodes(simNodes);
    setLinks(simLinks);
    setSelectedNode(null);
    setTransform({ x: 0, y: 0, k: 1 });
    alphaRef.current = 1.0;
  }, [context]);

  // Simulation physics loop
  useEffect(() => {
    if (nodes.length === 0) return;

    let animFrameId;

    const runFrame = () => {
      // If system has cooled down, keep loop spinning but skip calculations
      if (alphaRef.current < 0.005) {
        for (let i = 0; i < activeNodes.length; i++) {
          const node = activeNodes[i];
          if (!node.fx) {
            node.vx = 0;
            node.vy = 0;
          }
        }
        animFrameId = requestAnimationFrame(runFrame);
        return;
      }

      const width = containerRef.current?.clientWidth || 800;
      const height = containerRef.current?.clientHeight || 600;
      const centerX = width / 2;
      const centerY = height / 2;
      const alpha = alphaRef.current;

      // 1. Repulsion force (Coulomb's Law)
      for (let i = 0; i < activeNodes.length; i++) {
        const nodeA = activeNodes[i];
        for (let j = i + 1; j < activeNodes.length; j++) {
          const nodeB = activeNodes[j];
          let dx = nodeB.x - nodeA.x;
          let dy = nodeB.y - nodeA.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 15) {
            // Assign a small random separation to resolve overlaps safely without division explosion!
            dx = (Math.random() - 0.5) * 6 + 1;
            dy = (Math.random() - 0.5) * 6 + 1;
            dist = Math.sqrt(dx * dx + dy * dy);
          }

          // Standard repulsion
          if (dist < 400) {
            const force = (repulsionStrength / (dist * dist + 100)) * alpha;
            const cappedForce = Math.min(10, force); // Cap maximum force per frame to prevent explosions
            const fx = (dx / dist) * cappedForce;
            const fy = (dy / dist) * cappedForce;

            if (!nodeA.fx) {
              nodeA.vx -= fx;
              nodeA.vy -= fy;
            }
            if (!nodeB.fx) {
              nodeB.vx += fx;
              nodeB.vy += fy;
            }
          }

          // Anti-overlapping / Hard collision protection
          if (dist < collisionRadius) {
            const overlap = collisionRadius - dist;
            const cx = (dx / dist) * overlap * 0.5 * Math.max(alpha, 0.2); // Keep overlapping resolution firm
            const cy = (dy / dist) * overlap * 0.5 * Math.max(alpha, 0.2);

            const cappedCx = Math.max(-8, Math.min(8, cx));
            const cappedCy = Math.max(-8, Math.min(8, cy));

            if (!nodeA.fx) {
              nodeA.vx -= cappedCx;
              nodeA.vy -= cappedCy;
            }
            if (!nodeB.fx) {
              nodeB.vx += cappedCx;
              nodeB.vy += cappedCy;
            }
          }
        }
      }

      // 2. Link Attraction force (Hooke's Law)
      for (let i = 0; i < activeLinks.length; i++) {
        const link = activeLinks[i];
        const nodeA = link.source;
        const nodeB = link.target;
        let dx = nodeB.x - nodeA.x;
        let dy = nodeB.y - nodeA.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 15) {
          dx = (Math.random() - 0.5) * 6 + 1;
          dy = (Math.random() - 0.5) * 6 + 1;
          dist = Math.sqrt(dx * dx + dy * dy);
        }

        const force = (dist - linkLength) * linkStrength * alpha;
        const cappedForce = Math.max(-10, Math.min(10, force)); // Cap link attraction force
        const fx = (dx / dist) * cappedForce;
        const fy = (dy / dist) * cappedForce;

        if (!nodeA.fx) {
          nodeA.vx += fx;
          nodeA.vy += fy;
        }
        if (!nodeB.fx) {
          nodeB.vx -= fx;
          nodeB.vy -= fy;
        }
      }

      // 3. Gravity/Center pulling force
      for (let i = 0; i < activeNodes.length; i++) {
        const node = activeNodes[i];
        if (node.fx) continue;

        const dx = centerX - node.x;
        const dy = centerY - node.y;
        
        node.vx += dx * gravity * alpha;
        node.vy += dy * gravity * alpha;
      }

      // 4. Apply velocities & friction, and measure node displacement
      let maxMovement = 0;
      let totalMovement = 0;

      for (let i = 0; i < activeNodes.length; i++) {
        const node = activeNodes[i];
        
        if (node.fx) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
        } else {
          node.x += node.vx;
          node.y += node.vy;
          
          const dx = node.vx;
          const dy = node.vy;
          const movement = Math.sqrt(dx * dx + dy * dy);
          if (movement > maxMovement) {
            maxMovement = movement;
          }
          totalMovement += movement;

          node.vx *= friction;
          node.vy *= friction;
        }
      }

      // Early stabilization cutoff: if maximum node movement is negligible, halt simulation immediately!
      const avgMovement = totalMovement / (activeNodes.length || 1);
      if (maxMovement < 0.15 && avgMovement < 0.08) {
        alphaRef.current = 0;
        for (let i = 0; i < activeNodes.length; i++) {
          const node = activeNodes[i];
          if (!node.fx) {
            node.vx = 0;
            node.vy = 0;
          }
        }
        animFrameId = requestAnimationFrame(runFrame);
        return;
      }

      // Adaptive cooling down
      if (alphaRef.current > 0.4) {
        alphaRef.current *= 0.93; // Cool rapidly for initial layout coarse adjustments
      } else {
        alphaRef.current *= 0.975; // Cool slowly to allow nodes to settle into equilibrium
      }

      // 5. Update DOM elements directly to bypass React virtual DOM re-render bottleneck!
      const nodeMap = {};
      for (let i = 0; i < activeNodes.length; i++) {
        const n = activeNodes[i];
        nodeMap[n.id] = n;
      }

      const lines = svgRef.current?.querySelectorAll('.graph-link');
      if (lines) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const srcId = line.getAttribute('data-source-id');
          const tgtId = line.getAttribute('data-target-id');
          const srcNode = nodeMap[srcId];
          const tgtNode = nodeMap[tgtId];
          if (srcNode && tgtNode) {
            line.setAttribute('x1', srcNode.x);
            line.setAttribute('y1', srcNode.y);
            line.setAttribute('x2', tgtNode.x);
            line.setAttribute('y2', tgtNode.y);
          }
        }
      }

      const nodeContainers = svgRef.current?.querySelectorAll('.graph-node-container');
      if (nodeContainers) {
        for (let i = 0; i < nodeContainers.length; i++) {
          const el = nodeContainers[i];
          const nodeId = el.getAttribute('data-node-id');
          const n = nodeMap[nodeId];
          if (n) {
            el.setAttribute('transform', `translate(${n.x}, ${n.y})`);
          }
        }
      }

      const labels = svgRef.current?.querySelectorAll('.link-label');
      if (labels) {
        for (let i = 0; i < labels.length; i++) {
          const label = labels[i];
          const srcId = label.getAttribute('data-source-id');
          const tgtId = label.getAttribute('data-target-id');
          const srcNode = nodeMap[srcId];
          const tgtNode = nodeMap[tgtId];
          if (srcNode && tgtNode) {
            label.setAttribute('transform', `translate(${(srcNode.x + tgtNode.x) / 2}, ${(srcNode.y + tgtNode.y) / 2})`);
          }
        }
      }

      animFrameId = requestAnimationFrame(runFrame);
    };

    animFrameId = requestAnimationFrame(runFrame);

    return () => cancelAnimationFrame(animFrameId);
  }, [nodes, activeNodes, activeLinks]);

  // Pan interaction
  const handleMouseDown = (e) => {
    // If clicking on a node, don't pan
    if (e.target.closest('.graph-node')) return;
    
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  const handleMouseMove = (e) => {
    if (isPanningRef.current) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      }));
    } else if (draggingNodeRef.current) {
      const node = draggingNodeRef.current;
      // Convert screen coordinate to SVG coordinate taking pan & zoom into account
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - transform.x) / transform.k;
      const mouseY = (e.clientY - rect.top - transform.y) / transform.k;
      
      node.fx = mouseX;
      node.fy = mouseY;
      node.x = mouseX;
      node.y = mouseY;
      alphaRef.current = 0.15; // Keep warm/active during drag
    }
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
    if (draggingNodeRef.current) {
      const node = draggingNodeRef.current;
      // If it's the focus node, leave it pinned. Others stay pinned unless user unpins.
      if (node.id !== 'node-focus-polygon' && !node.isPinned) {
        node.fx = null;
        node.fy = null;
      }
      draggingNodeRef.current = null;
      alphaRef.current = 1.0; // Fully reheat to settle after release
    }
  };

  const handleNodeMouseEnter = (node) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredNode(node);
    }, 30);
  };

  const handleNodeMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredNode(null);
    }, 30);
  };

  // Zoom interaction
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = 1.08;
    const direction = e.deltaY < 0 ? 1 : -1;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Current zoom
    const k = transform.k;
    // New zoom
    const newK = direction > 0 ? k * zoomFactor : k / zoomFactor;

    // Constraints
    if (newK < 0.15 || newK > 4) return;

    // Adjust offsets to zoom on mouse cursor
    const x = mouseX - (mouseX - transform.x) * (newK / k);
    const y = mouseY - (mouseY - transform.y) * (newK / k);

    setTransform({ x, y, k: newK });
  };

  // Node Drag Handlers
  const handleNodeDragStart = (e, node) => {
    e.stopPropagation();
    draggingNodeRef.current = node;
    node.fx = node.x;
    node.fy = node.y;
    alphaRef.current = 1.0; // Reheat
  };

  const toggleNodePin = (node) => {
    if (node.id === 'node-focus-polygon') return; // root focus is always pinned
    if (node.isPinned) {
      node.isPinned = false;
      node.fx = null;
      node.fy = null;
    } else {
      node.isPinned = true;
      node.fx = node.x;
      node.fy = node.y;
    }
    alphaRef.current = 1.0; // Reheat
  };

  // Toggle categories visibility
  const toggleCategory = (category) => {
    setDisabledCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
    alphaRef.current = 1.0; // Reheat to reorganize
  };

  const handleCenterMap = (node) => {
    if (!node || !node.properties?.coordinates || !mapRef.current) return;
    const [lon, lat] = node.properties.coordinates;
    const center = fromLonLat([lon, lat]);
    mapRef.current.getView().animate({
      center,
      zoom: 17,
      duration: 800
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md px-4">
      <div 
        ref={containerRef}
        className="relative w-[92vw] h-[90vh] rounded-[28px] border border-white/10 bg-[#07111f]/95 shadow-2xl flex flex-col overflow-hidden select-none"
      >
        {/* Modal Header */}
        <header className="flex items-center justify-between p-6 border-b border-white/10 z-10 bg-slate-900/60 backdrop-blur-md">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-bold text-white uppercase tracking-widest flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Area Knowledge Graph Explorer
            </h2>
            <p className="text-[10px] text-slate-400 tracking-wider">
              {activeNodes.length} nodes & {activeLinks.length} relations within selected polygon boundary
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/5 p-2.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Filter Pills Control Bar */}
        <section className="px-6 py-3.5 border-b border-white/10 bg-slate-950/40 z-10 flex flex-wrap items-center gap-2">
          <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mr-2">Toggle Layers:</span>
          {availableCategories.map(cat => {
            const isDisabled = disabledCategories[cat];
            const theme = ENTITY_COLORS[cat] || DEFAULT_COLOR;
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`text-[10px] px-3 py-1 rounded-full border transition-all duration-200 flex items-center gap-1.5 font-semibold ${
                  isDisabled
                    ? 'border-white/5 bg-white/2 text-slate-600'
                    : `bg-slate-900/50 text-slate-200 border-white/10 hover:border-${theme.stroke}`
                }`}
                style={{ borderColor: !isDisabled ? theme.stroke : undefined }}
              >
                {isDisabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" style={{ color: theme.stroke }} />}
                <span>{cat}</span>
              </button>
            );
          })}
          <div className="h-4 w-[1px] bg-white/10 mx-2" />
          <button
            onClick={() => {
              setShowNearRelations(prev => !prev);
              alphaRef.current = 1.0; // Reheat to reorganize
            }}
            className={`text-[10px] px-3.5 py-1 rounded-full border transition-all duration-200 flex items-center gap-1.5 font-bold uppercase tracking-wider ${
              showNearRelations
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'border-white/10 bg-slate-900/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            {showNearRelations ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            <span>Show Near Relations ({links.filter(l => l.relation === 'NEAR' || (l.relation && l.relation.toUpperCase() === 'NEAR')).length})</span>
          </button>
        </section>

        {/* SVG Visualization Canvas */}
        <div 
          className="flex-1 w-full relative bg-[#060c18] cursor-grab active:cursor-grabbing overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <svg
            ref={svgRef}
            className="w-full h-full"
          >
            {/* SVG Markers for Edge Arrows */}
            <defs>
              <marker
                id="arrow"
                viewBox="0 -5 10 10"
                refX="28" // Offsets the arrowhead slightly back from the node center
                refY="0"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,-4 L9,0 L0,4" fill="rgba(148, 163, 184, 0.4)" />
              </marker>
              <marker
                id="arrow-hover"
                viewBox="0 -5 10 10"
                refX="28"
                refY="0"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,-4 L9,0 L0,4" fill="#22d3ee" />
              </marker>
            </defs>

            {/* Transform Group (Zoom/Pan) */}
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              
              {/* Edges / Links */}
              <g className="links-group">
                {activeLinks.map((link, idx) => {
                  const isHovered = hoveredNode && (hoveredNode.id === link.source.id || hoveredNode.id === link.target.id);
                  const isSelected = selectedNode && (selectedNode.id === link.source.id || selectedNode.id === link.target.id);
                  
                  const isNear = link.relation === 'NEAR' || (link.relation && link.relation.toUpperCase() === 'NEAR');
                  // Level of Detail (LOD): Hide NEAR links when zoomed out unless connected to active node
                  const showNearLink = transform.k >= 0.5 || isHovered || isSelected;
                  if (isNear && !showNearLink) return null;
                  
                  const strokeColor = isSelected || isHovered ? '#22d3ee' : 'rgba(148, 163, 184, 0.25)';
                  const strokeWidth = isSelected || isHovered ? 2 : 1;
                  const opacity = hoveredNode && !isHovered ? 0.15 : 1;
                  const markerId = isSelected || isHovered ? 'url(#arrow-hover)' : 'url(#arrow)';

                  return (
                    <g key={idx} style={{ opacity, transition: 'opacity 0.2s' }}>
                      <line
                        className="graph-link"
                        data-source-id={link.source.id}
                        data-target-id={link.target.id}
                        x1={link.source.x}
                        y1={link.source.y}
                        x2={link.target.x}
                        y2={link.target.y}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        markerEnd={markerId}
                        strokeDasharray={link.relation === 'NEAR' ? '4 4' : undefined}
                      />
                      {/* Render relationship type label on link mid-point when hovered/selected */}
                      {(isHovered || isSelected) && (
                        <g 
                          className="link-label"
                          data-source-id={link.source.id}
                          data-target-id={link.target.id}
                          transform={`translate(${(link.source.x + link.target.x) / 2}, ${(link.source.y + link.target.y) / 2})`}
                        >
                          <rect
                            x="-32"
                            y="-8"
                            width="64"
                            height="15"
                            rx="4"
                            fill="rgba(15, 23, 42, 0.9)"
                            stroke="#22d3ee"
                            strokeWidth="0.5"
                          />
                          <text
                            textAnchor="middle"
                            y="2"
                            fill="#22d3ee"
                            fontSize="8"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {link.relation}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Nodes */}
              <g className="nodes-group">
                {activeNodes.map(node => {
                  const theme = ENTITY_COLORS[node.type] || DEFAULT_COLOR;
                  const isSelected = selectedNode?.id === node.id;
                  const isHovered = hoveredNode?.id === node.id;
                  const isNeighbor = hoveredNode && nodeConnections[hoveredNode.id]?.has(node.id);
                  
                  // Level of Detail (LOD): Hide node labels when zoomed out unless hovered, selected or neighbor
                  const showLabel = transform.k >= 0.6 || isSelected || isHovered || isNeighbor;
                  
                  const r = node.id === 'node-focus-polygon' ? 24 : 18;
                  const glowColor = isSelected || isHovered ? '#22d3ee' : theme.glow;
                  const strokeColor = isSelected || isHovered ? '#22d3ee' : theme.stroke;
                  const strokeWidth = isSelected ? 3.5 : isHovered ? 2.5 : 1.5;
                  
                  // Dim non-connected nodes during hover
                  let opacity = 1;
                  if (hoveredNode && hoveredNode.id !== node.id && !isNeighbor) {
                    opacity = 0.25;
                  }

                  const Icon = ENTITY_ICONS[node.type] || MapPin;

                  return (
                    <g
                      key={node.id}
                      className="graph-node cursor-pointer group graph-node-container"
                      data-node-id={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      style={{ opacity, transition: 'opacity 0.2s' }}
                      onMouseDown={(e) => handleNodeDragStart(e, node)}
                      onMouseEnter={() => handleNodeMouseEnter(node)}
                      onMouseLeave={handleNodeMouseLeave}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode(node);
                      }}
                      onDoubleClick={() => toggleNodePin(node)}
                    >
                      {/* Glow Ring */}
                      <circle
                        r={r + 4}
                        fill="none"
                        stroke={glowColor}
                        strokeWidth="5"
                        opacity={isHovered || isSelected ? 0.3 : 0.08}
                      />

                      {/* Base Circle */}
                      <circle
                        r={r}
                        fill={theme.fill}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
                      />

                      {/* Icon inside Node using foreignObject */}
                      <foreignObject
                        x={-10}
                        y={-10}
                        width="20"
                        height="20"
                        className="pointer-events-none"
                      >
                        <div 
                          className="flex items-center justify-center w-full h-full"
                          style={{ color: strokeColor }}
                        >
                          <Icon size={14} className="stroke-[2.5]" />
                        </div>
                      </foreignObject>

                      {/* Node Pin Marker indicator */}
                      {node.isPinned && node.id !== 'node-focus-polygon' && (
                        <circle
                          cx={r - 3}
                          cy={-r + 3}
                          r="3"
                          fill="#f59e0b"
                          stroke="#07111f"
                          strokeWidth="0.8"
                          title="Pinned"
                        />
                      )}

                      {/* Text Label */}
                      {showLabel && (
                        <text
                          textAnchor="middle"
                          y={r + 14}
                          fill={isSelected ? '#22d3ee' : '#cbd5e1'}
                          fontSize="9"
                          fontWeight={isSelected ? 'bold' : 'normal'}
                          className="pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                        >
                          {node.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>

            </g>
          </svg>

          {/* Canvas Guide Info Overlay */}
          <div className="absolute bottom-6 left-6 pointer-events-none bg-slate-900/60 border border-white/5 rounded-2xl p-3.5 backdrop-blur-md text-[10px] text-slate-400 space-y-1 z-10">
            <p className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span><strong>Drag</strong> on background to Pan</span>
            </p>
            <p className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span><strong>Scroll</strong> to Zoom in/out</span>
            </p>
            <p className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span><strong>Drag Node</strong> to relocate</span>
            </p>
            <p className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span><strong>Double-Click Node</strong> to Pin/Unpin</span>
            </p>
          </div>

          {/* Selected Node Details sliding panel */}
          {selectedNode && (() => {
            const theme = ENTITY_COLORS[selectedNode.type] || DEFAULT_COLOR;
            const props = selectedNode.properties || {};
            const semProps = props.semanticProperties || {};
            const semKeys = Object.keys(semProps);

            return (
              <div 
                className="absolute top-6 right-6 bottom-6 w-80 bg-[#0b1728]/95 border border-white/10 rounded-[24px] p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-4 overflow-y-auto z-20 transition-all duration-300 pointer-events-auto"
                onWheel={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseMove={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-3">
                  <div>
                    <span className={`inline-block text-[8px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border mb-2 ${theme.badge}`}>
                      {selectedNode.type}
                    </span>
                    <h3 className="text-xs font-bold text-white leading-snug">
                      {selectedNode.label}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-white/5 rounded-lg"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Main details body */}
                <div className="flex-1 flex flex-col gap-4 text-[11px] text-slate-300">
                  {/* Basic spatial props */}
                  <div className="space-y-2">
                    <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block">Spatial Metrics</span>
                    
                    {props.coordinates && (
                      <div className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-slate-900/40">
                        <span className="text-slate-400">Centroid</span>
                        <span className="font-mono text-cyan-300">
                          {props.coordinates[0]?.toFixed(5)}, {props.coordinates[1]?.toFixed(5)}
                        </span>
                      </div>
                    )}

                    {props.areaSqKm !== undefined && props.areaSqKm > 0 && (
                      <div className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-slate-900/40">
                        <span className="text-slate-400">Area</span>
                        <span className="font-mono text-slate-200">
                          {props.areaSqKm.toFixed(2)} sq km
                        </span>
                      </div>
                    )}

                    {props.perimeterKm !== undefined && props.perimeterKm > 0 && (
                      <div className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-slate-900/40">
                        <span className="text-slate-400">Perimeter</span>
                        <span className="font-mono text-slate-200">
                          {props.perimeterKm.toFixed(2)} km
                        </span>
                      </div>
                    )}

                    {props.elevation !== undefined && props.elevation !== null && (
                      <div className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-slate-900/40">
                        <span className="text-slate-400">Elevation (DEM)</span>
                        <span className="font-mono text-emerald-300">
                          {props.elevation.toFixed(1)} m
                        </span>
                      </div>
                    )}

                    {props.slope !== undefined && props.slope !== null && (
                      <div className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-slate-900/40">
                        <span className="text-slate-400">Slope (DEM)</span>
                        <span className="font-mono text-emerald-300">
                          {props.slope.toFixed(1)}°
                        </span>
                      </div>
                    )}

                    {props.distanceToCentroidMeters !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-slate-900/40">
                        <span className="text-slate-400">Dist to Area Center</span>
                        <span className="font-mono text-cyan-300">
                          {props.distanceToCentroidMeters.toFixed(0)} m
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Semantic attributes (from entity_properties) */}
                  {semKeys.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block">KG Entity Attributes</span>
                      <div className="space-y-1.5">
                        {semKeys.map(key => (
                          <div 
                            key={key}
                            className="flex flex-col gap-1 p-2 rounded-xl border border-white/5 bg-slate-900/40"
                          >
                            <span className="text-[9px] uppercase font-bold text-slate-400 font-mono tracking-wider">{key.replace(/_/g, ' ')}</span>
                            <span className="text-slate-200 leading-normal">{semProps[key]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Neighbors / Semantic Connections list */}
                  {nodeConnections[selectedNode.id]?.size > 0 && (
                    <div className="space-y-2">
                      <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block">Connected Entities</span>
                      <div className="space-y-1.5 max-h-[22vh] overflow-y-auto custom-scrollbar pr-1">
                        {activeLinks
                          .filter(l => l.source.id === selectedNode.id || l.target.id === selectedNode.id)
                          .map((l, idx) => {
                            const otherNode = l.source.id === selectedNode.id ? l.target : l.source;
                            const isIncoming = l.target.id === selectedNode.id;
                            return (
                              <button
                                key={idx}
                                onClick={() => setSelectedNode(otherNode)}
                                className="w-full text-left p-2 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-slate-950/80 hover:border-cyan-400/30 transition-all flex items-center justify-between gap-2"
                              >
                                <div className="truncate">
                                  <span className="text-[9px] font-mono text-cyan-400 block tracking-wider uppercase">
                                    {isIncoming ? '←' : '→'} {l.relation}
                                  </span>
                                  <span className="text-slate-200 font-sans font-medium truncate block">
                                    {otherNode.label}
                                  </span>
                                </div>
                                <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Map interaction button */}
                {props.coordinates && (
                  <button
                    onClick={() => handleCenterMap(selectedNode)}
                    className="w-full rounded-2xl bg-cyan-400 text-slate-950 py-2.5 text-xs font-bold transition-all hover:bg-cyan-300 shadow-lg shadow-cyan-400/10 flex items-center justify-center gap-2"
                  >
                    <LocateFixed className="h-4 w-4" />
                    <span>Focus Map here</span>
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
