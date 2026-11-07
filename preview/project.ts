import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const REPOSITORIES = ['enois-backend', 'enois-frontend', 'enois-design-system'] as const;
