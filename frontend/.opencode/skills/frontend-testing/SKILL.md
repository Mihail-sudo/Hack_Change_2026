---
name: frontend-testing
description: Create reliable frontend unit, component, integration and E2E tests using Vitest, Testing Library, MSW and Playwright.
---

# Frontend Testing

- Prefer testing user-visible behavior.
- Use Vitest for unit tests.
- Use React Testing Library for components.
- Use user-event for user interactions.
- Use MSW for network mocking.
- Use Playwright for E2E tests.
- Avoid testing implementation details.
- Test loading, success and error states.
- Test async operations and race conditions.
- Test session isolation.
- Test form validation.
- Test accessibility where practical.

For Energytool specifically:

- New sessions must not inherit previous context.
- Previous sessions must remain available in history.
- A failed request must not create a fake assistant response.
- Lead submission requires user consent.
- RAG sources must belong to the correct response.

Run the relevant tests and report their actual results.
