module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { path: '^src', orphan: true },
      to: {},
    },
    {
      name: 'engine-must-not-depend-on-services',
      severity: 'warn',
      from: { path: '^src/engine' },
      to: { path: '^src/services' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
  },
};
