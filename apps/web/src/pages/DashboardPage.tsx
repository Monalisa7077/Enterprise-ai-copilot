import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../lib/api';

interface Workspace {
  _id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

type DocumentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface DocumentRecord {
  _id: string;
  workspaceId: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  failureMessage?: string;
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

const allowedMimeTypes: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};
const documentsPerPage = 20;
const maxFileSize = 10 * 1024 * 1024;

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceIdFromUrl = useRef(searchParams.get('workspaceId'));
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentsWorkspaceId, setDocumentsWorkspaceId] = useState<string | null>(null);
  const [documentsPage, setDocumentsPage] = useState(1);
  const [documentsTotal, setDocumentsTotal] = useState(0);
  const [areDocumentsLoading, setAreDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await api.get<ApiResponse<Workspace[]>>('/workspaces');
      setWorkspaces(response.data.data);
      const preferredId = workspaceIdFromUrl.current;
      const resolvedId = response.data.data.some((workspace) => workspace._id === preferredId)
        ? preferredId
        : response.data.data[0]?._id ?? null;
      workspaceIdFromUrl.current = resolvedId;
      setSelectedWorkspaceId(resolvedId);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Could not load workspaces. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    workspaceIdFromUrl.current = searchParams.get('workspaceId');
  }, [searchParams]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const loadDocuments = useCallback(async (workspaceId: string, page: number) => {
    setAreDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const response = await api.get<ApiResponse<DocumentRecord[]>>('/documents', {
        params: { workspaceId, page, limit: documentsPerPage },
      });
      setDocuments(response.data.data);
      setDocumentsWorkspaceId(workspaceId);
      setDocumentsTotal(response.data.pagination?.total ?? response.data.data.length);
    } catch (error) {
      setDocumentsError(getApiErrorMessage(error, 'Could not load documents. Please try again.'));
    } finally {
      setAreDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setDocuments([]);
      setDocumentsWorkspaceId(null);
      setDocumentsTotal(0);
      setDocumentsError(null);
      setAreDocumentsLoading(false);
      return;
    }

    let active = true;
    setAreDocumentsLoading(true);
    setDocumentsError(null);
    void api
      .get<ApiResponse<DocumentRecord[]>>('/documents', {
        params: { workspaceId: selectedWorkspaceId, page: documentsPage, limit: documentsPerPage },
      })
      .then((response) => {
        if (active) {
          setDocuments(response.data.data);
          setDocumentsWorkspaceId(selectedWorkspaceId);
          setDocumentsTotal(response.data.pagination?.total ?? response.data.data.length);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setDocumentsError(getApiErrorMessage(error, 'Could not load documents. Please try again.'));
        }
      })
      .finally(() => {
        if (active) {
          setAreDocumentsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedWorkspaceId, documentsPage]);

  function selectWorkspace(workspaceId: string) {
    workspaceIdFromUrl.current = workspaceId;
    setSelectedWorkspaceId(workspaceId);
    setSearchParams({ workspaceId });
    setDocumentsPage(1);
    setUploadError(null);
    setUploadMessage(null);
    setSelectedFile(null);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspaceId || !selectedFile) {
      return;
    }

    setUploadError(null);
    setUploadMessage(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const extension = selectedFile.name.split('.').pop()?.toLowerCase() ?? '';
      const normalizedFile = new File([selectedFile], selectedFile.name, {
        type: allowedMimeTypes[extension],
      });
      const formData = new FormData();
      formData.append('file', normalizedFile, normalizedFile.name);
      formData.append('workspaceId', selectedWorkspaceId);

      const response = await api.post<ApiResponse<DocumentRecord>>('/documents/upload', formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
          }
        },
      });

      const uploadedDocument = response.data.data;
      setUploadMessage(`${uploadedDocument.fileName} uploaded successfully and is ${uploadedDocument.status}.`);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      if (documentsPage !== 1) {
        setDocumentsPage(1);
      } else {
        await loadDocuments(selectedWorkspaceId, 1);
      }
    } catch (error) {
      setUploadError(getApiErrorMessage(error, 'Could not upload this file. Please try again.'));
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setSuccessMessage(null);
    setIsCreating(true);

    try {
      const response = await api.post<ApiResponse<Workspace>>('/workspaces', {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      const workspace = response.data.data;
      setWorkspaces((currentWorkspaces) => [
        workspace,
        ...currentWorkspaces.filter((item) => item._id !== workspace._id),
      ]);
      setSelectedWorkspaceId(workspace._id);
      workspaceIdFromUrl.current = workspace._id;
      setSearchParams({ workspaceId: workspace._id });
      setDocumentsPage(1);
      setDocuments([]);
      setDocumentsWorkspaceId(null);
      setName('');
      setDescription('');
      setSuccessMessage(`“${workspace.name}” was created and selected.`);
    } catch (error) {
      setCreateError(getApiErrorMessage(error, 'Could not create the workspace. Please try again.'));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <p className="mb-2 text-sm uppercase tracking-[0.2em] text-primary-500">Overview</p>
        <h1 className="text-3xl font-bold text-white">Your workspaces</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Create a workspace for your team’s knowledge and select one to work in.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Workspaces</h2>
              {!isLoading && !loadError && (
                <p className="mt-1 text-sm text-slate-400">
                  {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedWorkspaceId && (
                <Link
                  to={`/chat?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`}
                  className="rounded bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-500"
                >
                  Open AI chat
                </Link>
              )}
              <button
                type="button"
                onClick={() => void loadWorkspaces()}
                disabled={isLoading}
                className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {isLoading ? (
            <p className="rounded-lg bg-slate-800/70 px-4 py-6 text-slate-300" role="status">
              Loading workspaces...
            </p>
          ) : loadError ? (
            <div className="space-y-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-300" role="alert">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadWorkspaces()}
                className="rounded bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
              >
                Try again
              </button>
            </div>
          ) : workspaces.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-slate-400">
              No workspaces yet. Create one to get started.
            </p>
          ) : (
            <ul className="space-y-3">
              {workspaces.map((workspace) => {
                const isSelected = selectedWorkspaceId === workspace._id;
                return (
                  <li key={workspace._id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      disabled={isUploading}
                      onClick={() => selectWorkspace(workspace._id)}
                      className={`w-full rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        isSelected
                          ? 'border-primary-500 bg-primary-600/10'
                          : 'border-slate-800 bg-slate-800/70 hover:border-slate-600'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-medium text-white">{workspace.name}</span>
                        {isSelected && (
                          <span className="shrink-0 rounded bg-primary-500/15 px-2 py-1 text-xs text-primary-100">
                            Selected
                          </span>
                        )}
                      </span>
                      <span className="mt-2 block text-sm text-slate-400">
                        {workspace.description || 'No description'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 text-xl font-semibold text-white">Create a workspace</h2>
          <p className="mb-5 text-sm text-slate-400">Give your workspace a name and, optionally, a description.</p>
          <form className="space-y-4" onSubmit={handleCreateWorkspace}>
            {createError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
                {createError}
              </p>
            )}
            {successMessage && (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300" role="status">
                {successMessage}
              </p>
            )}
            <div>
              <label htmlFor="workspace-name" className="mb-1 block text-sm text-slate-300">Name</label>
              <input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
                maxLength={100}
                disabled={isCreating}
                placeholder="e.g. Product documentation"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-primary-500 disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="workspace-description" className="mb-1 block text-sm text-slate-300">
                Description <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                id="workspace-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                disabled={isCreating}
                rows={4}
                placeholder="What is this workspace for?"
                className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-primary-500 disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={isCreating || isUploading}
              className="w-full rounded bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreating ? 'Creating workspace...' : 'Create workspace'}
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Documents</h2>
              <p className="mt-1 text-sm text-slate-400">
                {selectedWorkspaceId
                  ? `${documentsTotal} ${documentsTotal === 1 ? 'document' : 'documents'} in ${
                      workspaces.find((workspace) => workspace._id === selectedWorkspaceId)?.name ?? 'selected workspace'
                    }`
                  : 'Select a workspace to view its documents.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => selectedWorkspaceId && void loadDocuments(selectedWorkspaceId, documentsPage)}
              disabled={!selectedWorkspaceId || areDocumentsLoading}
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {areDocumentsLoading ? 'Refreshing...' : 'Refresh statuses'}
            </button>
          </div>

          {!selectedWorkspaceId ? (
            <p className="rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-slate-400">
              Create or select a workspace to see its documents.
            </p>
          ) : areDocumentsLoading && documentsWorkspaceId !== selectedWorkspaceId ? (
            <p className="rounded-lg bg-slate-800/70 px-4 py-6 text-slate-300" role="status">
              Loading documents...
            </p>
          ) : documentsError ? (
            <div className="space-y-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-300" role="alert">{documentsError}</p>
              <button
                type="button"
                onClick={() => void loadDocuments(selectedWorkspaceId, documentsPage)}
                className="rounded bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
              >
                Try again
              </button>
            </div>
          ) : documentsWorkspaceId !== selectedWorkspaceId ? (
            <p className="rounded-lg bg-slate-800/70 px-4 py-6 text-slate-300" role="status">
              Loading documents...
            </p>
          ) : documents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-slate-400">
              No documents in this workspace yet. Upload one to get started.
            </p>
          ) : (
            <>
              {areDocumentsLoading && (
                <p className="mb-3 text-sm text-slate-400" role="status">Refreshing document statuses...</p>
              )}
              <ul className="space-y-3">
                {documents.map((document) => (
                  <li
                    key={document._id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-800/70 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="break-all font-medium text-white">{document.fileName}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {(document.size / (1024 * 1024)).toFixed(2)} MB
                        {' · '}
                        {new Date(document.createdAt).toLocaleString()}
                      </p>
                      {document.status === 'FAILED' && document.failureMessage && (
                        <p className="mt-2 text-sm text-red-300">{document.failureMessage}</p>
                      )}
                    </div>
                    <span
                      className={`w-fit shrink-0 rounded px-2.5 py-1 text-xs font-medium ${
                        document.status === 'COMPLETED'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : document.status === 'FAILED'
                            ? 'bg-red-500/10 text-red-300'
                            : document.status === 'PROCESSING'
                              ? 'bg-yellow-500/10 text-yellow-300'
                              : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {document.status}
                    </span>
                  </li>
                ))}
              </ul>
              {documentsTotal > documentsPerPage && (
                <div className="mt-5 flex items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setDocumentsPage((page) => Math.max(1, page - 1))}
                    disabled={documentsPage === 1 || areDocumentsLoading}
                    className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-slate-400">
                    Page {documentsPage} of {Math.ceil(documentsTotal / documentsPerPage)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDocumentsPage((page) => page + 1)}
                    disabled={documentsPage >= Math.ceil(documentsTotal / documentsPerPage) || areDocumentsLoading}
                    className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 text-xl font-semibold text-white">Upload a document</h2>
          <p className="mb-5 text-sm text-slate-400">
            Upload a PDF, DOCX, or TXT file (maximum 10 MB) to the selected workspace.
          </p>
          <form className="space-y-4" onSubmit={handleUpload}>
            {uploadError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
                {uploadError}
              </p>
            )}
            {uploadMessage && (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300" role="status">
                {uploadMessage}
              </p>
            )}
            <div>
              <label htmlFor="document-file" className="mb-1 block text-sm text-slate-300">File</label>
              <input
                ref={fileInputRef}
                id="document-file"
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                disabled={!selectedWorkspaceId || isUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file) {
                    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
                    if (!allowedMimeTypes[extension]) {
                      setSelectedFile(null);
                      setUploadError('Choose a PDF, DOCX, or TXT file.');
                      event.target.value = '';
                      return;
                    }
                    if (file.size === 0 || file.size > maxFileSize) {
                      setSelectedFile(null);
                      setUploadError('The file must be greater than 0 bytes and no larger than 10 MB.');
                      event.target.value = '';
                      return;
                    }
                  }
                  setSelectedFile(file);
                  setUploadError(null);
                  setUploadMessage(null);
                }}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-200 hover:file:bg-slate-700 disabled:opacity-60"
              />
              {selectedFile && (
                <p className="mt-2 break-all text-xs text-slate-400">
                  Selected: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                </p>
              )}
            </div>
            {isUploading && uploadProgress !== null && (
              <div aria-live="polite">
                <div className="mb-1 flex justify-between text-xs text-slate-400">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <progress
                  value={uploadProgress}
                  max="100"
                  aria-label="Upload progress"
                  className="h-2 w-full accent-primary-500"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={!selectedWorkspaceId || !selectedFile || isUploading}
              className="w-full rounded bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading...' : 'Upload document'}
            </button>
            {!selectedWorkspaceId && (
              <p className="text-xs text-slate-500">Select a workspace before uploading.</p>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
