---
name: fsd-feature
description: Design and implement frontend features using Feature-Sliced Design architecture.
---

# FSD Feature Development

When implementing a new feature:

1. Inspect the existing project structure.
2. Identify the correct FSD layer.
3. Follow dependency direction:
   app -> pages -> widgets -> features -> entities -> shared.
4. Avoid cross-imports between slices of the same layer.
5. Use public APIs through index.ts.
6. Keep business logic outside UI components.
7. Keep API communication outside React components.
8. Avoid unnecessary abstractions.
9. Use strict TypeScript.
10. Add tests for important behavior.

Before finishing:

- Check architecture boundaries.
- Check imports.
- Run ESLint.
- Run TypeScript checks.
- Run relevant tests.
- Run production build.

Always explain architectural decisions.
