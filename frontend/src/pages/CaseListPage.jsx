import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient.js';
import { useAuth } from '../state/authContext.jsx';

const CARD_SHADOW =
  '0 0 0 1px rgba(0,0,0,0.08), 0px 2px 2px rgba(0,0,0,0.04), 0px 8px 16px -4px rgba(0,0,0,0.04)';

const STATUS_BADGE_CLASSES = {
  completed: 'bg-[#d3e5ff] text-[#0761d1]',
  failed: 'bg-[#f7d4d6] text-[#c50000]',
  pending: 'bg-[#ffefcf] text-[#ab570a]',
  processing: 'bg-[#ffefcf] text-[#ab570a]',
  open: 'bg-[#d1fae5] text-[#065f46]', // light green
  closed: 'bg-[#fee2e2] text-[#991b1b]', // light red
};

const TABLE_COLUMNS = ['CASE NAME', 'CATEGORY', 'PRIORITY', 'STATUS', 'ENTITIES', 'EDGES', 'RECORDS', 'UPDATED'];

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
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

const PRIORITY_STYLES = {
  high: {
    bg: 'bg-[#fee2e2]',
    text: 'text-[#991b1b]',
    icon: (
      <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  },
  medium: {
    bg: 'bg-[#ffefcf]',
    text: 'text-[#ab570a]',
    icon: (
      <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6" />
      </svg>
    )
  },
  low: {
    bg: 'bg-[#d1fae5]',
    text: 'text-[#065f46]',
    icon: (
      <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    )
  }
};

function PriorityBadge({ priority }) {
  if (!priority || priority === 'unspecified') return <span className="text-[#4d4d4d]">—</span>;
  
  const style = PRIORITY_STYLES[priority.toLowerCase()] || PRIORITY_STYLES.medium;
  
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${style.bg} ${style.text}`}
    >
      {style.icon}
      {priority}
    </span>
  );
}

/**
 * Case intake panel — submits the investigator's real input to POST /api/cases.
 * Sends multipart/form-data via FormData (browser sets the multipart boundary);
 * the shared apiClient attaches the Bearer JWT automatically.
 */
function CaseIntakeForm({ onCreated }) {
  const [caseName, setCaseName] = useState('');
  const [category, setCategory] = useState('');
  const [reportText, setReportText] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [createdCase, setCreatedCase] = useState(null);
  const fileInputRef = useRef(null);

  function handleFilesChange(e) {
    setFiles(Array.from(e.target.files || []));
    setFieldError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFieldError('');
    setRequestError('');
    setCreatedCase(null);

    if (!caseName.trim() || !category.trim()) {
      setFieldError('Case name and category must be filled.');
      return;
    }

    if (!reportText.trim() && files.length === 0) {
      setFieldError('Add a text report or select at least one CSV file.');
      return;
    }

    const formData = new FormData();
    formData.append('caseName', caseName.trim());
    formData.append('category', category.trim());

    if (reportText.trim()) {
      formData.append('textReports', reportText.trim());
    }
    for (const file of files) {
      formData.append('csvFiles', file);
    }

    setSubmitting(true);
    try {
      // Backend AI reasoning can take up to ~30s; extend the per-request timeout
      // beyond the shared 15s client default. Content-Type is left unset so the
      // browser generates the multipart boundary.
      const res = await apiClient.post('/cases', formData, {
        timeout: 60000,
        headers: { 'Content-Type': undefined },
      });
      const result = res.data?.data;
      if (!res.data?.success || !result?.caseId) {
        throw new Error('Case creation response was missing a caseId.');
      }
      setCreatedCase(result);
      setCaseName('');
      setCategory('');
      setReportText('');
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onCreated?.();
    } catch (err) {
      let message;
      if (err.response) {
        const errorCode = err.response.data?.error?.code;
        const backendMessage = err.response.data?.error?.message;
        if (errorCode === 'FASTAPI_UNAVAILABLE' || errorCode === 'FASTAPI_TIMEOUT') {
          message =
            'The AI processing service is temporarily unavailable. Your report has been kept below — nothing was saved. Please try again shortly.';
        } else if (typeof errorCode === 'string' && errorCode.startsWith('FASTAPI_')) {
          message =
            'The AI processing service could not complete this case. Nothing was saved — please review your input and try again.';
        } else if (err.response.status === 401) {
          message = 'Your session has expired. Please sign in again.';
        } else {
          message = backendMessage || 'Case intake failed. Please try again.';
        }
      } else if (err.request) {
        message =
          'Cannot reach the server. Please check that the backend is running and try again.';
      } else {
        message = err.message || 'Case intake failed. Please try again.';
      }
      setRequestError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl bg-white px-6 py-6" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-[#171717]">New Case</h2>
        <p className="hidden font-mono text-xs text-[#888888] sm:block">POST /api/cases</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4" noValidate>
        {fieldError && (
          <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
            {fieldError}
          </div>
        )}
        {requestError && (
          <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
            {requestError}
          </div>
        )}
        {createdCase && (
          <div className="rounded-md bg-[#d3e5ff] px-3 py-2 text-sm text-[#0761d1]" role="status">
            Case <span className="font-mono">{createdCase.caseId}</span> created
            {typeof createdCase.summary?.entitiesCount === 'number'
              ? ` · ${createdCase.summary.entitiesCount} entities`
              : ''}
            {typeof createdCase.summary?.edgesCount === 'number'
              ? ` · ${createdCase.summary.edgesCount} edges`
              : ''}
            {typeof createdCase.summary?.patternsCount === 'number'
              ? ` · ${createdCase.summary.patternsCount} patterns`
              : ''}
          </div>
        )}

        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-1.5">
            <label htmlFor="case-name" className="text-sm font-medium text-[#171717]">
              Case name *
            </label>
            <input
              id="case-name"
              type="text"
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
              disabled={submitting}
              placeholder="E.g. Operation Alpha"
              className="rounded-md border border-[#ebebeb] bg-white px-3 py-2 text-sm text-[#171717] placeholder:text-[#888888] outline-none focus:border-[#a1a1a1] disabled:opacity-60"
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label htmlFor="category" className="text-sm font-medium text-[#171717]">
              Category *
            </label>
            <input
              id="category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              placeholder="E.g. Fraud, Terrorism"
              className="rounded-md border border-[#ebebeb] bg-white px-3 py-2 text-sm text-[#171717] placeholder:text-[#888888] outline-none focus:border-[#a1a1a1] disabled:opacity-60"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-text" className="text-sm font-medium text-[#171717]">
            Report text
          </label>
          <textarea
            id="report-text"
            rows={4}
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            disabled={submitting}
            placeholder="Paste the FIR text or investigation notes…"
            className="resize-y rounded-md border border-[#ebebeb] bg-white px-3 py-2 text-sm text-[#171717] placeholder:text-[#888888] outline-none focus:border-[#a1a1a1] disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="csv-files" className="text-sm font-medium text-[#171717]">
            CDR / transaction CSV
          </label>
          <input
            ref={fileInputRef}
            id="csv-files"
            type="file"
            multiple
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={handleFilesChange}
            disabled={submitting}
            className="block w-full rounded-md border border-[#ebebeb] bg-white px-3 py-2 text-sm text-[#4d4d4d] outline-none focus:border-[#a1a1a1] disabled:opacity-60 file:mr-3 file:rounded-md file:border-0 file:bg-[#f5f5f5] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#171717] hover:file:bg-[#ebebeb]"
          />
          <p className="font-mono text-xs text-[#888888]">CSV only · up to 5 files · 5MB each</p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 flex h-10 items-center justify-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60 sm:w-44"
        >
          {submitting && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/40 border-t-white" />
          )}
          {submitting ? 'Processing…' : 'Create case'}
        </button>
      </form>
    </section>
  );
}

/** Protected post-login dashboard — lists every investigation case and hosts intake. */
export default function CaseListPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [fetchStatus, setFetchStatus] = useState('loading');
  const [cases, setCases] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchCases = useCallback(async () => {
    setFetchStatus('loading');
    setErrorMessage('');
    try {
      const res = await apiClient.get('/cases');
      const list = Array.isArray(res.data?.data?.cases) ? res.data.data.cases : [];
      setCases(list);
      setFetchStatus(list.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message ||
          'Could not load cases. Please check that the backend is running and try again.'
      );
      setFetchStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

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
        className="mx-auto w-full max-w-5xl px-4 py-10"
        style={{ minHeight: 'calc(100vh - 64px)' }}
      >
        <h1 className="mt-3 text-xl font-semibold leading-7 tracking-[-0.6px] text-[#171717]">
          Investigation cases.
        </h1>
        <p className="mt-1 text-sm leading-5 tracking-[-0.28px] text-[#4d4d4d]">
          Every ingested investigation, newest first.
        </p>

        <CaseIntakeForm onCreated={fetchCases} />

        {fetchStatus === 'loading' && (
          <section
            aria-label="Loading cases"
            className="mt-8 rounded-xl bg-white px-6 py-8"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">
              Loading cases…
            </p>
            <div className="mt-5 animate-pulse space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-4">
                  <div className="h-9 flex-1 rounded-md bg-[#f5f5f5]" />
                  <div className="hidden h-9 w-24 rounded-md bg-[#f5f5f5] sm:block" />
                  <div className="hidden h-9 w-20 rounded-md bg-[#f5f5f5] sm:block" />
                </div>
              ))}
            </div>
          </section>
        )}

        {fetchStatus === 'error' && (
          <section className="mt-8 rounded-xl bg-white px-6 py-8" style={{ boxShadow: CARD_SHADOW }}>
            <div className="rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]" role="alert">
              {errorMessage}
            </div>
            <button
              onClick={fetchCases}
              className="mt-4 h-8 rounded-md bg-[#171717] px-3 text-sm font-medium text-white transition-colors hover:bg-black"
            >
              Retry
            </button>
          </section>
        )}

        {fetchStatus === 'empty' && (
          <section
            className="mt-8 rounded-xl bg-[#fafafa] px-8 py-16 text-center"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <p className="font-mono text-xs uppercase tracking-wide text-[#888888]">No cases yet</p>
            <h2 className="mt-3 text-lg font-semibold tracking-[-0.4px] text-[#171717]">
              Your dashboard is empty.
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#4d4d4d]">
              Submit a text report or CDR/transaction CSV above to open your first investigation.
            </p>
          </section>
        )}

        {fetchStatus === 'ready' && (
          <section
            className="mt-8 overflow-x-auto rounded-xl bg-white"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="bg-[#fafafa]">
                  {TABLE_COLUMNS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="border-b border-[#ebebeb] px-4 py-3 font-mono text-xs font-normal uppercase tracking-wide text-[#888888]"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => {
                  const hasPattern = Array.isArray(item.patterns) && item.patterns.length > 0;
                  const patternTooltip = hasPattern ? item.patterns.map(p => p.description).join('\n') : '';
                  return (
                    <tr
                      key={item.caseId}
                      onClick={() => navigate(`/cases/${item.caseId}`)}
                      className="cursor-pointer border-b border-[#ebebeb] transition-colors last:border-b-0 hover:bg-[#fafafa]"
                      title={`Open workspace for ${item.caseId}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-[#171717]">
                        {item.title || item.caseId}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[#4d4d4d]">
                        {item.metadata?.category || '—'}
                      </td>
                      <td className="px-4 py-3 flex items-center gap-2">
                        <PriorityBadge priority={item.metadata?.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status === 'closed' ? 'closed' : 'open'} />
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4d4d4d]">{item.entitiesCount ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-[#4d4d4d]">{item.edgesCount ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-[#4d4d4d]">{item.recordCount ?? 0}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[#4d4d4d]">
                        {formatDateTime(item.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
