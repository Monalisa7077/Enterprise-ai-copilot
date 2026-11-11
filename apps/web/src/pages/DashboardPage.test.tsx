import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import DashboardPage from './DashboardPage';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

const workspaces = [
  {
    _id: 'workspace-1',
    name: 'Engineering',
    description: 'Engineering team documents',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    _id: 'workspace-2',
    name: 'Operations',
    description: '',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

const documents = [
  {
    _id: 'document-1',
    workspaceId: 'workspace-1',
    fileName: 'handbook.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    status: 'PENDING' as 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
];

function documentListResponse(data = documents) {
  return {
    data: {
      success: true,
      data,
      pagination: { page: 1, limit: 20, total: data.length },
    },
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads workspaces and allows selecting one', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(documentListResponse())
      .mockResolvedValueOnce(documentListResponse());
    const user = userEvent.setup();

    renderDashboard();

    expect(screen.getByRole('status').textContent).toContain('Loading workspaces');
    const engineeringButton = await screen.findByRole('button', { name: /Engineering/ });
    const operationsButton = screen.getByRole('button', { name: /Operations/ });
    expect(engineeringButton.getAttribute('aria-pressed')).toBe('true');
    expect(operationsButton.getAttribute('aria-pressed')).toBe('false');

    await user.click(operationsButton);
    expect(operationsButton.getAttribute('aria-pressed')).toBe('true');
    expect(engineeringButton.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/documents', {
      params: { workspaceId: 'workspace-2', page: 1, limit: 20 },
    }));
  });

  it('creates a workspace and selects it', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: [] } })
      .mockResolvedValueOnce(documentListResponse([]));
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { ...workspaces[0], name: 'Research' } },
    });
    const user = userEvent.setup();

    renderDashboard();

    expect(await screen.findByText('No workspaces yet. Create one to get started.')).toBeTruthy();
    await user.type(await screen.findByLabelText('Name'), 'Research');
    await user.type(screen.getByLabelText(/Description/), 'Research documents');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect((await screen.findByRole('status')).textContent).toContain('Research” was created and selected.');
    expect(api.post).toHaveBeenCalledWith('/workspaces', {
      name: 'Research',
      description: 'Research documents',
    });
    expect(screen.getByRole('button', { name: /Research/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a load error and can retry', async () => {
    const getWorkspaces = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ data: { success: true, data: workspaces } })
      .mockResolvedValueOnce(documentListResponse());

    renderDashboard();

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load workspaces');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(getWorkspaces).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: /Engineering/ })).toBeTruthy();
  });

  it('uploads a file as multipart data for the selected workspace', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: [workspaces[0]] } })
      .mockResolvedValueOnce(documentListResponse([]))
      .mockResolvedValueOnce(documentListResponse(documents));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: documents[0] } });
    const user = userEvent.setup({ applyAccept: false });
    renderDashboard();

    await screen.findByText('No documents in this workspace yet. Upload one to get started.');
    const file = new File(['%PDF-1.7'], 'handbook.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('File'), file);
    await user.click(screen.getByRole('button', { name: 'Upload document' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'handbook.pdf uploaded successfully and is PENDING.',
    );
    const formData = post.mock.calls[0][1] as FormData;
    expect(formData.get('workspaceId')).toBe('workspace-1');
    expect((formData.get('file') as File).name).toBe('handbook.pdf');
    expect((formData.get('file') as File).type).toBe('application/pdf');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('handbook.pdf')).toBeTruthy();
  });

  it('refreshes document processing statuses', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: [workspaces[0]] } })
      .mockResolvedValueOnce(documentListResponse())
      .mockResolvedValueOnce(documentListResponse([{ ...documents[0], status: 'COMPLETED' }]));
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByText('PENDING')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Refresh statuses' }));
    expect(await screen.findByText('COMPLETED')).toBeTruthy();
  });

  it('rejects unsupported files and oversized files before upload', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { success: true, data: [workspaces[0]] } })
      .mockResolvedValueOnce(documentListResponse([]));
    const post = vi.spyOn(api, 'post');
    const user = userEvent.setup({ applyAccept: false });
    renderDashboard();
    await screen.findByText('No documents in this workspace yet. Upload one to get started.');

    await user.upload(screen.getByLabelText('File'), new File(['data'], 'notes.csv', { type: 'text/csv' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a PDF, DOCX, or TXT file.');
    expect(post).not.toHaveBeenCalled();

    const oversizedFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('File'), oversizedFile);
    expect((await screen.findByRole('alert')).textContent).toContain('no larger than 10 MB');
    expect(post).not.toHaveBeenCalled();
  });
});
