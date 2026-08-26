import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import apiClient from '../api/apiClient.js';
import { useAuth } from '../state/authContext.jsx';

const CARD_SHADOW =
  '0 0 0 1px rgba(0,0,0,0.08), 0px 2px 2px rgba(0,0,0,0.04), 0px 8px 16px -4px rgba(0,0,0,0.04)';

const STATUS_BADGE_CLASSES = {
  completed: 'bg-[#d3e5ff] text-[#0761d1]',
  failed: 'bg-[#f7d4d6] text-[#c50000]',
  pending: 'bg-[#ffefcf] text-[#ab570a]',
  processing: 'bg-[#ffefcf] text-[#ab570a]',
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

function EntityNode({ data }) {
  return (
    <div className="min-w-[150px] max-w-[220px] cursor-pointer rounded-md border border-[#ebebeb] bg-white px-3 py-2 transition-colors hover:border-[#a1a1a1]">
      {data.type && (
        <p className="font-mono text-[10px] uppercase leading-4 tracking-wide text-[#888888]">
          {data.type}
        </p>
      )}
      <p className="truncate text-sm font-medium tracking-[-0.28px] text-[#171717]" title={data.canonicalId}>
        {data.canonicalId}
      </p>
      {data.aliases.length > 0 && (
        <p
          className="truncate font-mono text-xs leading-4 text-[#4d4d4d]"
          title={data.aliases.join(', ')}
        >
          aka {data.aliases.join(', ')}
        </p>
      )}
      {typeof data.confidence === 'number' && (
        <p className="font-mono text-xs leading-4 text-[#4d4d4d]">confidence {data.confidence}</p>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-none !bg-[#a1a1a1]"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-none !bg-[#a1a1a1]"
      />
    </div>
  );
}

const NODE_TYPES = { entity: EntityNode };

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

  const handleNodeClick = useCallback(
    (_event, node) => {
      const entityId = node?.id;
      if (!entityId || typeof entityId !== 'string') return;
      setSelectedEdgeId(null);
      setGuardrailData(null);
      setGuardrailError('');
      setGuardrailFetchStatus('idle');
      setSelectedEntityId(entityId);
      fetchEntity(entityId);
    },
    [fetchEntity]
  );

  const handleEdgeClick = useCallback(
    (_event, edge) => {
      const edgeId = edge?.id;
      if (!edgeId || typeof edgeId !== 'string') return;
      setSelectedEntityId(null);
      setEntityData(null);
      setEntityError('');
      setEntityStatus('idle');
      setSelectedEdgeId(edgeId);
      fetchGuardrail(edgeId);
    },
    [fetchGuardrail]
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

  const graph = useMemo(() => buildGraphPayload(graphData), [graphData]);
  const isEmptyGraph =
    fetchStatus === 'ready' && graph.flowNodes.length === 0 && graph.flowEdges.length === 0;

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Nav bar */}
      <header className="h-16 bg-white border-b border-[#ebebeb] flex items-center justify-between px-6">
        <span className="font-mono text-xs text-[#888888] uppercase tracking-wide">
          Case Intelligence
        </span>
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

        <p className="mt-6 font-mono text-xs uppercase tracking-wide text-[#888888]">
          Investigation workspace
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold leading-7 tracking-[-0.6px] text-[#171717]">
            <span className="font-mono">{caseId}</span>
          </h1>
          {fetchStatus === 'ready' && !isEmptyGraph && graphData?.status && (
            <StatusBadge status={graphData.status} />
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
                <ReactFlowProvider>
                  <ReactFlow
                    nodes={graph.flowNodes}
                    edges={graph.flowEdges}
                    nodeTypes={NODE_TYPES}
                    fitView
                    minZoom={0.15}
                    maxZoom={2}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    onNodeClick={handleNodeClick}
                    onEdgeClick={handleEdgeClick}
                  >
                    <Background color="#ebebeb" gap={16} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </ReactFlowProvider>
              </div>
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
              <ol className="divide-y divide-[#ebebeb]">
                {timelineEvents.map((event, index) => {
                  const ts = formatTimelineTimestamp(event?.timestamp);
                  const source = typeof event?.source === 'string' ? event.source.trim() : '';
                  const target = typeof event?.target === 'string' ? event.target.trim() : '';
                  const edgeType =
                    typeof event?.edgeType === 'string' ? event.edgeType.trim() : '';
                  const evidenceCount = Array.isArray(event?.evidence) ? event.evidence.length : null;
                  const key =
                    typeof event?.id === 'string' && event.id.trim()
                      ? event.id.trim()
                      : `timeline-${index}`;
                  return (
                    <li
                      key={key}
                      className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-start sm:gap-6"
                    >
                      <p className="w-44 shrink-0 font-mono text-xs leading-5 text-[#888888]">{ts ?? 'Undated'}</p>
                      <div className="min-w-0 flex-1">
                        {(source || target) && (
                          <p
                            className="truncate font-mono text-sm text-[#171717]"
                            title={`${source} → ${target}`}
                          >
                            {source && target ? (
                              <>
                                {source} <span className="text-[#a1a1a1]">→</span> {target}
                              </>
                            ) : (
                              source || target
                            )}
                          </p>
                        )}
                        {(edgeType || evidenceCount !== null) && (
                          <p className="mt-1 font-mono text-xs uppercase tracking-wide text-[#888888]">
                            {edgeType && <span>{edgeType}</span>}
                            {edgeType && evidenceCount !== null && (
                              <span className="mx-1 text-[#ebebeb]">·</span>
                            )}
                            {evidenceCount !== null && (
                              <span>
                                {evidenceCount} evidence {evidenceCount === 1 ? 'record' : 'records'}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
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
                      <p className="mt-1 text-sm text-[#171717]">{guardrailData.edge.edgeType}</p>
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
                      <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">Guardrail status</p>
                      <p className="mt-1 font-mono text-sm text-[#171717]">{guardrailData.edge.guardrailStatus}</p>
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
                            {typeof item?.sourceType === 'string' && item.sourceType.trim() && (
                              <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">{item.sourceType}</p>
                            )}
                            {typeof item?.field === 'string' && item.field.trim() && (
                              <p className="mt-1 font-mono text-xs text-[#171717]">Field: {item.field}</p>
                            )}
                            {item?.value !== undefined && item?.value !== null && String(item.value).trim() && (
                              <p className="mt-1 break-all font-mono text-xs text-[#4d4d4d]">Value: {String(item.value)}</p>
                            )}
                            {typeof item?.citation === 'string' && item.citation.trim() && (
                              <p className="mt-1 font-mono text-xs text-[#4d4d4d]">Citation: {item.citation}</p>
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
