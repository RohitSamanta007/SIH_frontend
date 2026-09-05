import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import CaseListPage from '../pages/CaseListPage.jsx';

vi.mock('../state/authContext.jsx', () => ({
  useAuth: () => ({ user: { username: 'investigator' }, logout: vi.fn() }),
}));
vi.mock('../api/apiClient.js', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { data: { cases: [] } } }) },
}));

describe('Case list header', () => {
  it('uses the real case-list route for the Trace-X logo', () => {
    render(<MemoryRouter><CaseListPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /trace-x/i }).getAttribute('href')).toBe('/cases');
  });
});
