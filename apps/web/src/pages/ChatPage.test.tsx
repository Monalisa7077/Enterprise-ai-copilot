import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import ChatPage from './ChatPage';

const workspaces = [
  { _id: 'workspace-1', name: 'Engineering' },
  { _id: 'workspace-2', name: 'Operations' },
];

const conversations = [
  {
    _id: 'conversation-1',
    workspaceId: 'workspace-1',
    title: 'Retention policy',
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    _id: 'conversation-2',
    workspaceId: 'workspace-1',
    title: 'Security policy',
    messages: [],
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

function listResponse(data: typeof conversations) {
  return {
    data: {
      success: true,
      data,
      pagination: { page: 1, limit: 100, total: data.length },
    },
  };
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/chat?workspaceId=workspace-1']}>
      <ChatPage />
    </MemoryRouter>,
  );
}

describe('ChatPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads conversations for the selected workspace', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations));

    renderChat();

    expect(await screen.findByRole('button', { name: 'Retention policy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Security policy' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/conversations', {
      params: { workspaceId: 'workspace-1', page: 1, limit: 100 },
    });
  });

  it('creates a new conversation and selects the empty conversation', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([
        { ...conversations[0], _id: 'conversation-new', title: 'New conversation' },
      ]));
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: { ...conversations[0], _id: 'conversation-new', title: 'New conversation' },
      },
    });
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'New Chat' }));

    expect(post).toHaveBeenCalledWith('/conversations', { workspaceId: 'workspace-1' });
    expect(await screen.findByText('What would you like to know?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New conversation' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('loads a selected conversation and restores messages and readable source references', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations))
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            ...conversations[0],
            messages: [
              { _id: 'message-1', role: 'user', content: 'What is the retention period?', timestamp: '2026-01-01T01:00:00Z' },
              {
                _id: 'message-2',
                role: 'assistant',
                content: 'Seven years.',
                timestamp: '2026-01-01T01:00:01Z',
                sources: [{ documentId: 'document-1', chunkIndex: 2, pageNumbers: [3, 4], score: 0.9 }],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [{ _id: 'document-1', fileName: 'Retention Policy.pdf' }],
          pagination: { page: 1, limit: 100, total: 1 },
        },
      });
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Retention policy' }));

    expect(await screen.findByText('What is the retention period?')).toBeTruthy();
    expect(screen.getByText('Seven years.')).toBeTruthy();
    expect(screen.getByText('Retention Policy.pdf')).toBeTruthy();
    expect(screen.getByText('Pages: 3, 4')).toBeTruthy();
    const chat = screen.getByLabelText('Chat messages').textContent ?? '';
    expect(chat).not.toContain('document-1');
    expect(chat).not.toContain('Chunk');
  });

  it('sends a question with the selected conversation ID and refreshes the list', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations))
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            ...conversations[0],
            messages: [
              { _id: 'message-1', role: 'user', content: 'Earlier question', timestamp: '2026-01-01T01:00:00Z' },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [{ _id: 'document-1', fileName: 'Handbook.txt' }],
          pagination: { page: 1, limit: 100, total: 1 },
        },
      })
      .mockResolvedValueOnce(listResponse([
        { ...conversations[0], updatedAt: '2026-01-03T00:00:00.000Z' },
        conversations[1],
      ]));
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          answer: 'The answer is in the handbook.',
          sources: [{ documentId: 'document-1', chunkIndex: 0, pageNumbers: [8], score: 0.9 }],
        },
      },
    });
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Retention policy' }));
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Where is it?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('The answer is in the handbook.')).toBeTruthy();
    expect(screen.getByText('Handbook.txt')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/questions', {
      question: 'Where is it?',
      workspaceId: 'workspace-1',
      conversationId: 'conversation-1',
    });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/conversations', {
        params: { workspaceId: 'workspace-1', page: 1, limit: 100 },
      });
    });
    expect(get.mock.calls.filter(([url]) => url === '/conversations')).toHaveLength(2);
  });

  it('updates the sidebar title after the first question is answered', async () => {
    const newConversation = {
      ...conversations[0],
      _id: 'conversation-new',
      title: 'New conversation',
    };
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([newConversation]))
      .mockResolvedValueOnce(listResponse([
        { ...newConversation, title: 'JavaScript Questions' },
      ]));
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { success: true, data: newConversation } })
      .mockResolvedValueOnce({
        data: { success: true, data: { answer: 'Here are the questions.', sources: [] } },
      });
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'New Chat' }));
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Give me all the JS questions');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('button', { name: 'JavaScript Questions' })).toBeTruthy();
    expect(post).toHaveBeenNthCalledWith(2, '/questions', {
      question: 'Give me all the JS questions',
      workspaceId: 'workspace-1',
      conversationId: 'conversation-new',
    });
    expect(get.mock.calls.filter(([url]) => url === '/conversations')).toHaveLength(3);
  });

  it('opens the delete modal and removes the conversation after confirmation', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations))
      .mockResolvedValueOnce(listResponse([conversations[1]]));
    const deleteConversation = vi.spyOn(api, 'delete').mockResolvedValue({
      data: { success: true, message: 'Conversation deleted successfully' },
    });
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Delete Retention policy' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' });
    expect(within(dialog).getByText('“Retention policy” will be deleted.')).toBeTruthy();
    expect(within(dialog).getByText(
      'Are you sure you want to delete this conversation? This action cannot be undone.',
    )).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(deleteConversation).toHaveBeenCalledWith('/conversations/conversation-1');
    expect(await screen.findByRole('button', { name: 'Security policy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retention policy' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Select a conversation or start a new chat.')).toBeTruthy();
  });

  it('cancels deletion without calling the API and supports Escape', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations));
    const deleteConversation = vi.spyOn(api, 'delete');
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Delete Retention policy' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Retention policy' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it('prevents duplicate delete requests while deletion is processing', async () => {
    let finishDelete!: (response: { data: { success: boolean } }) => void;
    const pendingDelete = new Promise<{ data: { success: boolean } }>((resolve) => {
      finishDelete = resolve;
    });
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations))
      .mockResolvedValueOnce(listResponse([conversations[1]]));
    const deleteConversation = vi.spyOn(api, 'delete').mockReturnValue(pendingDelete);
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Delete Retention policy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(within(dialog).getByRole('button', { name: 'Deleting...' }).hasAttribute('disabled')).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Deleting...' }));
    expect(deleteConversation).toHaveBeenCalledTimes(1);

    await act(async () => finishDelete({ data: { success: true } }));
    expect(await screen.findByRole('button', { name: 'Security policy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retention policy' })).toBeNull();
  });

  it('shows a friendly error and keeps the modal open when deletion fails', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations));
    const deleteConversation = vi.spyOn(api, 'delete').mockRejectedValue(new Error('Server failure'));
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Delete Retention policy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Could not delete this conversation. Please try again.',
    );
    expect(deleteConversation).toHaveBeenCalledWith('/conversations/conversation-1');
    expect(screen.getByRole('button', { name: 'Retention policy' })).toBeTruthy();
  });

  it('loads conversations for a changed workspace and clears the active chat', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(listResponse(conversations))
      .mockResolvedValueOnce({
        data: { success: true, data: { ...conversations[0], messages: [
          { _id: 'message-1', role: 'user', content: 'Old workspace question', timestamp: '2026-01-01T01:00:00Z' },
        ] } },
      })
      .mockResolvedValueOnce(listResponse([]));
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Retention policy' }));
    expect(await screen.findByText('Old workspace question')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Workspace' }), 'workspace-2');

    expect(await screen.findByText('No conversations yet. Start a new chat.')).toBeTruthy();
    expect(screen.queryByText('Old workspace question')).toBeNull();
    expect(get).toHaveBeenCalledWith('/conversations', {
      params: { workspaceId: 'workspace-2', page: 1, limit: 100 },
    });
    expect(screen.getByText('Select a conversation or start a new chat.')).toBeTruthy();
  });

  it('shows conversation loading and API errors', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockRejectedValueOnce(new Error('List failed'));
    renderChat();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not load conversations');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows a loading state while the conversation list request is pending', async () => {
    let finishLoading!: (response: ReturnType<typeof listResponse>) => void;
    const pendingList = new Promise<ReturnType<typeof listResponse>>((resolve) => {
      finishLoading = resolve;
    });
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockReturnValueOnce(pendingList);
    renderChat();

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Loading conversations');
    await act(async () => finishLoading(listResponse([])));
    expect(await screen.findByText('No conversations yet. Start a new chat.')).toBeTruthy();
  });

});
