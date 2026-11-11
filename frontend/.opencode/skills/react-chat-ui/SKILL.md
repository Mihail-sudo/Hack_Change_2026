---
name: react-chat-ui
description: Build accessible and responsive React chat interfaces, message timelines, chat composers, session history and debug panels.
---

# React Chat UI

When implementing chat functionality:

- Use small, composable React components.
- Separate message rendering from message sending.
- Support loading, error, empty and retry states.
- Prevent duplicate message submissions.
- Handle asynchronous request races.
- Preserve scroll position when appropriate.
- Auto-scroll only when the user is already near the bottom.
- Support long messages and multiline input.
- Implement keyboard navigation.
- Use accessible live regions.
- Use semantic HTML.
- Support mobile layouts.
- Respect reduced motion.
- Use accessible dialog primitives.
- Do not invent backend responses or RAG sources.
- Keep debug information attached to its assistant message.
- Never expose internal model reasoning or personal data.

Test:

- Sending a message.
- Receiving an answer.
- Starting a new session.
- Switching between sessions.
- Error handling.
- Mobile layout.
