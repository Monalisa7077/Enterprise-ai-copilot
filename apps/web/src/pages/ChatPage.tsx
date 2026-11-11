import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../lib/api';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

interface Workspace {
  _id: string;
  name: string;
}

interface AnswerSource {
  documentId: string;
  chunkIndex: number;
  pageNumbers?: number[];
  score: number;
}

interface DisplaySource {
  fileName: string;
  pageNumbers: number[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  sources?: DisplaySource[];
  sourceLookupFailed?: boolean;
}

interface StoredMessage {
  _id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  sources?: AnswerSource[];
}

interface Conversation {
  _id: string;
  workspaceId: string;
  title: string;
  messages?: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

interface GeneratedAnswer {
  answer: string;
  sources?: AnswerSource[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

interface DocumentRecord {
  _id: string;
  fileName: string;
}

function isAnswerSource(value: unknown): value is AnswerSource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const source = value as Partial<AnswerSource>;
  return (
    typeof source.documentId === 'string' &&
    Number.isInteger(source.chunkIndex) &&
    typeof source.score === 'number' &&
    (source.pageNumbers === undefined ||
      (Array.isArray(source.pageNumbers) && source.pageNumbers.every(Number.isInteger)))
  );
}

function isGeneratedAnswer(value: unknown): value is GeneratedAnswer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const answer = value as Partial<GeneratedAnswer>;
  return (
    typeof answer.answer === 'string' &&
    (answer.sources === undefined ||
      (Array.isArray(answer.sources) && answer.sources.every(isAnswerSource)))
  );
}

function groupSources(
  sources: AnswerSource[],
  fileNames: Map<string, string>,
): DisplaySource[] {
  const groupedSources = new Map<string, Set<number>>();
  for (const source of sources) {
    let pages = groupedSources.get(source.documentId);
    if (!pages) {
      pages = new Set<number>();
      groupedSources.set(source.documentId, pages);
    }
    source.pageNumbers?.forEach((pageNumber) => pages?.add(pageNumber));
  }

  return [...groupedSources].map(([documentId, pages]) => ({
    fileName: fileNames.get(documentId) ?? 'Uploaded document',
    pageNumbers: [...pages].sort((a, b) => a - b),
  }));
}

async function resolveSources(
  workspaceId: string,
  sources: AnswerSource[],
): Promise<{ sources: DisplaySource[]; fileNames: Map<string, string>; lookupFailed: boolean }> {
  const unresolvedIds = new Set(sources.map((source) => source.documentId));
  const fileNames = new Map<string, string>();
  const pageSize = 100;
  let lookupFailed = false;

  for (let page = 1; unresolvedIds.size > 0; page += 1) {
    try {
      const response = await api.get<ApiResponse<DocumentRecord[]>>('/documents', {
        params: { workspaceId, page, limit: pageSize },
      });
      for (const document of response.data.data) {
        if (unresolvedIds.has(document._id)) {
          fileNames.set(document._id, document.fileName);
          unresolvedIds.delete(document._id);
        }
      }

      const totalPages = Math.ceil(
        (response.data.pagination?.total ?? response.data.data.length) / pageSize,
      );
      if (response.data.data.length === 0 || page >= totalPages) {
        break;
      }
    } catch {
      lookupFailed = true;
      break;
    }
  }

  return {
    sources: groupSources(sources, fileNames),
    fileNames,
    lookupFailed,
  };
}

async function hydrateMessages(
  workspaceId: string,
  messages: StoredMessage[],
): Promise<ChatMessage[]> {
  const allSources = messages.flatMap((message) =>
    message.role === 'assistant' ? message.sources ?? [] : [],
  );
  const resolved = await resolveSources(workspaceId, allSources);
  let generatedId = 0;

  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const sources = message.role === 'assistant' ? message.sources ?? [] : [];
      return {
        id: message._id ?? `restored-${generatedId++}`,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        ...(message.role === 'assistant'
          ? {
              sources: groupSources(sources, resolved.fileNames),
              sourceLookupFailed: resolved.lookupFailed,
            }
          : {}),
      };
    });
}

export default function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    searchParams.get('workspaceId'),
  );
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsWorkspaceId, setConversationsWorkspaceId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [conversationPendingDelete, setConversationPendingDelete] = useState<Conversation | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [deleteConversationError, setDeleteConversationError] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const nextMessageId = useRef(0);
  const loadConversationRequest = useRef(0);
  const selectedWorkspaceRef = useRef<string | null>(selectedWorkspaceId);
  const deleteRequestInProgress = useRef(false);

  const loadConversations = useCallback(async (workspaceId: string) => {
    setIsLoadingConversations(true);
    setConversationError(null);
    try {
      const response = await api.get<ApiResponse<Conversation[]>>('/conversations', {
        params: { workspaceId, page: 1, limit: 100 },
      });
      if (selectedWorkspaceRef.current === workspaceId) {
        setConversations(response.data.data);
        setConversationsWorkspaceId(workspaceId);
      }
    } catch (error) {
      if (selectedWorkspaceRef.current === workspaceId) {
        setConversationError(
          getApiErrorMessage(error, 'Could not load conversations. Please try again.'),
        );
      }
    } finally {
      if (selectedWorkspaceRef.current === workspaceId) {
        setIsLoadingConversations(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadWorkspaces() {
      setIsLoadingWorkspaces(true);
      setWorkspaceError(null);
      try {
        const response = await api.get<ApiResponse<Workspace[]>>('/workspaces');
        if (!active) {
          return;
        }

        const availableWorkspaces = response.data.data;
        setWorkspaces(availableWorkspaces);
        const requestedId = searchParams.get('workspaceId');
        const resolvedId = availableWorkspaces.some((workspace) => workspace._id === requestedId)
          ? requestedId
          : availableWorkspaces[0]?._id ?? null;
        selectedWorkspaceRef.current = resolvedId;
        setSelectedWorkspaceId(resolvedId);
        setSearchParams(resolvedId ? { workspaceId: resolvedId } : {}, { replace: true });
      } catch (error) {
        if (active) {
          setWorkspaceError(getApiErrorMessage(error, 'Could not load workspaces.'));
        }
      } finally {
        if (active) {
          setIsLoadingWorkspaces(false);
        }
      }
    }

    void loadWorkspaces();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setConversations([]);
      setConversationsWorkspaceId(null);
      setIsLoadingConversations(false);
      return;
    }

    setConversations([]);
    setConversationsWorkspaceId(null);
    setActiveConversationId(null);
    setMessages([]);
    setChatError(null);
    void loadConversations(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, isSubmitting, isLoadingConversation]);

  function handleWorkspaceChange(workspaceId: string) {
    if (workspaceId === selectedWorkspaceId) {
      return;
    }
    loadConversationRequest.current += 1;
    setIsLoadingConversation(false);
    selectedWorkspaceRef.current = workspaceId;
    setSelectedWorkspaceId(workspaceId);
    setSearchParams({ workspaceId });
    setActiveConversationId(null);
    setMessages([]);
    setQuestion('');
    setChatError(null);
  }

  async function handleNewChat() {
    if (!selectedWorkspaceId || isCreatingConversation || isSubmitting) {
      return;
    }

    setConversationError(null);
    setIsCreatingConversation(true);
    try {
      const response = await api.post<ApiResponse<Conversation>>('/conversations', {
        workspaceId: selectedWorkspaceId,
      });
      const conversation = response.data.data;
      if (selectedWorkspaceRef.current !== selectedWorkspaceId) {
        return;
      }
      setActiveConversationId(conversation._id);
      setMessages([]);
      setQuestion('');
      setChatError(null);
      await loadConversations(selectedWorkspaceId);
    } catch (error) {
      setConversationError(
        getApiErrorMessage(error, 'Could not start a new conversation. Please try again.'),
      );
    } finally {
      setIsCreatingConversation(false);
    }
  }

  async function handleSelectConversation(conversationId: string) {
    if (!selectedWorkspaceId || conversationId === activeConversationId || isSubmitting) {
      return;
    }

    const requestId = ++loadConversationRequest.current;
    const workspaceId = selectedWorkspaceId;
    setActiveConversationId(conversationId);
    setMessages([]);
    setChatError(null);
    setConversationError(null);
    setIsLoadingConversation(true);

    try {
      const response = await api.get<ApiResponse<Conversation>>(
        `/conversations/${encodeURIComponent(conversationId)}`,
      );
      if (requestId !== loadConversationRequest.current || selectedWorkspaceId !== workspaceId) {
        return;
      }
      if (response.data.data.workspaceId !== workspaceId) {
        throw new Error('This conversation does not belong to the selected workspace.');
      }

      const restoredMessages = await hydrateMessages(
        workspaceId,
        response.data.data.messages ?? [],
      );
      if (requestId === loadConversationRequest.current) {
        setMessages(restoredMessages);
      }
    } catch (error) {
      if (requestId === loadConversationRequest.current) {
        setActiveConversationId(null);
        setConversationError(
          getApiErrorMessage(error, 'Could not load this conversation. Please try again.'),
        );
      }
    } finally {
      if (requestId === loadConversationRequest.current) {
        setIsLoadingConversation(false);
      }
    }
  }

  function openDeleteConfirmation(conversation: Conversation) {
    setDeleteConversationError(null);
    setConversationPendingDelete(conversation);
  }

  function closeDeleteConfirmation() {
    if (deleteRequestInProgress.current) {
      return;
    }
    setConversationPendingDelete(null);
    setDeleteConversationError(null);
  }

  async function handleDeleteConversation() {
    const conversation = conversationPendingDelete;
    if (!conversation || deleteRequestInProgress.current) {
      return;
    }

    deleteRequestInProgress.current = true;
    setIsDeletingConversation(true);
    setDeleteConversationError(null);
    try {
      await api.delete(`/conversations/${encodeURIComponent(conversation._id)}`);
      if (activeConversationId === conversation._id) {
        loadConversationRequest.current += 1;
        setActiveConversationId(null);
        setMessages([]);
      }
      setConversations((currentConversations) =>
        currentConversations.filter((item) => item._id !== conversation._id),
      );
      setConversationPendingDelete(null);
      await loadConversations(conversation.workspaceId);
    } catch (error) {
      setDeleteConversationError(
        getApiErrorMessage(error, 'Could not delete this conversation. Please try again.'),
      );
    } finally {
      deleteRequestInProgress.current = false;
      setIsDeletingConversation(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (
      !selectedWorkspaceId ||
      !activeConversationId ||
      !submittedQuestion ||
      isSubmitting
    ) {
      return;
    }

    setQuestion('');
    setChatError(null);
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `local-${++nextMessageId.current}`,
        role: 'user',
        content: submittedQuestion,
        timestamp: new Date().toISOString(),
      },
    ]);
    setIsSubmitting(true);

    try {
      const response = await api.post<ApiResponse<GeneratedAnswer>>('/questions', {
        question: submittedQuestion,
        workspaceId: selectedWorkspaceId,
        conversationId: activeConversationId,
      });

      if (!response.data.success || !isGeneratedAnswer(response.data.data)) {
        throw new Error('The answer service returned an invalid response. Please try again.');
      }

      const answer = response.data.data.answer.trim();
      const resolved = await resolveSources(
        selectedWorkspaceId,
        response.data.data.sources ?? [],
      );
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `local-${++nextMessageId.current}`,
          role: 'assistant',
          content: answer,
          timestamp: new Date().toISOString(),
          sources: resolved.sources,
          sourceLookupFailed: resolved.lookupFailed,
        },
      ]);
      await loadConversations(selectedWorkspaceId);
    } catch (error) {
      setChatError(getApiErrorMessage(error, 'Could not get an answer. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedWorkspace = workspaces.find((workspace) => workspace._id === selectedWorkspaceId);
  const activeConversation = conversations.find(
    (conversation) => conversation._id === activeConversationId,
  );
  const visibleConversations = conversationsWorkspaceId === selectedWorkspaceId ? conversations : [];

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-sm uppercase tracking-[0.2em] text-primary-500">AI Copilot</p>
          <h1 className="text-2xl font-bold text-white">Ask your knowledge base</h1>
          <p className="mt-2 text-sm text-slate-400">
            Answers are grounded in documents from the selected workspace.
          </p>
        </div>
        <Link
          to={selectedWorkspaceId ? `/dashboard?workspaceId=${encodeURIComponent(selectedWorkspaceId)}` : '/dashboard'}
          className="w-fit rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
        >
          Back to workspace
        </Link>
      </header>

      <div className="grid min-h-[38rem] flex-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="flex min-h-56 flex-col rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:min-h-0">
          <div className="mb-4">
            <label htmlFor="chat-workspace" className="mb-2 block text-sm font-medium text-slate-300">
              Workspace
            </label>
            {isLoadingWorkspaces ? (
              <p className="text-sm text-slate-400" role="status">Loading workspaces...</p>
            ) : workspaceError ? (
              <p className="text-sm text-red-300" role="alert">{workspaceError}</p>
            ) : workspaces.length === 0 ? (
              <p className="text-sm text-slate-400">
                No workspaces yet. <Link to="/dashboard" className="text-primary-400 hover:text-primary-300">Create one first.</Link>
              </p>
            ) : (
              <select
                id="chat-workspace"
                value={selectedWorkspaceId ?? ''}
                onChange={(event) => handleWorkspaceChange(event.target.value)}
                disabled={isSubmitting || isCreatingConversation}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-primary-500 disabled:opacity-60"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace._id} value={workspace._id}>{workspace.name}</option>
                ))}
              </select>
            )}
          </div>

          <button
            type="button"
            aria-label="New Chat"
            onClick={() => void handleNewChat()}
            disabled={!selectedWorkspaceId || isCreatingConversation || isSubmitting}
            className="mb-4 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreatingConversation ? 'Creating...' : '+ New Chat'}
          </button>

          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recent conversations
            </h2>
            {selectedWorkspaceId && (
              <button
                type="button"
                onClick={() => void loadConversations(selectedWorkspaceId)}
                disabled={isLoadingConversations}
                className="text-xs text-slate-400 hover:text-white disabled:opacity-50"
              >
                Refresh
              </button>
            )}
          </div>

          {conversationError && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-xs text-red-300" role="alert">{conversationError}</p>
              {selectedWorkspaceId && (
                <button
                  type="button"
                  onClick={() => void loadConversations(selectedWorkspaceId)}
                  className="mt-2 text-xs font-medium text-red-200 underline"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Conversation list">
            {isLoadingConversations ? (
              <p className="px-2 py-4 text-sm text-slate-400" role="status">Loading conversations...</p>
            ) : visibleConversations.length === 0 ? (
              <p className="px-2 py-4 text-sm text-slate-500">
                {selectedWorkspaceId ? 'No conversations yet. Start a new chat.' : 'Select a workspace to see conversations.'}
              </p>
            ) : (
              visibleConversations.map((conversation) => {
                const title = conversation.title || 'New conversation';
                return (
                  <div
                    key={conversation._id}
                    className={`group flex items-center gap-1 rounded-lg ${
                      activeConversationId === conversation._id
                        ? 'bg-slate-800'
                        : 'hover:bg-slate-800/70'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={activeConversationId === conversation._id}
                      disabled={isLoadingConversation || isSubmitting}
                      onClick={() => void handleSelectConversation(conversation._id)}
                      className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm text-slate-200 disabled:opacity-60"
                      title={title}
                    >
                      {title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${title}`}
                      disabled={isSubmitting || isCreatingConversation || isLoadingConversation}
                      onClick={() => openDeleteConfirmation(conversation)}
                      className="mr-1 rounded px-2 py-1 text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
          <div className="border-b border-slate-800 px-4 py-3 sm:px-6">
            <p className="text-sm font-medium text-white">
              {activeConversation?.title || (activeConversationId ? 'New conversation' : 'No conversation selected')}
            </p>
            {selectedWorkspace && (
              <p className="mt-1 text-xs text-slate-400">{selectedWorkspace.name}</p>
            )}
          </div>

          <div
            className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6"
            aria-live="polite"
            aria-label="Chat messages"
          >
            {isLoadingConversation ? (
              <p className="py-12 text-center text-sm text-slate-400" role="status">
                Loading conversation...
              </p>
            ) : messages.length === 0 && !isSubmitting ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center">
                <p className="text-lg font-medium text-white">
                  {activeConversationId ? 'What would you like to know?' : 'No conversation selected'}
                </p>
                <p className="mt-2 max-w-md text-sm text-slate-400">
                  {activeConversationId
                    ? `Ask a question about documents in ${selectedWorkspace?.name ?? 'your selected workspace'}.`
                    : 'Select a conversation or start a new chat.'}
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[90%] rounded-2xl p-4 sm:max-w-[80%] ${
                    message.role === 'user'
                      ? 'ml-auto bg-primary-700 text-white'
                      : 'mr-auto border border-slate-800 bg-slate-950 text-slate-200'
                  }`}
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {message.role === 'user' ? 'You' : 'Copilot'}
                  </p>
                  {message.content ? (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
                  ) : (
                    <p className="text-sm italic text-slate-400">No answer was returned for this question.</p>
                  )}
                  {message.role === 'assistant' && (
                    message.sources && message.sources.length > 0 ? (
                      <div className="mt-4 border-t border-slate-800 pt-3">
                        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Sources
                        </h2>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {message.sources.map((source, index) => (
                            <li
                              key={`${source.fileName}-${index}`}
                              className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300"
                            >
                              <p className="break-words font-medium text-slate-100">{source.fileName}</p>
                              {source.pageNumbers.length > 0 && (
                                <p className="mt-1 text-xs text-slate-400">
                                  Pages: {source.pageNumbers.join(', ')}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                        {message.sourceLookupFailed && (
                          <p className="mt-2 text-xs text-amber-300">
                            Some source filenames could not be loaded. Unavailable filenames are shown as “Uploaded document”.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-400">
                        No source references were returned for this answer.
                      </p>
                    )
                  )}
                  {message.role === 'assistant' && !message.content && (
                    <p className="mt-2 text-xs text-slate-400">Try rephrasing your question.</p>
                  )}
                </article>
              ))
            )}
            {isSubmitting && (
              <div className="mr-auto max-w-[90%] rounded-2xl border border-slate-800 bg-slate-950 p-4 text-slate-300 sm:max-w-[80%]" role="status">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Copilot</p>
                <p className="animate-pulse">Searching your documents and generating an answer...</p>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>

          {chatError && (
            <p className="mx-4 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 sm:mx-6" role="alert">
              {chatError}
            </p>
          )}

          <form onSubmit={handleSubmit} className="border-t border-slate-800 p-4 sm:p-6">
            <label htmlFor="chat-question" className="sr-only">Your question</label>
            <div className="flex items-end gap-3">
              <textarea
                id="chat-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                maxLength={5000}
                rows={2}
                disabled={!activeConversationId || isLoadingConversation || isSubmitting}
                placeholder="Ask a question about your documents..."
                className="min-h-12 flex-1 resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-primary-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!activeConversationId || !question.trim() || isSubmitting || isLoadingConversation}
                className="rounded-xl bg-primary-600 px-5 py-3 font-medium text-white hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Thinking...' : 'Send'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Enter to send · Shift+Enter for a new line</p>
          </form>
        </section>
      </div>
      {conversationPendingDelete && (
        <DeleteConfirmationModal
          conversationTitle={conversationPendingDelete.title}
          isDeleting={isDeletingConversation}
          error={deleteConversationError}
          onCancel={closeDeleteConfirmation}
          onDelete={() => void handleDeleteConversation()}
        />
      )}
    </div>
  );
}
