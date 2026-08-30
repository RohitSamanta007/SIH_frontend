import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient.js';
import { useAuth } from '../state/authContext.jsx';
import NetworkGraph from '../components/graph/NetworkGraph.jsx';
import { useEntityLookup } from '../hooks/useEntityLookup.js';

const CARD_SHADOW =
  '0 0 0 1px rgba(0,0,0,0.08), 0px 2px 2px rgba(0,0,0,0.04), 0px 8px 16px -4px rgba(0,0,0,0.04)';

const STATUS_BADGE_CLASSES = {
  completed: 'bg-[#d3e5ff] text-[#0761d1]',
  failed: 'bg-[#f7d4d6] text-[#c50000]',
  pending: 'bg-[#ffefcf] text-[#ab570a]',
  processing: 'bg-[#ffefcf] text-[#ab570a]',
  verified: 'bg-[#d1fae5] text-[#065f46]',
  approved: 'bg-[#d1fae5] text-[#065f46]',
  rejected: 'bg-[#fee2e2] text-[#991b1b]',
  flagged: 'bg-[#ffefcf] text-[#ab570a]',
  unspecified: 'bg-[#f3f4f6] text-[#374151]',
  open: 'bg-[#d1fae5] text-[#065f46]', // light green
  closed: 'bg-[#fee2e2] text-[#991b1b]', // light red
};

const GRAPH_LAYOUT_COLUMNS = 4;
const GRAPH_COLUMN_GAP = 240;
const GRAPH_ROW_GAP = 140;

function formatTimelineTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const classes = STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${classes}`}
    >
      {status}
    </span>
  );
}

// Custom node types registry removed as NetworkGraph handles it internally

function buildGraphPayload(graphData) {
  const rawNodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
  const rawEdges = Array.isArray(graphData?.edges) ? graphData.edges : [];

  const unmappedNodes = [];
  const nodeIds = new Set();

  rawNodes.forEach((node, index) => {
    const canonicalId = typeof node?.canonicalId === 'string' ? node.canonicalId.trim() : '';
    if (!canonicalId) {
      unmappedNodes.push(`node[${index}] has no canonicalId`);
      return;
    }
    nodeIds.add(canonicalId);
  });

  const flowNodes = rawNodes
    .filter((node) => typeof node?.canonicalId === 'string' && node.canonicalId.trim())
    .map((node, index) => ({
      id: node.canonicalId.trim(),
      type: 'entity',
      position: {
        x: (index % GRAPH_LAYOUT_COLUMNS) * GRAPH_COLUMN_GAP,
        y: Math.floor(index / GRAPH_LAYOUT_COLUMNS) * GRAPH_ROW_GAP,
      },
      data: {
        canonicalId: node.canonicalId.trim(),
        type: typeof node.type === 'string' && node.type.trim() ? node.type.trim() : null,
        aliases: Array.isArray(node.aliases)
          ? node.aliases
              .filter((alias) => typeof alias === 'string' && alias.trim())
              .map((alias) => alias.trim())
          : [],
        confidence: typeof node.confidence === 'number' ? node.confidence : null,
      },
    }));

  const unmappedEdges = [];

  const flowEdges = rawEdges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge, index }) => {
      const source = typeof edge?.source === 'string' ? edge.source : '';
      const target = typeof edge?.target === 'string' ? edge.target : '';
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
        const endpoint =
          !source || !nodeIds.has(source)
            ? `source '${source || 'missing'}'`
            : `target '${target || 'missing'}'`;
        unmappedEdges.push(`edge[${index}] (id ${edge?.id ?? 'unknown'}) references unknown ${endpoint}`);
        return false;
      }
      return true;
    })
    .map(({ edge }) => ({
      id: String(edge.id),
      source: edge.source,
      target: edge.target,
      label: typeof edge.edgeType === 'string' && edge.edgeType.trim() ? edge.edgeType.trim() : undefined,
      labelStyle: { fill: '#4d4d4d', fontSize: 10 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4,
      style: { stroke: '#a1a1a1' },
    }));

  return { flowNodes, flowEdges, unmappedNodes, unmappedEdges };
}

function TimelineEventRow({ event, index, getEntityName, onClick }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const ts = formatTimelineTimestamp(event?.timestamp);
  const source = typeof event?.source === 'string' ? event.source.trim() : '';
  const target = typeof event?.target === 'string' ? event.target.trim() : '';
  const edgeType = typeof event?.edgeType === 'string' ? event.edgeType.trim() : '';
  const evidenceCount = Array.isArray(event?.evidence) ? event.evidence.length : null;

  const sourceName = getEntityName(source);
  const targetName = getEntityName(target);
  
  const key = typeof event?.id === 'string' && event.id.trim() ? event.id.trim() : `timeline-${index}`;

  return (
    <li key={key} className="flex flex-col border-b border-[#ebebeb] last:border-0 bg-white">
      <div className="flex w-full items-start gap-4 px-6 py-4 text-left transition-colors">
        <p className="w-44 shrink-0 font-mono text-xs leading-5 text-[#888888] pt-0.5">{ts ?? 'Undated'}</p>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-[#171717] font-medium" title={`${sourceName} ↔ ${targetName}`}>
            {sourceName} <span className="text-[#a1a1a1] mx-1">↔</span> {targetName}
          </p>
          {(edgeType || evidenceCount !== null) && (
            <p className="mt-1 font-mono text-xs uppercase tracking-wide text-[#888888]">
              {edgeType && <span>{edgeType}</span>}
              {edgeType && evidenceCount !== null && <span className="mx-1 text-[#ebebeb]">·</span>}
              {evidenceCount !== null && <span>{evidenceCount} evidence {evidenceCount === 1 ? 'record' : 'records'}</span>}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}


// Timeline range scrubber — rendered below the graph
function TimelineScrubber({ bounds, activeRange, onChange }) {
  const totalMs = bounds.max - bounds.min;
  const timestamps = bounds.timestamps || [];

  const snapToNearest = (ms) => {
    if (!timestamps.length) return ms;
    return timestamps.reduce((prev, curr) => 
      Math.abs(curr - ms) < Math.abs(prev - ms) ? curr : prev
    );
  };

  const startPct = activeRange
    ? ((new Date(activeRange.start).getTime() - bounds.min) / totalMs) * 100
    : 0;
  const endPct = activeRange
    ? ((new Date(activeRange.end).getTime() - bounds.min) / totalMs) * 100
    : 100;

  const fmtDate = (ms) =>
    new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const handleStartChange = (e) => {
    const pct = Number(e.target.value);
    const rawStart = bounds.min + (pct / 100) * totalMs;
    const snappedStart = snapToNearest(rawStart);
    const curEnd = activeRange ? new Date(activeRange.end).getTime() : bounds.max;
    
    if (snappedStart >= curEnd) return;
    onChange({ start: new Date(snappedStart).toISOString(), end: new Date(curEnd).toISOString() });
  };

  const handleEndChange = (e) => {
    const pct = Number(e.target.value);
    const rawEnd = bounds.min + (pct / 100) * totalMs;
    const snappedEnd = snapToNearest(rawEnd);
    const curStart = activeRange ? new Date(activeRange.start).getTime() : bounds.min;
    
    if (snappedEnd <= curStart) return;
    onChange({ start: new Date(curStart).toISOString(), end: new Date(snappedEnd).toISOString() });
  };

  const handleReset = () => onChange(null);

  const displayStart = activeRange
    ? fmtDate(new Date(activeRange.start).getTime())
    : fmtDate(bounds.min);
  const displayEnd = activeRange
    ? fmtDate(new Date(activeRange.end).getTime())
    : fmtDate(bounds.max);

  return (
    <div className="px-6 py-4 border-t border-[#ebebeb] bg-[#fafafa]">
      <div className="flex items-center justify-between mb-2">
        <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
          Timeline Filter
        </p>
        {activeRange && (
          <button
            onClick={handleReset}
            className="font-mono text-xs text-[#888888] hover:text-[#171717] transition-colors underline underline-offset-2"
          >
            Reset
          </button>
        )}
      </div>

      {/* Date labels */}
      <div className="flex justify-between mb-1">
        <span className="font-mono text-xs text-[#0761d1] font-medium">{displayStart}</span>
        <span className="font-mono text-xs text-[#0761d1] font-medium">{displayEnd}</span>
      </div>

      {/* Track */}
      <div className="relative h-6 flex items-center">
        {/* Background track */}
        <div className="absolute w-full h-1.5 rounded-full bg-[#ebebeb]" />
        
        {/* Tick marks for each timestamp */}
        {timestamps.map((ts, idx) => {
          const pct = totalMs === 0 ? 0 : ((ts - bounds.min) / totalMs) * 100;
          return (
            <div 
              key={`tick-${idx}`}
              className="absolute h-2.5 w-[2px] bg-[#a1a1a1] -translate-x-1/2 pointer-events-none rounded-sm"
              style={{ left: `${pct}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
              title={new Date(ts).toLocaleString()}
            />
          );
        })}
        {/* Active range highlight */}
        <div
          className="absolute h-1.5 rounded-full bg-[#0761d1]"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        {/* Start thumb */}
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={startPct}
          onChange={handleStartChange}
          className="absolute w-full h-1.5 opacity-0 cursor-pointer z-10"
          style={{ pointerEvents: 'auto' }}
          aria-label="Start of time range"
        />
        {/* End thumb — layered on top */}
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={endPct}
          onChange={handleEndChange}
          className="absolute w-full h-1.5 opacity-0 cursor-pointer z-20"
          aria-label="End of time range"
        />
        {/* Visible thumb markers */}
        <div
          className="absolute w-4 h-4 rounded-full bg-white border-2 border-[#0761d1] shadow-sm -translate-x-1/2 pointer-events-none"
          style={{ left: `${startPct}%` }}
        />
        <div
          className="absolute w-4 h-4 rounded-full bg-white border-2 border-[#0761d1] shadow-sm -translate-x-1/2 pointer-events-none"
          style={{ left: `${endPct}%` }}
        />
      </div>

      <div className="flex justify-between mt-1">
        <span className="font-mono text-xs text-[#888888]">{fmtDate(bounds.min)}</span>
        <span className="font-mono text-xs text-[#888888]">{fmtDate(bounds.max)}</span>
      </div>
    </div>
  );
}

export default function CaseDetailPage() {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [fetchStatus, setFetchStatus] = useState('loading');
  const [graphData, setGraphData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [timelineStatus, setTimelineStatus] = useState('loading');
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineError, setTimelineError] = useState('');
  const [timelineNotFound, setTimelineNotFound] = useState(false);

  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [entityStatus, setEntityStatus] = useState('idle');
  const [entityData, setEntityData] = useState(null);
  const [entityError, setEntityError] = useState('');

  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [guardrailFetchStatus, setGuardrailFetchStatus] = useState('idle');
  const [guardrailData, setGuardrailData] = useState(null);
  const [guardrailError, setGuardrailError] = useState('');

  // Timeline scrubber state
  const [activeTimeRange, setActiveTimeRange] = useState(null);
  
  const [statusUpdating, setStatusUpdating] = useState(false);

  const toggleCaseStatus = async () => {
    if (!graphData) return;
    setStatusUpdating(true);
    const newStatus = graphData.status === 'closed' ? 'open' : 'closed';
    try {
      const res = await apiClient.patch(`/cases/${encodeURIComponent(caseId)}/status`, { status: newStatus });
      if (res.data?.success) {
        setGraphData(prev => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      console.error('Failed to update status', err);
      alert('Failed to update case status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const fetchGraph = useCallback(async () => {
    setFetchStatus('loading');
    setErrorMessage('');
    setNotFound(false);
    try {
      const res = await apiClient.get(`/cases/${encodeURIComponent(caseId)}/graph`);
      setGraphData(res.data?.data ?? null);
      setFetchStatus('ready');
    } catch (err) {
      const errorCode = err.response?.data?.error?.code;
      if (errorCode === 'CASE_NOT_FOUND' || err.response?.status === 404) {
        setNotFound(true);
        setErrorMessage(
          err.response?.data?.error?.message ||
            `Case '${caseId}' was not found. It may not exist yet.`
        );
      } else if (
        err.response?.status === 401 ||
        errorCode === 'UNAUTHORIZED' ||
        errorCode === 'INVALID_TOKEN' ||
        errorCode === 'TOKEN_EXPIRED'
      ) {
        setErrorMessage('Your session has expired. Please sign in again.');
      } else if (err.response) {
        setErrorMessage(err.response.data?.error?.message || 'Could not load this case.');
      } else if (err.request) {
        setErrorMessage(
          'Cannot reach the server. Please check that the backend is running and try again.'
        );
      } else {
        setErrorMessage(err.message || 'Could not load this case.');
      }
      setFetchStatus('error');
    }
  }, [caseId]);

  const fetchTimeline = useCallback(async () => {
    setTimelineStatus('loading');
    setTimelineError('');
    setTimelineNotFound(false);
    try {
      const res = await apiClient.get(`/cases/${encodeURIComponent(caseId)}/timeline`);
      const payload = res.data?.data ?? null;
      const events = Array.isArray(payload?.timeline) ? payload.timeline : [];
      setTimelineEvents(events);
      setTimelineTotal(typeof payload?.totalEvents === 'number' ? payload.totalEvents : events.length);
      setTimelineStatus(events.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      const errorCode = err.response?.data?.error?.code;
      if (errorCode === 'CASE_NOT_FOUND' || err.response?.status === 404) {
        setTimelineNotFound(true);
        setTimelineError(
          err.response?.data?.error?.message || `Case '${caseId}' was not found. It may not exist yet.`
        );
      } else if (
        err.response?.status === 401 ||
        errorCode === 'UNAUTHORIZED' ||
        errorCode === 'INVALID_TOKEN' ||
        errorCode === 'TOKEN_EXPIRED'
      ) {
        setTimelineError('Your session has expired. Please sign in again.');
      } else if (err.response) {
        setTimelineError(err.response.data?.error?.message || 'Could not load the investigation timeline.');
      } else if (err.request) {
        setTimelineError(
          'Cannot reach the server. Please check that the backend is running and try again.'
        );
      } else {
        setTimelineError(err.message || 'Could not load the investigation timeline.');
      }
      setTimelineStatus('error');
    }
  }, [caseId]);

  const fetchEntity = useCallback(
    async (entityId) => {
      if (!entityId || typeof entityId !== 'string' || !entityId.trim()) return;
      setEntityStatus('loading');
      setEntityError('');
      setEntityData(null);
      try {
        const res = await apiClient.get(
          `/cases/${encodeURIComponent(caseId)}/entities/${encodeURIComponent(entityId.trim())}`
        );
        const payload = res.data?.data ?? null;
        if (!payload?.entity) {
          setEntityStatus('empty');
          return;
        }
        setEntityData(payload);
        setEntityStatus('ready');
      } catch (err) {
        const errorCode = err.response?.data?.error?.code;
        if (err.response?.status === 401 || errorCode === 'UNAUTHORIZED' || errorCode === 'INVALID_TOKEN' || errorCode === 'TOKEN_EXPIRED') {
          setEntityError('Your session has expired. Please sign in again.');
        } else if (err.response) {
          setEntityError(err.response.data?.error?.message || 'Could not load entity details.');
        } else if (err.request) {
          setEntityError('Cannot reach the server. Please check that the backend is running and try again.');
        } else {
          setEntityError(err.message || 'Could not load entity details.');
        }
        setEntityStatus('error');
      }
    },
    [caseId]
  );

  const fetchGuardrail = useCallback(
    async (edgeId) => {
      if (!edgeId || typeof edgeId !== 'string' || !edgeId.trim()) return;
      setGuardrailFetchStatus('loading');
      setGuardrailError('');
      setGuardrailData(null);
      try {
        const res = await apiClient.get(
          `/cases/${encodeURIComponent(caseId)}/guardrail/${encodeURIComponent(edgeId.trim())}`
        );
        const payload = res.data?.data ?? null;
        if (!payload?.edge) {
          setGuardrailFetchStatus('empty');
          return;
        }
        setGuardrailData(payload);
        setGuardrailFetchStatus('ready');
      } catch (err) {
        const errorCode = err.response?.data?.error?.code;
        if (err.response?.status === 401 || errorCode === 'UNAUTHORIZED' || errorCode === 'INVALID_TOKEN' || errorCode === 'TOKEN_EXPIRED') {
          setGuardrailError('Your session has expired. Please sign in again.');
        } else if (err.response) {
          setGuardrailError(err.response.data?.error?.message || 'Could not load guardrail details.');
        } else if (err.request) {
          setGuardrailError('Cannot reach the server. Please check that the backend is running and try again.');
        } else {
          setGuardrailError(err.message || 'Could not load guardrail details.');
        }
        setGuardrailFetchStatus('error');
      }
    },
    [caseId]
  );

  const closeEntityPanel = useCallback(() => {
    setSelectedEntityId(null);
    setEntityData(null);
    setEntityError('');
    setEntityStatus('idle');
  }, []);

  const closeGuardrailPanel = useCallback(() => {
    setSelectedEdgeId(null);
    setGuardrailData(null);
    setGuardrailError('');
    setGuardrailFetchStatus('idle');
  }, []);

  const handleBackgroundClick = useCallback(() => {
    closeEntityPanel();
    closeGuardrailPanel();
  }, [closeEntityPanel, closeGuardrailPanel]);

  const handleNodeClick = useCallback(
    (_event, node) => {
      const entityId = node?.canonicalId || node?.id;
      if (!entityId || typeof entityId !== 'string') return;
      
      // If clicking the already selected node, deselect it
      if (selectedEntityId === entityId) {
        closeEntityPanel();
        return;
      }

      closeGuardrailPanel();
      
      setSelectedEntityId(entityId);
      fetchEntity(entityId);
    },
    [fetchEntity, selectedEntityId, closeEntityPanel, closeGuardrailPanel]
  );

  const handleEdgeClick = useCallback(
    (_event, edge) => {
      const edgeId = edge?.id;
      if (!edgeId || typeof edgeId !== 'string') return;
      
      // If clicking the already selected edge, deselect it
      if (selectedEdgeId === edgeId) {
        closeGuardrailPanel();
        return;
      }

      closeEntityPanel();
      
      setSelectedEdgeId(edgeId);
      fetchGuardrail(edgeId);
    },
    [fetchGuardrail, selectedEdgeId, closeGuardrailPanel, closeEntityPanel]
  );

  useEffect(() => {
    if (caseId) {
      fetchGraph();
      fetchTimeline();
    }
  }, [caseId, fetchGraph, fetchTimeline]);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const { getEntityName } = useEntityLookup(graphData?.nodes || []);
  const graph = useMemo(() => buildGraphPayload(graphData), [graphData]);
  const isEmptyGraph =
    fetchStatus === 'ready' && graph.flowNodes.length === 0 && graph.flowEdges.length === 0;

  // Derive min/max timestamps from edges for the scrubber
  const edgeTimeBounds = useMemo(() => {
    const edges = graphData?.edges || [];
    const timestamps = edges
      .map(e => e.timestamp ? new Date(e.timestamp).getTime() : null)
      .filter(t => t !== null && !isNaN(t));
    if (timestamps.length === 0) return null;
    return { min: Math.min(...timestamps), max: Math.max(...timestamps), timestamps };
  }, [graphData]);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Nav bar */}
      <header className="h-16 bg-white border-b border-[#ebebeb] flex items-center justify-between px-6">
        <div 
          onClick={() => navigate('/cases')} 
          className="flex items-center gap-2 cursor-pointer transition-opacity hover:opacity-80"
          title="Go to dashboard"
        >
          <svg className="h-6 w-6 text-[#171717]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="font-sans text-lg font-bold tracking-tight text-[#171717]">
            Trace-X
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#4d4d4d]">
            {user?.username ? `Signed in as ${user.username}` : ''}
          </span>
          <button
            onClick={handleLogout}
            className="h-7 rounded-md border border-[#ebebeb] bg-white px-2 text-sm font-medium text-[#171717] hover:bg-[#f5f5f5]"
          >
            Log out
          </button>
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-6xl px-4 py-10"
        style={{ minHeight: 'calc(100vh - 64px)' }}
      >
        <button
          onClick={() => navigate('/cases')}
          className="h-7 rounded-md border border-[#ebebeb] bg-white px-2 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
        >
          ← Back to cases
        </button>

        <h2 className="mt-6 text-2xl font-bold tracking-tight text-[#171717]">
          Investigation Workspace
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold leading-7 tracking-[-0.6px] text-[#171717]">
            {graphData?.title ? graphData.title : <span className="font-mono">{caseId}</span>}
          </h1>
          {graphData?.title && (
            <span className="font-mono text-sm text-[#888888]">({caseId})</span>
          )}
          {graphData?.metadata?.category && (
            <span className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-0.5 text-xs font-medium text-[#374151]">
              {graphData.metadata.category}
            </span>
          )}
          {fetchStatus === 'ready' && !isEmptyGraph && (
            <StatusBadge status={graphData?.status === 'closed' ? 'closed' : 'open'} />
          )}
          {fetchStatus === 'ready' && !isEmptyGraph && (
            <button
              onClick={toggleCaseStatus}
              disabled={statusUpdating}
              className="ml-auto h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {graphData?.status === 'closed' ? 'Reopen case' : 'Close case'}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm leading-5 tracking-[-0.28px] text-[#4d4d4d]">
          Entity relationship graph reconstructed from ingested evidence.
        </p>

        {(fetchStatus === 'loading') && (
          <section
            aria-label="Loading case graph"
            className="mt-8 rounded-xl bg-white px-6 py-8"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
              Loading graph…
            </p>
            <div className="mt-5 flex flex-wrap gap-4">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-16 w-40 animate-pulse rounded-md bg-[#f5f5f5]" />
              ))}
            </div>
          </section>
        )}

        {fetchStatus === 'error' && (
          <section className="mt-8 rounded-xl bg-white px-6 py-8" style={{ boxShadow: CARD_SHADOW }}>
            <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
              {errorMessage}
            </div>
            <div className="mt-4 flex items-center gap-3">
              {!notFound && (
                <button
                  onClick={fetchGraph}
                  className="h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => navigate('/cases')}
                className="h-8 rounded-md border border-[#ebebeb] bg-white px-3 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
              >
                Back to cases
              </button>
            </div>
          </section>
        )}

        {isEmptyGraph && (
          <section
            className="mt-8 rounded-xl bg-[#fafafa] px-8 py-16 text-center"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
              No graph yet
            </p>
            <h2 className="mt-3 text-lg font-semibold tracking-[-0.4px] text-[#171717]">
              This case has no entities or relationships yet.
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#4d4d4d]">
              Once evidence is processed for this case, its investigation graph will appear here.
            </p>
          </section>
        )}

        {fetchStatus === 'ready' && !isEmptyGraph && (
          <>
            {graph.unmappedNodes.length > 0 && (
              <div
                className="mt-8 rounded-md bg-[#ffefcf] px-3 py-2 text-sm text-[#ab570a]"
                role="status"
              >
                Graph data could not be fully mapped: {graph.unmappedNodes.join('; ')}
              </div>
            )}
            {graph.unmappedEdges.length > 0 && (
              <div
                className="mt-8 rounded-md bg-[#ffefcf] px-3 py-2 text-sm text-[#ab570a]"
                role="status"
              >
                Some relationships were excluded because they reference entities outside this
                graph: {graph.unmappedEdges.join('; ')}
              </div>
            )}
            
            {Array.isArray(graphData?.patterns) && graphData.patterns.length > 0 && (
              <section className="mt-8 overflow-hidden rounded-xl bg-white" style={{ boxShadow: CARD_SHADOW }}>
                <div className="border-b border-[#ebebeb] px-6 py-3">
                  <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Investigative Patterns</p>
                </div>
                <div className="divide-y divide-[#ebebeb]">
                  {graphData.patterns.map((pattern, idx) => (
                    <div key={idx} className="p-6">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-0.5 font-mono text-xs font-medium text-[#374151]">
                          {pattern.patternType}
                        </span>
                        {typeof pattern.confidence === 'number' && (
                          <span className="font-mono text-xs text-[#888888]">
                            Confidence: {pattern.confidence}
                          </span>
                        )}
                      </div>
                      {typeof pattern.description === 'string' && pattern.description.trim() && (
                        <p className="mt-3 text-sm leading-5 text-[#171717]">
                          {pattern.description}
                        </p>
                      )}
                      {(Array.isArray(pattern.relatedEntityIds) && pattern.relatedEntityIds.length > 0) && (
                        <div className="mt-3">
                          <p className="font-mono text-xs text-[#888888]">Related Entities:</p>
                          <ul className="mt-1 flex flex-wrap gap-2">
                            {pattern.relatedEntityIds.map(eid => (
                              <li key={eid} className="font-mono text-xs text-[#4d4d4d]">{eid}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section
              className="mt-8 overflow-hidden rounded-xl bg-white"
              style={{ boxShadow: CARD_SHADOW }}
            >
              <div className="flex items-center justify-between border-b border-[#ebebeb] px-6 py-3">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
                  GET /api/cases/:caseId/graph
                </p>
                <p className="hidden font-mono text-xs text-[#888888] sm:block">
                  {graph.flowNodes.length} entities · {graph.flowEdges.length} relationships
                </p>
              </div>
              <div className="h-[560px] w-full">
                <NetworkGraph 
                  graphData={{ nodes: graphData?.nodes || [], edges: graphData?.edges || [] }}
                  onNodeClick={(id) => handleNodeClick(null, { id })}
                  onEdgeClick={(id) => handleEdgeClick(null, { id })}
                  onBackgroundClick={handleBackgroundClick}
                  activeTimeRange={activeTimeRange}
                  currentCaseId={caseId}
                  selectedEdgeId={selectedEdgeId}
                />
              </div>
              {edgeTimeBounds && (
                <TimelineScrubber
                  bounds={edgeTimeBounds}
                  activeRange={activeTimeRange}
                  onChange={setActiveTimeRange}
                />
              )}
            </section>
          </>
        )}

        {fetchStatus === 'ready' && (
          <section className="mt-8 overflow-hidden rounded-xl bg-white" style={{ boxShadow: CARD_SHADOW }}>
            <div className="flex items-center justify-between border-b border-[#ebebeb] px-6 py-3">
              <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
                Investigation timeline
              </p>
              {timelineStatus === 'ready' ? (
                <p className="hidden font-mono text-xs text-[#888888] sm:block">{timelineTotal} events</p>
              ) : (
                <p className="hidden font-mono text-xs text-[#888888] sm:block">
                  GET /api/cases/:caseId/timeline
                </p>
              )}
            </div>

            {timelineStatus === 'loading' && (
              <div className="px-6 py-8">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Loading timeline…</p>
                <div className="mt-5 space-y-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="flex gap-4">
                      <div className="h-12 w-32 animate-pulse rounded-md bg-[#f5f5f5]" />
                      <div className="h-12 flex-1 animate-pulse rounded-md bg-[#f5f5f5]" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {timelineStatus === 'error' && (
              <div className="px-6 py-6">
                <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
                  {timelineError}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  {!timelineNotFound && (
                    <button
                      onClick={fetchTimeline}
                      className="h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/cases')}
                    className="h-8 rounded-md border border-[#ebebeb] bg-white px-3 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
                  >
                    Back to cases
                  </button>
                </div>
              </div>
            )}

            {timelineStatus === 'empty' && (
              <div className="px-8 py-12 text-center">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">No timeline events</p>
                <h3 className="mt-3 text-base font-semibold tracking-[-0.28px] text-[#171717]">
                  No dated interactions recorded.
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#4d4d4d]">
                  Interactions will appear here once evidence is processed for this case.
                </p>
              </div>
            )}

            {timelineStatus === 'ready' && (
              <ol className="divide-y divide-[#ebebeb] bg-[#fafafa]">
                {timelineEvents.map((event, index) => (
                  <TimelineEventRow 
                    key={event.id || index} 
                    event={event} 
                    index={index} 
                    getEntityName={getEntityName} 
                    onClick={() => {
                      if (event.id || event.edgeId) {
                        handleEdgeClick(null, { id: event.id || event.edgeId });
                      }
                    }}
                  />
                ))}
              </ol>
            )}
          </section>
        )}
        {selectedEntityId && (
          <section
            className="mt-8 overflow-hidden rounded-xl bg-white"
            style={{ boxShadow: CARD_SHADOW }}
            aria-label="Entity detail"
          >
            <div className="flex items-center justify-between border-b border-[#ebebeb] px-6 py-3">
              <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Entity detail</p>
              <button
                onClick={closeEntityPanel}
                className="h-7 rounded-md border border-[#ebebeb] bg-white px-2 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
              >
                Close
              </button>
            </div>

            {entityStatus === 'loading' && (
              <div className="px-6 py-8">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Loading entity…</p>
                <div className="mt-5 space-y-3">
                  <div className="h-4 w-32 animate-pulse rounded-md bg-[#f5f5f5]" />
                  <div className="h-4 w-full animate-pulse rounded-md bg-[#f5f5f5]" />
                  <div className="h-4 w-3/4 animate-pulse rounded-md bg-[#f5f5f5]" />
                </div>
              </div>
            )}

            {entityStatus === 'error' && (
              <div className="px-6 py-6">
                {(() => {
                  const fallbackEntity = (graphData?.nodes || []).find(n => n.canonicalId === selectedEntityId || n.id === selectedEntityId);
                  if (fallbackEntity) {
                    return (
                      <div className="rounded-md border border-[#ebebeb] bg-[#fafafa] p-4">
                        <div className="mb-4 flex items-center justify-between border-b border-[#ebebeb] pb-3">
                          <div>
                            <span className="inline-flex items-center rounded-full bg-[#fef08a] px-2 py-0.5 font-mono text-xs font-semibold text-[#854d0e]">
                              Partial Data
                            </span>
                            <p className="mt-1 font-mono text-xs uppercase tracking-wide text-[#888888]">Cross-case API Fetch Failed</p>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Type</p>
                            <p className="mt-1 text-sm text-[#171717]">{fallbackEntity.type || 'Unknown'}</p>
                          </div>
                          {Array.isArray(fallbackEntity.aliases) && fallbackEntity.aliases.length > 0 && (
                            <div>
                              <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Aliases</p>
                              <ul className="mt-1 space-y-1">
                                {fallbackEntity.aliases.map((alias, idx) => (
                                  <li key={idx} className="font-mono text-sm text-[#4d4d4d]">{alias}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="mt-4 pt-4 border-t border-[#ebebeb] flex items-center gap-3">
                            <button onClick={() => fetchEntity(selectedEntityId)} className="h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black">
                              Retry Full Fetch
                            </button>
                            <button onClick={closeEntityPanel} className="h-8 rounded-md border border-[#ebebeb] bg-white px-3 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]">
                              Close
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <>
                      <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
                        {entityError}
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          onClick={() => fetchEntity(selectedEntityId)}
                          className="h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black"
                        >
                          Retry
                        </button>
                        <button
                          onClick={closeEntityPanel}
                          className="h-8 rounded-md border border-[#ebebeb] bg-white px-3 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
                        >
                          Close
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {entityStatus === 'empty' && (
              <div className="px-8 py-12 text-center">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">No entity data</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#4d4d4d]">
                  No details were returned for this entity.
                </p>
              </div>
            )}

            {entityStatus === 'ready' && entityData?.entity && (
              <div className="px-6 py-6">
                <div className="space-y-5">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Canonical ID</p>
                    <p className="mt-1 break-all font-mono text-sm font-medium text-[#171717]">
                      {entityData.entity.canonicalId}
                    </p>
                  </div>
                  {typeof entityData.entity.type === 'string' && entityData.entity.type.trim() && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Type</p>
                      <p className="mt-1 text-sm text-[#171717]">{entityData.entity.type}</p>
                    </div>
                  )}
                  {typeof entityData.entity.confidence === 'number' && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Confidence</p>
                      <p className="mt-1 font-mono text-sm text-[#171717]">{entityData.entity.confidence}</p>
                    </div>
                  )}
                  {Array.isArray(entityData.entity.aliases) && entityData.entity.aliases.length > 0 && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Aliases</p>
                      <ul className="mt-1 space-y-1">
                        {entityData.entity.aliases.map((alias, idx) => (
                          <li key={`${alias}-${idx}`} className="font-mono text-sm text-[#4d4d4d]">
                            {alias}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {entityData.entity.attributes &&
                    typeof entityData.entity.attributes === 'object' &&
                    Object.keys(entityData.entity.attributes).length > 0 && (
                      <div>
                        <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Attributes</p>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-[#ebebeb] bg-[#fafafa] px-3 py-2 font-mono text-xs leading-5 text-[#4d4d4d]">
                          {JSON.stringify(entityData.entity.attributes, null, 2)}
                        </pre>
                      </div>
                    )}
                  {entityData.entity.createdAt && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Created</p>
                      <p className="mt-1 font-mono text-xs text-[#4d4d4d]">
                        {formatTimelineTimestamp(entityData.entity.createdAt) ?? String(entityData.entity.createdAt)}
                      </p>
                    </div>
                  )}
                  {entityData.entity.updatedAt && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Updated</p>
                      <p className="mt-1 font-mono text-xs text-[#4d4d4d]">
                        {formatTimelineTimestamp(entityData.entity.updatedAt) ?? String(entityData.entity.updatedAt)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
                      Related edges ·{' '}
                      {Array.isArray(entityData.relatedEdges) ? entityData.relatedEdges.length : 0}
                    </p>
                    {Array.isArray(entityData.relatedEdges) && entityData.relatedEdges.length === 0 ? (
                      <p className="mt-2 text-sm text-[#4d4d4d]">No related relationships.</p>
                    ) : (
                      <ol className="mt-3 divide-y divide-[#ebebeb] overflow-hidden rounded-md border border-[#ebebeb]">
                        {entityData.relatedEdges.map((edge) => {
                          const edgeKey = typeof edge?.id === 'string' ? edge.id : `${edge?.source}-${edge?.target}`;
                          const edgeSource = typeof edge?.source === 'string' ? edge.source : '';
                          const edgeTarget = typeof edge?.target === 'string' ? edge.target : '';
                          const edgeType = typeof edge?.edgeType === 'string' ? edge.edgeType : '';
                          const edgeTs = formatTimelineTimestamp(edge?.timestamp);
                          return (
                            <li key={edgeKey} className="bg-white px-3 py-2">
                              <p className="truncate font-mono text-xs text-[#171717]" title={`${edgeSource} → ${edgeTarget}`}>
                                {edgeSource && edgeTarget ? (
                                  <>
                                    {edgeSource} <span className="text-[#a1a1a1]">→</span> {edgeTarget}
                                  </>
                                ) : (
                                  edgeSource || edgeTarget || '—'
                                )}
                              </p>
                              {(edgeType || edgeTs) && (
                                <p className="mt-0.5 font-mono text-xs uppercase tracking-wide text-[#888888]">
                                  {edgeType && <span>{edgeType}</span>}
                                  {edgeType && edgeTs && <span className="mx-1 text-[#ebebeb]">·</span>}
                                  {edgeTs && <span>{edgeTs}</span>}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
        {selectedEdgeId && (
          <section
            className="mt-8 overflow-hidden rounded-xl bg-white"
            style={{ boxShadow: CARD_SHADOW }}
            aria-label="Guardrail detail"
          >
            <div className="flex items-center justify-between border-b border-[#ebebeb] px-6 py-3">
              <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Guardrail &amp; evidence</p>
              <button
                onClick={closeGuardrailPanel}
                className="h-7 rounded-md border border-[#ebebeb] bg-white px-2 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
              >
                Close
              </button>
            </div>

            {guardrailFetchStatus === 'loading' && (
              <div className="px-6 py-8">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Loading guardrail…</p>
                <div className="mt-5 space-y-3">
                  <div className="h-4 w-32 animate-pulse rounded-md bg-[#f5f5f5]" />
                  <div className="h-4 w-full animate-pulse rounded-md bg-[#f5f5f5]" />
                  <div className="h-4 w-3/4 animate-pulse rounded-md bg-[#f5f5f5]" />
                </div>
              </div>
            )}

            {guardrailFetchStatus === 'error' && (
              <div className="px-6 py-6">
                <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
                  {guardrailError}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => fetchGuardrail(selectedEdgeId)}
                    className="h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black"
                  >
                    Retry
                  </button>
                  <button
                    onClick={closeGuardrailPanel}
                    className="h-8 rounded-md border border-[#ebebeb] bg-white px-3 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f5f5f5]"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {guardrailFetchStatus === 'empty' && (
              <div className="px-8 py-12 text-center">
                <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">No guardrail data</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#4d4d4d]">
                  No details were returned for this relationship.
                </p>
              </div>
            )}

            {guardrailFetchStatus === 'ready' && guardrailData?.edge && (
              <div className="px-6 py-6">
                <div className="space-y-5">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Edge ID</p>
                    <p className="mt-1 break-all font-mono text-sm font-medium text-[#171717]">
                      {guardrailData.edgeId || selectedEdgeId}
                    </p>
                  </div>
                  {(typeof guardrailData.edge.source === 'string' || typeof guardrailData.edge.target === 'string') && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Source → Target</p>
                      <p className="mt-1 truncate font-mono text-sm text-[#171717]" title={`${guardrailData.edge.source ?? ''} → ${guardrailData.edge.target ?? ''}`}>
                        {guardrailData.edge.source && guardrailData.edge.target ? (
                          <>
                            {guardrailData.edge.source} <span className="text-[#a1a1a1]">→</span> {guardrailData.edge.target}
                          </>
                        ) : (
                          guardrailData.edge.source || guardrailData.edge.target || '—'
                        )}
                      </p>
                    </div>
                  )}
                  {typeof guardrailData.edge.edgeType === 'string' && guardrailData.edge.edgeType.trim() && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Edge type</p>
                      <p className="mt-1 text-sm text-[#171717]">
                        {
                          {
                            shared_phone: 'Shared Phone',
                            shared_address: 'Shared Address',
                            telecom_link: 'Telecom Link',
                            'co-mention': 'Co-Mention',
                            owns: 'Ownership',
                            associated_with: 'Associated With'
                          }[guardrailData.edge.edgeType] || guardrailData.edge.edgeType
                        }
                      </p>
                    </div>
                  )}
                  {typeof guardrailData.edge.confidence === 'number' && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Confidence</p>
                      <p className="mt-1 font-mono text-sm text-[#171717]">{guardrailData.edge.confidence}</p>
                    </div>
                  )}
                  {guardrailData.edge.timestamp && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Timestamp</p>
                      <p className="mt-1 font-mono text-xs text-[#4d4d4d]">
                        {formatTimelineTimestamp(guardrailData.edge.timestamp) ?? String(guardrailData.edge.timestamp)}
                      </p>
                    </div>
                  )}
                  {typeof guardrailData.edge.guardrailStatus === 'string' && guardrailData.edge.guardrailStatus.trim() && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Status</p>
                      <div className="mt-1">
                        {guardrailData.edge.guardrailStatus === 'verified' ? (
                          <span className="inline-flex items-center rounded-full bg-[#d1fae5] px-2.5 py-0.5 font-mono text-xs font-medium text-[#065f46]">
                            Verified Fact
                          </span>
                        ) : guardrailData.edge.guardrailStatus === 'possible_connection' ? (
                          <span className="inline-flex items-center rounded-full bg-[#ffefcf] px-2.5 py-0.5 font-mono text-xs font-medium text-[#ab570a]">
                            Unconfirmed Lead
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-0.5 font-mono text-xs font-medium text-[#374151]">
                            {guardrailData.edge.guardrailStatus}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {typeof guardrailData.edge.guardrailRationale === 'string' && guardrailData.edge.guardrailRationale.trim() && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Verification</p>
                      <p className="mt-1 text-sm leading-5 text-[#4d4d4d]">{guardrailData.edge.guardrailRationale}</p>
                    </div>
                  )}
                  {guardrailData.edge.attributes && typeof guardrailData.edge.attributes === 'object' && Object.keys(guardrailData.edge.attributes).length > 0 && (
                    <div>
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Attributes</p>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-[#ebebeb] bg-[#fafafa] px-3 py-2 font-mono text-xs leading-5 text-[#4d4d4d]">
                        {JSON.stringify(guardrailData.edge.attributes, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
                      Evidence · {Array.isArray(guardrailData.edge.evidence) ? guardrailData.edge.evidence.length : 0}
                    </p>
                    {Array.isArray(guardrailData.edge.evidence) && guardrailData.edge.evidence.length === 0 ? (
                      <p className="mt-2 text-sm text-[#4d4d4d]">No evidence records.</p>
                    ) : (
                      <ol className="mt-3 space-y-3">
                        {guardrailData.edge.evidence.map((item, idx) => (
                          <li key={idx} className="rounded-md border border-[#ebebeb] bg-[#fafafa] px-3 py-3">
                            {typeof item?.sourceReportId === 'string' && item.sourceReportId.trim() && (
                              <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Source: {item.sourceReportId}</p>
                            )}
                            {typeof item?.matchedField === 'string' && item.matchedField.trim() && (
                              <p className="mt-1 font-mono text-xs text-[#171717]">Field: {item.matchedField}</p>
                            )}
                            {item?.record !== undefined && item?.record !== null && (
                              <pre className="mt-2 max-h-32 overflow-auto rounded border border-[#ebebeb] bg-white px-2 py-2 font-mono text-xs leading-5 text-[#4d4d4d]">
                                {typeof item.record === 'string' ? item.record : JSON.stringify(item.record, null, 2)}
                              </pre>
                            )}
                            {item?.metadata && typeof item.metadata === 'object' && Object.keys(item.metadata).length > 0 && (
                              <pre className="mt-2 max-h-32 overflow-auto rounded border border-[#ebebeb] bg-white px-2 py-2 font-mono text-xs leading-5 text-[#4d4d4d]">
                                {JSON.stringify(item.metadata, null, 2)}
                              </pre>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
