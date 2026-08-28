// import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
// import ForceGraph3D from 'react-force-graph-3d';
// import * as THREE from 'three';
// import SpriteText from 'three-spritetext';

// // 1. NODE COLOR CODING
// const NODE_COLORS = { 
//   person: "#3b82f6", // Blue
//   phone: "#10b981", // Green
//   email: "#a855f7", // Purple
//   location: "#f97316", // Orange
//   organization: "#06b6d4", // Cyan
//   org: "#06b6d4", // Cyan
//   account: "#ec4899", // Pink
//   user: "#ec4899", // Pink
//   device: "#ef4444", // Red
//   ip: "#ef4444", // Red
//   default: "#9ca3af" // Gray
// };

// // 2. EDGE / RELATIONSHIP COLORS
// const EDGE_COLORS = { 
//   verified: "#059669", // Emerald (Solid)
//   possible_connection: "#d97706", // Dark Amber (Dashed)
//   default: "#4b5563" // Dark Gray (Unknown)
// };

// const NetworkGraph = ({
//   graphData,
//   onNodeClick,
//   onEdgeClick,
//   activeTimeRange,
//   currentCaseId
// }) => {
//   const fgRef = useRef();
//   const containerRef = useRef();
  
//   const [hoverNode, setHoverNode] = useState(null);
//   const [selectedNode, setSelectedNode] = useState(null);
//   const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

//   // Handle responsive resizing
//   useEffect(() => {
//     if (!containerRef.current) return;
//     const observer = new ResizeObserver(entries => {
//       if (!entries || !entries.length) return;
//       const { width, height } = entries[0].contentRect;
//       setDimensions({ width, height });
//     });
//     observer.observe(containerRef.current);
//     return () => observer.disconnect();
//   }, []);

//   // Configure layout engine
//   useEffect(() => {
//     if (fgRef.current) {
//       // Improve spacing and reduce overlap (Spread nodes out)
//       fgRef.current.d3Force('charge').strength(-800).distanceMax(1500);
//       fgRef.current.d3Force('link').distance(100);
      
//       // Auto-fit graph smoothly on load
//       setTimeout(() => {
//         if (fgRef.current) {
//           fgRef.current.zoomToFit(800, 80);
//         }
//       }, 600);
//     }
//   }, [dimensions]);

//   // Format data and calculate degrees for size
//   const formattedData = useMemo(() => {
//     if (!graphData || !graphData.nodes) return { nodes: [], links: [] };
    
//     const nodes = graphData.nodes.map(n => ({ ...n, id: n.id || n.canonicalId, degree: 0 }));
//     const links = (graphData.edges || []).map(e => ({ 
//       ...e, 
//       id: e.id || e.edgeId,
//       source: e.source || e.sourceEntityId,
//       target: e.target || e.targetEntityId 
//     }));

//     // Calculate degree for node sizing
//     links.forEach(link => {
//       const sourceNode = nodes.find(n => n.id === link.source || n.id === link.source?.id);
//       const targetNode = nodes.find(n => n.id === link.target || n.id === link.target?.id);
//       if (sourceNode) sourceNode.degree += 1;
//       if (targetNode) targetNode.degree += 1;
//     });

//     return { nodes, links };
//   }, [graphData]);

//   // Compute sets for hovering & selection highlight effects
//   const { highlightNodes, highlightLinks } = useMemo(() => {
//     const nodes = new Set();
//     const links = new Set();
//     const activeFocus = hoverNode || selectedNode;
    
//     if (activeFocus && formattedData) {
//       nodes.add(activeFocus.id);
//       formattedData.links.forEach(link => {
//         const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
//         const targetId = typeof link.target === 'object' ? link.target.id : link.target;
//         if (sourceId === activeFocus.id || targetId === activeFocus.id) {
//           links.add(link.id);
//           nodes.add(sourceId === activeFocus.id ? targetId : sourceId);
//         }
//       });
//     }
//     return { highlightNodes: nodes, highlightLinks: links };
//   }, [hoverNode, selectedNode, formattedData]);

//   const getNodeColor = useCallback((type) => {
//     const t = type?.toLowerCase();
//     return NODE_COLORS[t] || NODE_COLORS.default;
//   }, []);

//   const isEdgeInTimeRange = useCallback((edge, timeRange) => {
//     if (!timeRange || !timeRange.start || !timeRange.end || !edge.timestamp) return true;
//     const edgeTime = new Date(edge.timestamp).getTime();
//     const start = new Date(timeRange.start).getTime();
//     const end = new Date(timeRange.end).getTime();
//     return edgeTime >= start && edgeTime <= end;
//   }, []);

//   // Custom Node Renderer
//   const nodeThreeObject = useCallback(node => {
//     const activeFocus = hoverNode || selectedNode;
//     const isFocused = activeFocus && activeFocus.id === node.id;
//     const isHighlighted = activeFocus ? highlightNodes.has(node.id) : true;
//     const isActiveContext = currentCaseId ? (node.associatedCases || []).includes(currentCaseId) : true;
    
//     // Smooth fade for unrelated nodes, but active nodes are 100% opaque
//     let opacity = isHighlighted ? 1.0 : 0.15;
//     if (!isActiveContext && !isFocused) opacity = Math.min(opacity, 0.1);

//     let color = getNodeColor(node.type);
//     if (!isActiveContext && !isHighlighted) color = '#d1d5db';

//     const group = new THREE.Group();

//     // Node Sizing Strategy: Make nodes significantly smaller
//     const baseRadius = 4;
//     let radius = baseRadius;
//     if (node.attributes?.betweenness_centrality) {
//       radius = baseRadius + (node.attributes.betweenness_centrality * 10);
//     }
    
//     // Slight bump if focused
//     if (isFocused) {
//       radius *= 1.2;
//     }

//     // Node sphere
//     const geometry = new THREE.SphereGeometry(radius, 32, 32);
//     const material = new THREE.MeshPhongMaterial({
//       color,
//       transparent: true,
//       opacity, // Guaranteed to be 1.0 for active/highlighted nodes
//       shininess: isActiveContext ? 60 : 10,
//       emissive: isFocused ? color : '#000000',
//       emissiveIntensity: isFocused ? 0.3 : 0
//     });
//     const sphere = new THREE.Mesh(geometry, material);
//     group.add(sphere);

//     // Outline for selected node
//     if (selectedNode && selectedNode.id === node.id) {
//       const outlineGeo = new THREE.SphereGeometry(radius + 1.5, 32, 32);
//       const outlineMat = new THREE.MeshBasicMaterial({ color: '#1f2937', side: THREE.BackSide, transparent: true, opacity: 0.3 }); 
//       const outline = new THREE.Mesh(outlineGeo, outlineMat);
//       group.add(outline);
//     }

//     // Label Rendering
//     let labelText = 'Unknown';
//     if (Array.isArray(node.aliases) && node.aliases.length > 0 && node.aliases[0]) {
//       labelText = node.aliases[0];
//     } else if (node.type) {
//       labelText = node.type;
//     }
    
//     // Truncate long labels visually
//     if (labelText.length > 18) {
//       labelText = labelText.substring(0, 15) + '...';
//     }

//     const sprite = new SpriteText(labelText);
//     // Explicitly enforce high contrast gray-800 for active text
//     sprite.color = isHighlighted && isActiveContext ? '#1f2937' : (isActiveContext ? '#1f2937' : '#9ca3af');
    
//     if (isFocused) sprite.color = '#111827';
    
//     sprite.textHeight = isFocused ? 5 : (isHighlighted ? 4 : 3);
//     sprite.position.y = radius + 3;
    
//     // Add pill background to sprite for contrast
//     if (isHighlighted || isActiveContext) {
//       sprite.backgroundColor = 'rgba(255, 255, 255, 0.95)'; // Highly opaque pill
//       sprite.padding = [2, 4];
//       sprite.borderRadius = 4;
//     }
    
//     // Force text opacity to 1.0 for active context, ignore the node fade
//     sprite.material.opacity = isActiveContext ? 1.0 : Math.max(opacity, 0.4);
//     group.add(sprite);

//     return group;
//   }, [hoverNode, selectedNode, highlightNodes, getNodeColor, currentCaseId]);

//   // Custom Edge Creation
//   const linkThreeObject = useCallback(link => {
//     const isVerified = link.guardrailStatus === 'verified';
//     const isPossible = link.guardrailStatus === 'possible_connection';
    
//     let color = EDGE_COLORS.default;
//     if (isVerified) color = EDGE_COLORS.verified;
//     if (isPossible) color = EDGE_COLORS.possible_connection;
    
//     const material = isPossible 
//       ? new THREE.LineDashedMaterial({
//           color,
//           linewidth: 1,
//           dashSize: 3,
//           gapSize: 2,
//           transparent: true
//         })
//       : new THREE.LineBasicMaterial({
//           color,
//           linewidth: 1,
//           transparent: true
//         });

//     const geometry = new THREE.BufferGeometry();
//     const line = new THREE.Line(geometry, material);
//     line.linkData = link; 
//     return line;
//   }, []);

//   // Dynamic Custom Edge Updates
//   const linkPositionUpdate = useCallback((line, { start, end }) => {
//     const link = line.linkData;
//     if (!link) return false;

//     const positions = new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]);
//     line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
//     if (line.material.isLineDashedMaterial) {
//       line.computeLineDistances();
//     }

//     const inTimeRange = isEdgeInTimeRange(link, activeTimeRange);
//     const activeFocus = hoverNode || selectedNode;
//     const isHighlighted = activeFocus ? highlightLinks.has(link.id) : true;
//     const isActiveContext = currentCaseId ? (link.associatedCases || []).includes(currentCaseId) : true;
    
//     // Explicitly set base opacity to 1.0 for active context edges (no washout)
//     let targetOpacity = 1.0;
//     if (!inTimeRange) targetOpacity = 0.05;
    
//     if (activeFocus && !isHighlighted) targetOpacity = Math.min(targetOpacity, 0.02);
//     if (isHighlighted && activeFocus) targetOpacity = 1.0;
//     if (!isActiveContext && !isHighlighted) targetOpacity = Math.min(targetOpacity, 0.1);

//     line.material.opacity = targetOpacity;
    
//     const isVerified = link.guardrailStatus === 'verified';
//     const isPossible = link.guardrailStatus === 'possible_connection';
//     let targetColor = new THREE.Color(EDGE_COLORS.default);
    
//     if (isActiveContext) {
//       if (isVerified) targetColor.set(EDGE_COLORS.verified);
//       if (isPossible) targetColor.set(EDGE_COLORS.possible_connection);
//     } else {
//       targetColor.set('#e5e7eb'); // Light mode dimmed edge
//     }
    
//     if (activeFocus && isHighlighted) {
//       targetColor.lerp(new THREE.Color('#000000'), 0.2); // Darken instead of lighten in light theme
//     }

//     line.material.color = targetColor;
//     return true; 
//   }, [hoverNode, selectedNode, highlightLinks, activeTimeRange, isEdgeInTimeRange, currentCaseId]);

//   // Graph Controls
//   const handleZoomIn = () => {
//     if (!fgRef.current) return;
//     const currentCam = fgRef.current.cameraPosition();
//     fgRef.current.cameraPosition({ z: currentCam.z * 0.7 }, currentCam, 400);
//   };
  
//   const handleZoomOut = () => {
//     if (!fgRef.current) return;
//     const currentCam = fgRef.current.cameraPosition();
//     fgRef.current.cameraPosition({ z: currentCam.z * 1.4 }, currentCam, 400);
//   };
  
//   const handleFitGraph = () => {
//     if (!fgRef.current) return;
//     fgRef.current.zoomToFit(600, 50);
//   };

//   const handleNodeClick = (node) => {
//     setSelectedNode(node);
//     if (onNodeClick) onNodeClick(node.id);
//   };

//   if (!formattedData.nodes.length) {
//     return (
//       <div className="flex items-center justify-center w-full h-full min-h-[400px] bg-slate-900 text-slate-400 rounded-lg shadow-inner">
//         <div className="flex flex-col items-center">
//           <svg className="w-12 h-12 mb-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
//           </svg>
//           <span className="text-lg font-medium">No case data available</span>
//           <span className="text-sm">Graph requires entities and relationships to render</span>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div ref={containerRef} className="w-full h-full min-h-[500px] rounded-lg overflow-hidden relative" style={{ backgroundColor: '#FAF8F0' }}>
      
//       {/* 7. GRAPH BACKGROUND - Subtle Dot Pattern */}
//       <div className="absolute inset-0 pointer-events-none opacity-40" 
//         style={{ 
//           backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', 
//           backgroundSize: '24px 24px' 
//         }}>
//       </div>
      
//       <div className="absolute inset-0 pointer-events-none opacity-30 bg-gradient-to-br from-white via-transparent to-gray-100"></div>

//       {dimensions.width > 0 && dimensions.height > 0 && (
//         <ForceGraph3D
//           ref={fgRef}
//           width={dimensions.width}
//           height={dimensions.height}
//           graphData={formattedData}
//           nodeId="id"
//           nodeThreeObject={nodeThreeObject}
//           linkThreeObject={linkThreeObject}
//           linkPositionUpdate={linkPositionUpdate}
//           onNodeClick={handleNodeClick}
//           onLinkClick={link => onEdgeClick && onEdgeClick(link.id)}
//           onNodeHover={node => setHoverNode(node || null)}
//           onBackgroundClick={() => setSelectedNode(null)}
//           backgroundColor="rgba(0,0,0,0)" // Transparent to show HTML background
//           showNavInfo={false}
//           enableNodeDrag={true}
//           // 5. HOVER INTERACTION - Clean Tooltip
//           nodeLabel={node => {
//             const alias = Array.isArray(node.aliases) && node.aliases.length > 0 ? node.aliases[0] : 'Unknown';
//             const color = getNodeColor(node.type);
//             return `
//               <div style="background: rgba(255, 255, 255, 0.95); padding: 12px; border-radius: 8px; border-left: 4px solid ${color}; color: #1f2937; font-family: ui-sans-serif, system-ui, sans-serif; box-shadow: 0 4px 15px -3px rgba(0, 0, 0, 0.1); font-size: 13px; min-width: 180px;">
//                 <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 4px;">
//                   ${node.type || 'Entity'}
//                 </div>
//                 <div style="font-weight: 600; font-size: 15px; margin-bottom: 8px;">
//                   ${alias}
//                 </div>
//                 <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e5e7eb; padding-top: 8px;">
//                   <span style="color: #4b5563;">Connections</span>
//                   <span style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${node.degree}</span>
//                 </div>
//               </div>
//             `;
//           }}
//         />
//       )}
      
//       {/* 10. LEGEND */}
//       <div className="absolute top-4 left-4 p-4 bg-white/90 backdrop-blur border border-gray-200 rounded-lg shadow-md pointer-events-none text-xs text-gray-700 min-w-[180px]">
//         <h4 className="font-semibold text-gray-900 mb-3 tracking-wide">ENTITY TYPES</h4>
//         <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-5">
//           <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.person}}></div><span>Person</span></div>
//           <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.phone}}></div><span>Phone</span></div>
//           <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.email}}></div><span>Email</span></div>
//           <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.location}}></div><span>Location</span></div>
//           <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.org}}></div><span>Org</span></div>
//           <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.device}}></div><span>Device</span></div>
//         </div>

//         <h4 className="font-semibold text-gray-900 mb-3 tracking-wide">RELATIONSHIP</h4>
//         <div className="flex items-center gap-2 mb-2">
//           <div className="w-8 h-0.5" style={{backgroundColor: EDGE_COLORS.verified}}></div>
//           <span>Verified</span>
//         </div>
//         <div className="flex items-center gap-2 mb-2">
//           <div className="w-8 border-b-2 border-dashed" style={{borderColor: EDGE_COLORS.possible_connection}}></div>
//           <span>Possible</span>
//         </div>
//         <div className="flex items-center gap-2">
//           <div className="w-8 h-0.5 bg-gray-400"></div>
//           <span>Unknown</span>
//         </div>
//       </div>

//       {/* 11. ZOOM / PAN CONTROLS */}
//       <div className="absolute bottom-6 right-6 flex flex-col gap-2">
//         <button onClick={handleFitGraph} className="p-2 bg-white/90 hover:bg-gray-50 border border-gray-200 rounded text-gray-700 transition shadow-md group relative" aria-label="Fit Graph">
//           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
//         </button>
//         <button onClick={handleZoomIn} className="p-2 bg-white/90 hover:bg-gray-50 border border-gray-200 rounded text-gray-700 transition shadow-md" aria-label="Zoom In">
//           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
//         </button>
//         <button onClick={handleZoomOut} className="p-2 bg-white/90 hover:bg-gray-50 border border-gray-200 rounded text-gray-700 transition shadow-md" aria-label="Zoom Out">
//           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"></path></svg>
//         </button>
//       </div>

//       {/* Clear Selection Hint */}
//       {selectedNode && (
//         <div className="absolute top-4 right-4 animate-fade-in">
//           <button onClick={() => setSelectedNode(null)} className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold rounded-md shadow-md border border-gray-200 transition flex items-center gap-2">
//             <span>Clear Selection</span>
//             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
//           </button>
//         </div>
//       )}
//     </div>
//   );
// };

// export default NetworkGraph;


import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';

// 1. NODE COLOR CODING
const NODE_COLORS = { 
  person: "#3b82f6", // Blue
  phone: "#10b981", // Green
  email: "#a855f7", // Purple
  location: "#f97316", // Orange
  organization: "#06b6d4", // Cyan
  org: "#06b6d4", // Cyan
  account: "#ec4899", // Pink
  user: "#ec4899", // Pink
  device: "#ef4444", // Red
  ip: "#ef4444", // Red
  default: "#9ca3af" // Gray
};

// 2. EDGE / RELATIONSHIP COLORS
const EDGE_COLORS = { 
  verified: "#059669", // Emerald (Solid)
  possible_connection: "#d97706", // Dark Amber (Dashed)
  default: "#4b5563" // Dark Gray (Unknown)
};

const NetworkGraph = ({
  graphData,
  onNodeClick,
  onEdgeClick,
  activeTimeRange,
  currentCaseId
}) => {
  const fgRef = useRef();
  const containerRef = useRef();
  
  const [hoverNode, setHoverNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Handle responsive resizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      if (!entries || !entries.length) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Configure layout engine
  useEffect(() => {
    if (fgRef.current) {
      // Improve spacing and reduce overlap (Spread nodes out)
      fgRef.current.d3Force('charge').strength(-800).distanceMax(1500);
      fgRef.current.d3Force('link').distance(100);
      
      // Auto-fit graph smoothly on load
      setTimeout(() => {
        if (fgRef.current) {
          fgRef.current.zoomToFit(800, 80);
        }
      }, 600);
    }
  }, [dimensions]);

  // Format data and calculate degrees for size
  const formattedData = useMemo(() => {
    if (!graphData || !graphData.nodes) return { nodes: [], links: [] };
    
    const nodes = graphData.nodes.map(n => ({ ...n, id: n.id || n.canonicalId, degree: 0 }));
    const links = (graphData.edges || []).map(e => ({ 
      ...e, 
      id: e.id || e.edgeId,
      source: e.source || e.sourceEntityId,
      target: e.target || e.targetEntityId 
    }));

    // Calculate degree for node sizing
    links.forEach(link => {
      const sourceNode = nodes.find(n => n.id === link.source || n.id === link.source?.id);
      const targetNode = nodes.find(n => n.id === link.target || n.id === link.target?.id);
      if (sourceNode) sourceNode.degree += 1;
      if (targetNode) targetNode.degree += 1;
    });

    return { nodes, links };
  }, [graphData]);

  // Determine whether ANY entity/edge in this dataset is actually tagged with
  // currentCaseId. If nothing matches (e.g. associatedCases is missing/empty
  // across the board, or currentCaseId wasn't passed through correctly),
  // fall back to treating everything as "active" so the graph doesn't render
  // as a washed-out ghost by default.
  const hasAnyCaseMatch = useMemo(() => {
    if (!currentCaseId) return true;
    const nodeMatch = formattedData.nodes.some(n => (n.associatedCases || []).includes(currentCaseId));
    const linkMatch = formattedData.links.some(l => (l.associatedCases || []).includes(currentCaseId));
    return nodeMatch || linkMatch;
  }, [formattedData, currentCaseId]);

  const isNodeInActiveContext = useCallback((node) => {
    if (!currentCaseId || !hasAnyCaseMatch) return true;
    return (node.associatedCases || []).includes(currentCaseId);
  }, [currentCaseId, hasAnyCaseMatch]);

  const isLinkInActiveContext = useCallback((link) => {
    if (!currentCaseId || !hasAnyCaseMatch) return true;
    return (link.associatedCases || []).includes(currentCaseId);
  }, [currentCaseId, hasAnyCaseMatch]);

  // Compute sets for hovering & selection highlight effects
  const { highlightNodes, highlightLinks } = useMemo(() => {
    const nodes = new Set();
    const links = new Set();
    const activeFocus = hoverNode || selectedNode;
    
    if (activeFocus && formattedData) {
      nodes.add(activeFocus.id);
      formattedData.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (sourceId === activeFocus.id || targetId === activeFocus.id) {
          links.add(link.id);
          nodes.add(sourceId === activeFocus.id ? targetId : sourceId);
        }
      });
    }
    return { highlightNodes: nodes, highlightLinks: links };
  }, [hoverNode, selectedNode, formattedData]);

  const getNodeColor = useCallback((type) => {
    const t = type?.toLowerCase();
    return NODE_COLORS[t] || NODE_COLORS.default;
  }, []);

  const isEdgeInTimeRange = useCallback((edge, timeRange) => {
    if (!timeRange || !timeRange.start || !timeRange.end || !edge.timestamp) return true;
    const edgeTime = new Date(edge.timestamp).getTime();
    const start = new Date(timeRange.start).getTime();
    const end = new Date(timeRange.end).getTime();
    return edgeTime >= start && edgeTime <= end;
  }, []);

  // Custom Node Renderer
  const nodeThreeObject = useCallback(node => {
    const activeFocus = hoverNode || selectedNode;
    const isFocused = activeFocus && activeFocus.id === node.id;
    const isHighlighted = activeFocus ? highlightNodes.has(node.id) : true;
    const isActiveContext = isNodeInActiveContext(node);
    
    // Smooth fade for unrelated nodes, but active nodes are 100% opaque.
    // Floors raised so nothing drops below a visible minimum.
    let opacity = isHighlighted ? 1.0 : 0.4;
    if (!isActiveContext && !isFocused) opacity = Math.max(opacity, 0.55);

    let color = getNodeColor(node.type);
    if (!isActiveContext && !isHighlighted) color = '#9ca3af';

    const group = new THREE.Group();

    // Node Sizing Strategy: Make nodes significantly smaller
    const baseRadius = 4;
    let radius = baseRadius;
    if (node.attributes?.betweenness_centrality) {
      radius = baseRadius + (node.attributes.betweenness_centrality * 10);
    }
    
    // Slight bump if focused
    if (isFocused) {
      radius *= 1.2;
    }

    // Node sphere
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity,
      shininess: isActiveContext ? 60 : 10,
      emissive: isFocused ? color : '#000000',
      emissiveIntensity: isFocused ? 0.3 : 0
    });
    const sphere = new THREE.Mesh(geometry, material);
    group.add(sphere);

    // Outline for selected node
    if (selectedNode && selectedNode.id === node.id) {
      const outlineGeo = new THREE.SphereGeometry(radius + 1.5, 32, 32);
      const outlineMat = new THREE.MeshBasicMaterial({ color: '#1f2937', side: THREE.BackSide, transparent: true, opacity: 0.3 }); 
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      group.add(outline);
    }

    // Label Rendering
    let labelText = 'Unknown';
    if (Array.isArray(node.aliases) && node.aliases.length > 0 && node.aliases[0]) {
      labelText = node.aliases[0];
    } else if (node.type) {
      labelText = node.type;
    }
    
    // Truncate long labels visually
    if (labelText.length > 18) {
      labelText = labelText.substring(0, 15) + '...';
    }

    const sprite = new SpriteText(labelText);
    // Keep label text dark/readable regardless of active-context state —
    // light gray text on a light background was effectively invisible.
    sprite.color = isFocused ? '#111827' : '#1f2937';
    
    sprite.textHeight = isFocused ? 5 : (isHighlighted ? 4 : 3);
    sprite.position.y = radius + 3;
    
    // Add pill background to sprite for contrast
    sprite.backgroundColor = 'rgba(255, 255, 255, 0.95)';
    sprite.padding = [2, 4];
    sprite.borderRadius = 4;
    
    // Raised floor so labels never fade near-invisible
    sprite.material.opacity = isActiveContext ? 1.0 : Math.max(opacity, 0.75);
    group.add(sprite);

    return group;
  }, [hoverNode, selectedNode, highlightNodes, getNodeColor, isNodeInActiveContext]);

  // Custom Edge Creation
  const linkThreeObject = useCallback(link => {
    const isVerified = link.guardrailStatus === 'verified';
    const isPossible = link.guardrailStatus === 'possible_connection';
    
    let color = EDGE_COLORS.default;
    if (isVerified) color = EDGE_COLORS.verified;
    if (isPossible) color = EDGE_COLORS.possible_connection;
    
    const material = isPossible 
      ? new THREE.LineDashedMaterial({
          color,
          linewidth: 1,
          dashSize: 3,
          gapSize: 2,
          transparent: true
        })
      : new THREE.LineBasicMaterial({
          color,
          linewidth: 1,
          transparent: true
        });

    const geometry = new THREE.BufferGeometry();
    const line = new THREE.Line(geometry, material);
    line.linkData = link; 
    return line;
  }, []);

  // Dynamic Custom Edge Updates
  const linkPositionUpdate = useCallback((line, { start, end }) => {
    const link = line.linkData;
    if (!link) return false;

    const positions = new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]);
    line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    if (line.material.isLineDashedMaterial) {
      line.computeLineDistances();
    }

    const inTimeRange = isEdgeInTimeRange(link, activeTimeRange);
    const activeFocus = hoverNode || selectedNode;
    const isHighlighted = activeFocus ? highlightLinks.has(link.id) : true;
    const isActiveContext = isLinkInActiveContext(link);
    
    // Raised floors throughout so edges stay visible against the light
    // background instead of fading to near-zero.
    let targetOpacity = 1.0;
    if (!inTimeRange) targetOpacity = 0.2;
    if (activeFocus && !isHighlighted) targetOpacity = Math.min(targetOpacity, 0.15);
    if (isHighlighted && activeFocus) targetOpacity = 1.0;
    if (!isActiveContext && !isHighlighted) targetOpacity = Math.max(targetOpacity, 0.45);

    line.material.opacity = targetOpacity;
    
    const isVerified = link.guardrailStatus === 'verified';
    const isPossible = link.guardrailStatus === 'possible_connection';
    let targetColor = new THREE.Color(EDGE_COLORS.default);
    
    if (isActiveContext) {
      if (isVerified) targetColor.set(EDGE_COLORS.verified);
      if (isPossible) targetColor.set(EDGE_COLORS.possible_connection);
    } else {
      targetColor.set('#9ca3af'); // Darker dimmed edge so it still reads on light bg
    }
    
    if (activeFocus && isHighlighted) {
      targetColor.lerp(new THREE.Color('#000000'), 0.2); // Darken instead of lighten in light theme
    }

    line.material.color = targetColor;
    return true; 
  }, [hoverNode, selectedNode, highlightLinks, activeTimeRange, isEdgeInTimeRange, isLinkInActiveContext]);

  // Graph Controls
  const handleZoomIn = () => {
    if (!fgRef.current) return;
    const currentCam = fgRef.current.cameraPosition();
    fgRef.current.cameraPosition({ z: currentCam.z * 0.7 }, currentCam, 400);
  };
  
  const handleZoomOut = () => {
    if (!fgRef.current) return;
    const currentCam = fgRef.current.cameraPosition();
    fgRef.current.cameraPosition({ z: currentCam.z * 1.4 }, currentCam, 400);
  };
  
  const handleFitGraph = () => {
    if (!fgRef.current) return;
    fgRef.current.zoomToFit(600, 50);
  };

  const handleNodeClick = (node) => {
    setSelectedNode(node);
    if (onNodeClick) onNodeClick(node.id);
  };

  if (!formattedData.nodes.length) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px] bg-slate-900 text-slate-400 rounded-lg shadow-inner">
        <div className="flex flex-col items-center">
          <svg className="w-12 h-12 mb-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span className="text-lg font-medium">No case data available</span>
          <span className="text-sm">Graph requires entities and relationships to render</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full min-h-[500px] rounded-lg overflow-hidden relative" style={{ backgroundColor: '#FAF8F0' }}>
      
      {/* 7. GRAPH BACKGROUND - Subtle Dot Pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-40" 
        style={{ 
          backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', 
          backgroundSize: '24px 24px' 
        }}>
      </div>
      
      <div className="absolute inset-0 pointer-events-none opacity-30 bg-gradient-to-br from-white via-transparent to-gray-100"></div>

      {dimensions.width > 0 && dimensions.height > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={formattedData}
          nodeId="id"
          nodeThreeObject={nodeThreeObject}
          linkThreeObject={linkThreeObject}
          linkPositionUpdate={linkPositionUpdate}
          onNodeClick={handleNodeClick}
          onLinkClick={link => onEdgeClick && onEdgeClick(link.id)}
          onNodeHover={node => setHoverNode(node || null)}
          onBackgroundClick={() => setSelectedNode(null)}
          backgroundColor="rgba(0,0,0,0)" // Transparent to show HTML background
          showNavInfo={false}
          enableNodeDrag={true}
          // 5. HOVER INTERACTION - Clean Tooltip
          nodeLabel={node => {
            const alias = Array.isArray(node.aliases) && node.aliases.length > 0 ? node.aliases[0] : 'Unknown';
            const color = getNodeColor(node.type);
            return `
              <div style="background: rgba(255, 255, 255, 0.95); padding: 12px; border-radius: 8px; border-left: 4px solid ${color}; color: #1f2937; font-family: ui-sans-serif, system-ui, sans-serif; box-shadow: 0 4px 15px -3px rgba(0, 0, 0, 0.1); font-size: 13px; min-width: 180px;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 4px;">
                  ${node.type || 'Entity'}
                </div>
                <div style="font-weight: 600; font-size: 15px; margin-bottom: 8px;">
                  ${alias}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e5e7eb; padding-top: 8px;">
                  <span style="color: #4b5563;">Connections</span>
                  <span style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${node.degree}</span>
                </div>
              </div>
            `;
          }}
        />
      )}
      
      {/* 10. LEGEND */}
      <div className="absolute top-4 left-4 p-4 bg-white/90 backdrop-blur border border-gray-200 rounded-lg shadow-md pointer-events-none text-xs text-gray-700 min-w-[180px]">
        <h4 className="font-semibold text-gray-900 mb-3 tracking-wide">ENTITY TYPES</h4>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-5">
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.person}}></div><span>Person</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.phone}}></div><span>Phone</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.email}}></div><span>Email</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.location}}></div><span>Location</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.org}}></div><span>Org</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: NODE_COLORS.device}}></div><span>Device</span></div>
        </div>

        <h4 className="font-semibold text-gray-900 mb-3 tracking-wide">RELATIONSHIP</h4>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-0.5" style={{backgroundColor: EDGE_COLORS.verified}}></div>
          <span>Verified</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 border-b-2 border-dashed" style={{borderColor: EDGE_COLORS.possible_connection}}></div>
          <span>Possible</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 bg-gray-400"></div>
          <span>Unknown</span>
        </div>
      </div>

      {/* 11. ZOOM / PAN CONTROLS */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
        <button onClick={handleFitGraph} className="p-2 bg-white/90 hover:bg-gray-50 border border-gray-200 rounded text-gray-700 transition shadow-md group relative" aria-label="Fit Graph">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
        </button>
        <button onClick={handleZoomIn} className="p-2 bg-white/90 hover:bg-gray-50 border border-gray-200 rounded text-gray-700 transition shadow-md" aria-label="Zoom In">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
        </button>
        <button onClick={handleZoomOut} className="p-2 bg-white/90 hover:bg-gray-50 border border-gray-200 rounded text-gray-700 transition shadow-md" aria-label="Zoom Out">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"></path></svg>
        </button>
      </div>

      {/* Clear Selection Hint */}
      {selectedNode && (
        <div className="absolute top-4 right-4 animate-fade-in">
          <button onClick={() => setSelectedNode(null)} className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold rounded-md shadow-md border border-gray-200 transition flex items-center gap-2">
            <span>Clear Selection</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default NetworkGraph;

