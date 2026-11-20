import { describe, expect, it } from 'vitest';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../router.js';
import { isKnownPath } from './brand.js';

// The edge Worker answers any path isKnownPath rejects with a 404, so every route the SPA serves must pass it.
describe('isKnownPath covers the router', () => {
  it('accepts every routed path', () => {
    const router = createRouter({ routeTree });
    const paths = router.flatRoutes.map((r) => r.fullPath.replace(/\$[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000'));
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) expect(isKnownPath(path), path).toBe(true);
  });
});
