// Releases are calculated from Conventional Commits; nothing is committed back (no @semantic-release/git).
// ENOIS_FORCE_PATCH=true comes from the qualify job for a manual release without releasable commits.
const releaseRules = [{ type: 'revert', release: 'patch' }];
if (process.env.ENOIS_FORCE_PATCH === 'true') releaseRules.push({ release: 'patch' });

module.exports = {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits', releaseRules }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    '@semantic-release/npm',
    ['@semantic-release/exec', { prepareCmd: 'npm run test:package && npm pack --dry-run' }],
    [
      '@semantic-release/github',
      { successComment: false, failComment: false, releasedLabels: false, releaseNameTemplate: '<%= nextRelease.version %>' },
    ],
  ],
};
